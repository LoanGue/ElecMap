# Algorithmes

Ce document décrit les méthodes numériques utilisées par ElecMap.

## Noyau mathématique (`src/math`)

| Brique                | Méthode                                                                                   | Remarques                                                                                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Complex`             | `re + j·im` immuable                                                                      | La division utilise l'algorithme de Smith pour éviter les dépassements.                                                                                                                                                                                                        |
| `Polynomial`          | Coefficients réels en puissances croissantes de `s`                                       | Les additions ramènent exactement à 0 les résidus d'annulation catastrophique (`abs(a + b) ≤ 1e-13·(abs(a) + abs(b))`), afin que les identités de type symbolique soient respectées, tandis que les coefficients légitimement minuscules (p. ex. `LC = 1e-12`) sont préservés. |
| `Rational`            | `N(s) / D(s)`                                                                             | Fonctions de transfert et impédances. Normalisable sous la forme d'ingénieur `… / (1 + a·s + …)`.                                                                                                                                                                              |
| `RealLU`, `ComplexLU` | LU dense avec pivot partiel                                                               | Factoriser une fois, résoudre de nombreux seconds membres (analyse transitoire). La singularité est détectée par rapport au plus grand coefficient de la matrice.                                                                                                              |
| `bareissDeterminant`  | Élimination de Bareiss sans fraction sur un `Ring<T>` générique                           | Avec l'anneau des polynômes, elle donne exactement `det(A(s))` ; les fonctions de transfert découlent de la règle de Cramer appliquée à la matrice MNA. Le même code fonctionnera sur des polynômes symboliques.                                                               |
| `polynomialRoots`     | Formules closes jusqu'au degré 2, itération d'Aberth–Ehrlich au-delà, affinage par Newton | Utilisé pour les pôles et les zéros. Les racines réelles sont renvoyées avec une partie imaginaire exactement nulle.                                                                                                                                                           |

## Analyse nodale modifiée

Toutes les analyses travaillent sur le système `(G + s·C)·x = b`, assemblé une fois par circuit par `MnaSystem` :

- **Inconnues :** les tensions des nœuds hors masse (dans l'ordre de `circuit.nodes`), puis un courant de branche par source de tension, bobine, VCVS, CCVS, sortie d'amplificateur opérationnel et interrupteur idéal fermé.
- **G** contient les conductances et les coefficients topologiques ±1, **C** contient les coefficients de `s` (capacités, −L sur les branches de bobines, −M pour les couplages, le pôle GBW des amplificateurs opérationnels).
- **b** est construit à partir des sources indépendantes selon l'analyse (valeurs continues, phaseurs AC, ou une seule source unitaire pour les fonctions de transfert).

| Composant                 | Contribution (stamp)                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| Résistance / condensateur | admittance `1/R` dans G, `C` dans C entre ses deux nœuds                                  |
| Bobine                    | branche : `Va − Vb − s·L·I = 0`                                                           |
| Couplage                  | `−s·M` entre les deux branches des bobines, `M = k·√(L1·L2)`                              |
| Source de tension         | branche : `Vp − Vn = E`                                                                   |
| Source de courant         | `b[p] −= I`, `b[n] += I`                                                                  |
| VCVS (E) / CCVS (H)       | branche : `Vp − Vn − A·Vc = 0` / `Vp − Vn − r·Ictrl = 0`                                  |
| VCCS (G) / CCCS (F)       | coefficients de transconductance / de gain en courant dans les lignes de la loi des nœuds |
| Ampli-op                  | branche de sortie ; idéal : `V+ − V− = 0` ; fini : `Vout·(1 + s·A/ωt) = A·(V+ − V−)`      |

Les mêmes matrices sont évaluées en `s = 0` (continu, LU réelle), en `s = jω` (AC, LU complexe) ou conservées sous forme de matrice polynomiale en `s` (fonctions de transfert). Toute grandeur (tension entre deux nœuds, courant dans un composant) est une _forme linéaire_ `Σ (g + s·c)·x` évaluée sur la solution.

Lorsque le système continu est singulier parce qu'un nœud n'a pas de chemin continu (derrière des condensateurs en série), une conductance `gmin = 1e-12 S` vers la masse est ajoutée, comme dans SPICE ; `DcSolution.gminUsed` le signale.

## Circuits non linéaires

Un composant non linéaire ajoute une étape `load` à son stamp MNA. Une diode a son propre courant de branche `I` comme inconnue : son incidence dans les lois des nœuds est dans G, et sa ligne de branche est remplie à chaque itération de Newton par la tangente de la loi de Shockley à l'itéré courant `V_j⁰` :

<div class="em-math">(1 + g\,R_S)\,I - g\,V_A + g\,V_K = I_d(V_j^0) - g\,V_j^0, \qquad g = \frac{\partial I_d}{\partial V_j}(V_j^0)</div>

L'équation du composant est algébrique (la méthode d'intégration ne la met pas à l'échelle), et le courant est une forme linéaire comme les autres.

Les transistors suivent le même schéma avec plus d'inconnues : un BJT a deux courants de branche (collecteur `I(Q1)` et base `I(Q1:b)`, le courant d'émetteur valant `−I_C − I_B`), un MOSFET un seul (le courant de drain). Chaque ligne de branche est le plan tangent de son courant dans les tensions de commande, `I_C = I_C⁰ + g_{be}(V_{BE} − V_{BE}⁰) + g_{bc}(V_{BC} − V_{BC}⁰)` pour un BJT et `I_D = I_D⁰ + g_m ΔV_{GS} + g_{ds} ΔV_{DS} + g_{mbs} ΔV_{BS}` pour un MOSFET ; un PNP / PMOS est résolu comme un NPN / NMOS dont toutes les tensions et tous les courants sont opposés.

- **Newton-Raphson.** Chaque itération reconstruit `G + J` et le résout par LU. Un itéré est accepté quand chaque tension bouge de moins de `reltol·|v| + vntol` et chaque courant de moins de `reltol·|i| + abstol`, après au moins deux itérations et sans limitation ; un dernier pas est alors fait depuis le point accepté, ce qui, Newton étant quadratique, rend le résultat précis bien au-delà des tolérances.
- **Limitation.** Comme dans SPICE (`pnjlim`), un pas de tension de jonction au-delà de la tension critique `V_crit = N·V_T·ln(N·V_T / (√2·I_S))` est remplacé par un pas logarithmique ; la branche de claquage est limitée de la même façon. À la première itération, chaque jonction part de `V_crit`. Les BJT limitent leurs deux jonctions ainsi ; les MOSFET limitent `V_GS` et `V_DS` avec `fetlim` / `limvds` de SPICE, en partant de `V_GS = VTO`. Une conductance `gmin = 1e-12 S` est placée aux bornes de chaque jonction, et les exponentielles sont prolongées linéairement au-delà de `e^80` pour éviter les dépassements.
- **Homotopies en continu.** Si Newton seul échoue : **gmin stepping** (une conductance de chaque nœud vers la masse, de 10 mS jusqu'à 0, chaque résolution partant de la précédente), puis **source stepping** (toutes les sources indépendantes multipliées par un facteur allant de 0 à 1 avec un pas adaptatif). Sinon `NO_CONVERGENCE` est levée.
- **Charges de jonction.** Chaque jonction stocke une charge `Q(v)` (déplétion plus diffusion `TT·I`), dont le courant `dQ/dt` s'ajoute aux lignes de branche du composant : les inconnues de branche restent les courants totaux des bornes. Les charges ne sont pas dans `C`, qui est constante : l'analyse transitoire intègre `q(x) = C·x + Q(x)` avec la même formule que les charges linéaires, et Newton linéarise `α·Q(x)` comme les courants.
- **Transitoire.** Chaque pas de temps est une résolution de Newton sur le système compagnon `(α·C + G)` plus `α·Q(x)`, en partant du point précédent ; l'état des composants (dernières tensions de jonction) est conservé d'un pas à l'autre.
- **Petits signaux.** `system.smallSignal(x)` construit un nouveau `MnaSystem` linéaire dont G contient la jacobienne en `x` (le point de fonctionnement) et C les capacités de jonction `dQ/dv` en `x`. Toutes les analyses fréquentielles s'y appliquent sans changement. Le moteur littéral (symbolique) refuse les circuits non linéaires.

## Fonctions de transfert

`H(s) = y(s) / u` (forme linéaire de sortie `y`, source d'entrée unique `u`) est obtenue sous la forme `N(s) / D(s)` avec `D(s) = det(G + s·C)` et `N(s) = y(s)·D(s)` (règle de Cramer).

Développer directement un déterminant polynomial fait perdre de la précision en virgule flottante lorsque les valeurs des composants s'étalent sur de nombreuses décades (1 Ω avec 1 mF à côté de 1 MΩ avec 1 pF). ElecMap procède plutôt ainsi :

1. il choisit une **échelle de fréquence** `σ` (moyenne géométrique des rapports entre coefficients statiques et dynamiques, affinée à partir des pôles d'une première passe) ;
2. il **échantillonne** `D` et `N` en `m = n + 1` points `s = σ·e^{iθₖ}` sur un cercle, chaque échantillon correspondant à une factorisation LU complexe (déterminant + résolution) ;
3. il retrouve les coefficients par une **transformée de Fourier discrète**, parfaitement conditionnée sur le cercle unité, puis remet à l'échelle `p = s/σ` ;
4. il **simplifie** les paires pôle/zéro qui coïncident (modes que l'entrée ne peut pas exciter ou que la sortie ne peut pas voir), de sorte que `order` est l'ordre réel ;
5. il normalise le dénominateur sous la forme `1 + a₁s + …`.

Les pôles et les zéros proviennent du solveur d'Aberth–Ehrlich. Les fréquences de coupure sont trouvées par dichotomie en fréquence logarithmique sur `|H| = ref/√2`, le pic par une recherche par section dorée.

## Impédances équivalentes

`Z(s)` entre `a` et `b` réutilise la mécanique des fonctions de transfert : les sources indépendantes sont annulées (les sources de tension deviennent des courts-circuits, les sources de courant des circuits ouverts, exactement ce que font leurs contributions MNA avec une valeur nulle), un courant de test de 1 A est injecté dans `a` et prélevé en `b`, et `V(a) − V(b)` est la sortie.

- **Équivalents R / L / C** : la forme de `Z(s)` est vérifiée : constante (R), `1/(C·s)` (C), `L·s` (L) ; sinon `NOT_HOMOGENEOUS` est levée, sauf si `mode: "dc"` (Z(0)) ou `mode: "freq"` (valeur du composant équivalent à une fréquence) est demandé.
- **Thévenin :** `Vth` est la tension à vide (point de fonctionnement continu ou phaseur AC), `Zth = Z(a, b)` ; Norton en découle avec `In = Vth / Zth`. Le transfert de puissance maximal utilise `R = Rth` (continu) ou l'adaptation conjuguée `Z = Zth*` (AC, `P = |Vth|² / 8·Re Zth` pour des phaseurs en amplitude crête).
- **Impédance d'entrée** : pour une source de tension, c'est `−V / I(V)` (convention de courant SPICE) ; pour une source de courant, l'impédance entre ses bornes.

## Domaine temporel

L'**analyse transitoire** intègre `C·x' + G·x = b(t)` avec un pas fixe `h`. Le premier pas utilise Euler implicite, les suivants la méthode choisie :

| méthode              | mise à jour                                        | remarques                                                                 |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| `gear2` (par défaut) | `(3/2h·C + G)·xₙ₊₁ = bₙ₊₁ + C·(4xₙ − xₙ₋₁)/2h`     | ordre 2, L-stable : pas d'oscillations parasites après les discontinuités |
| `trap`               | `(C/h + G/2)·xₙ₊₁ = (bₙ₊₁ + bₙ − G·xₙ)/2 + C·xₙ/h` | ordre 2, conserve l'énergie des circuits LC sans pertes                   |
| `euler`              | `(C/h + G)·xₙ₊₁ = bₙ₊₁ + C·xₙ/h`                   | ordre 1, fortement amorti                                                 |

La matrice du pas est factorisée une seule fois. L'état initial est le point de fonctionnement continu avec les sources à `t = 0`, ou, avec des conditions initiales, les charges `C·x(0)` construites à partir des valeurs `IC=` ; des inconnues algébriques cohérentes sont ensuite obtenues par un pas d'Euler implicite infinitésimal. Les courants des condensateurs et les tensions des bobines utilisent la dérivée `x'`, estimée par des différences finies arrière d'ordre 2.

Les **réponses d'une fonction de transfert** (`stepResponse`, `impulseResponse`, `response`) sont exactes : `H(s)` est transformée en représentation d'état sous forme canonique commandable (avec un changement d'échelle de temps par `σ`, la moyenne géométrique des modules des pôles, pour le conditionnement), discrétisée par l'exponentielle de matrice de la matrice augmentée `[[A, B], [0, 0]]·h` (scaling and squaring, Padé 13 — Higham 2005). Les entrées sont maintenues constantes sur un pas, si bien que les échelons et les entrées constantes par morceaux sont exacts, et que les entrées régulières ont une erreur en `O(h)`.

## Fonctions de transfert symboliques

`src/symbolic` reconstruit la matrice MNA avec des coefficients qui sont des polynômes multivariés creux (`MPoly`) en `s` et en une variable par composant littéral. Les résistances interviennent via une conductance cachée `G = 1/R`, afin que toutes les contributions restent polynomiales.

- **Déterminant.** `det(A)` est calculé par développement de Laplace selon les lignes (les plus creuses d'abord), mémoïsé sur l'ensemble des colonnes déjà utilisées. Il est exact, ne nécessite aucune division (contrairement à Bareiss, qui exigerait une division multivariée exacte) et est rapide sur les matrices MNA très creuses. Un garde-fou rejette les circuits dont le développement exploserait (gardez moins de symboles avec l'option `symbols`).
- **Numérateur.** Avec `A·x = b·u` et une sortie `y = f·x`, le déterminant bordé donne `det([[A, b], [f, 0]]) = −det(A)·f·A⁻¹·b`, donc `N = −det([[A, b], [f, 0]])` et `H = N / det(A)` sans rien résoudre.
- **Conductances.** Chaque `G` apparaît avec une puissance bornée `e` (1 pour une résistance) ; `N` et `D` sont tous deux multipliés par `R^e` et `G^k` est remplacé par `R^{e−k}`.
- **Simplification.** Les monômes communs et les facteurs entiers sont éliminés et le signe de `D` est fixé ; un terme constant purement numérique de `D` est ramené à 1. Le LaTeX regroupe les termes par puissance de `s` et met en facteur le monôme commun de chaque groupe : `C_{2} \left(R_{1} + R_{2}\right) s`.

La suite de tests vérifie chaque expression par rapport au moteur numérique en substituant les valeurs des composants.

## Placement des schémas

`src/render` dessine un circuit sans aucune dépendance externe, en trois étapes.

**1. Placement (`layout.ts`).** Les nœuds (masse exclue) reçoivent une colonne et une ligne sur une grille grossière :

- un parcours en largeur depuis le nœud chaud de la première source reliée à la masse oriente chaque branche dipolaire de gauche à droite ; les entrées des amplificateurs opérationnels pointent toujours vers leur sortie. Les cycles sont rompus par un tri topologique de Kahn ;
- la colonne d'un nœud vaut un de plus que celle du plus éloigné de ses prédécesseurs (du plus proche pour les branches ordinaires, afin que les chemins parallèles restent compacts) ; les sous-circuits non connectés sont placés côte à côte ;
- les lignes sont ordonnées selon le barycentre des lignes des prédécesseurs (entrées inverseuses des amplificateurs opérationnels en haut), et la sortie d'un amplificateur opérationnel est alignée sur ses entrées afin que le fil d'entrée reste droit ;
- chaque colonne est élargie selon le nombre d'éléments en dérivation qu'elle porte.

Les composants sont ensuite placés par ordre de priorité, chacun prenant la première position candidate dont l'emprise (corps, textes et broches) est libre : amplificateurs opérationnels, éléments en dérivation (verticaux, avec leur propre symbole de masse, sources d'abord), éléments en série entre colonnes adjacentes (horizontaux), branches internes à une colonne (verticales) et branches longues ou de contre-réaction (au-dessus du circuit).

**2. Routage (`router.ts`).** Les fils sont routés sur la grille unitaire par une recherche A* sur des états (sommet, direction d'arrivée), afin de pouvoir pénaliser les coudes (pas 1, coude 4, croisement 8, proximité d'un texte 6). Les corps des composants sont des obstacles infranchissables. Entre équipotentielles différentes, le routeur interdit les segments partagés et tout contact sur une broche, un coude ou une jonction ; seuls les croisements perpendiculaires francs sont autorisés. Chaque équipotentielle est construite comme un arbre de Steiner rectilinéaire : à partir de son point d'ancrage (ou d'une broche), la broche non connectée la plus proche est routée vers l'arbre existant. Les équipotentielles sont routées de la plus courte à la plus longue. S'il n'existe aucun chemin valide, la recherche est relancée en remplaçant chaque mouvement interdit par une forte pénalité, si bien que le routage n'échoue jamais. Les tronçons pendants sont élagués et les arêtes unitaires fusionnées en segments maximaux ; un point de jonction est dessiné là où se rejoignent trois extrémités de fil ou plus.

**Masse.** Avec `ground: "rail"`, la masse devient une équipotentielle comme les autres, routée en premier : une ligne horizontale une case sous tout ce qui est placé, de la broche de masse la plus à gauche à la plus à droite, puis une descente par broche reliée à la masse (droite quand la colonne est libre, par A* sinon), avec un seul symbole de masse sous la ligne. `"auto"` ne construit la ligne que s'il y a au moins deux broches reliées à la masse et que chaque descente est droite et ne touche ni corps, ni broche, ni texte, ni autre fil ; sinon il revient à un symbole par broche. Les cases sous chaque broche reliée à la masse sont réservées pendant le placement dans les deux modes, si bien que le placement ne dépend pas de ce choix.

**3. Rendu (`svg.ts`).** Les symboles sont dessinés dans un repère local puis tournés en place ; des variantes CEI et ANSI sont disponibles. Les couleurs sont des variables CSS avec une variante sombre `prefers-color-scheme`, et chaque élément porte des attributs `data-*` pour l'interactivité.

La suite de tests vérifie, pour des circuits de référence et des netlists aléatoires, que chaque équipotentielle est connexe, que deux équipotentielles ne partagent jamais de segment ni ne se touchent, et qu'aucun fil ne traverse le corps d'un composant.

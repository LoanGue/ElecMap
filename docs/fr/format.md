# Formats de circuit

ElecMap accepte deux entrées, toutes deux transformées en un **circuit compilé** unique par `compile()` :

1. une **netlist SPICE**, le format texte standard de l'industrie ;
2. le **format JSON canonique**, un document typé et lisible par machine, qui est aussi la forme sous laquelle ElecMap stocke les circuits en interne.

```ts
import { compile } from "elecmap";

const circuit = compile(`
V1 in 0 AC 1
R1 in out 1k
C1 out 0 100n
`);

circuit.nodes; // ["in", "out"]
circuit.toJSON(); // JSON canonique
circuit.toSpice(); // de nouveau une netlist
```

Une chaîne commençant par `{` est analysée comme du JSON, toute autre chaîne comme du SPICE. Un objet JavaScript est traité comme un document JSON.

## Netlist SPICE

### Valeurs

Les nombres acceptent les suffixes d'échelle SPICE (insensibles à la casse). Les lettres d'unité finales sont ignorées.

| Suffixe | Facteur | Suffixe  | Facteur |
| ------- | ------- | -------- | ------- |
| `T`     | 10¹²    | `m`      | 10⁻³    |
| `G`     | 10⁹     | `u`, `µ` | 10⁻⁶    |
| `MEG`   | 10⁶     | `n`      | 10⁻⁹    |
| `k`     | 10³     | `p`      | 10⁻¹²   |
| `mil`   | 25,4 µm | `f`      | 10⁻¹⁵   |

Exemples : `1k`, `4.7u`, `100nF`, `1e-3`, `2MEG`. La notation européenne est également prise en charge : `4k7` = 4,7 kΩ, `1R5` = 1,5 Ω, `2u2` = 2,2 µ.

> ⚠️ Comme dans SPICE, `M` signifie **milli** (utilisez `MEG` pour méga) et `F` signifie **femto** : écrivez `100nF`, pas `100F`.

### Éléments

| Ligne                                                                | Composant                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `Rname n1 n2 value`                                                  | résistance (Ω)                                                           |
| `Cname n1 n2 value [IC=v]`                                           | condensateur (F), tension initiale                                       |
| `Lname n1 n2 value [IC=i]`                                           | bobine (H), courant initial                                              |
| `Vname n+ n- [DC v] [AC mag [phase]] [wave]`                         | source de tension indépendante                                           |
| `Iname n+ n- [DC i] [AC mag [phase]] [wave]`                         | source de courant indépendante                                           |
| `Ename n+ n- nc+ nc- gain`                                           | source de tension commandée en tension                                   |
| `Gname n+ n- nc+ nc- gm`                                             | source de courant commandée en tension                                   |
| `Fname n+ n- Vctrl gain`                                             | source de courant commandée en courant                                   |
| `Hname n+ n- Vctrl r`                                                | source de tension commandée en courant                                   |
| `Bname n+ n- V=expr` / `I=expr`                                      | source comportementale (voir [guide](./behavioral-sources.md))           |
| `Kname L1 L2 k`                                                      | bobines couplées, `0 < k ≤ 1`                                            |
| `Xname in+ in- out OPAMP [GAIN=a] [GBW=f] [VSAT=v \| VPOS=v VNEG=v]` | amplificateur opérationnel _(extension ElecMap)_                         |
| `Xname node… NAME [K=v…]`                                            | instance de sous-circuit (voir [plus bas](#sous-circuits-et-paramètres)) |
| `Sname n1 n2 ON\|OFF [RON=r] [ROFF=r]`                               | interrupteur à état fixe _(extension ElecMap)_                           |
| `Dname anode cathode [model] [area] [K=v…]`                          | diode, Zener (voir [diodes](./diodes.md))                                |
| `.model name D(IS=… N=… RS=… BV=…)`                                  | carte de modèle de diode                                                 |
| `Qname c b e [sub] [model] [area] [K=v…]`                            | transistor bipolaire (voir [transistors](./transistors.md))              |
| `Mname d g s [b] model [W=w] [L=l] [K=v…]`                           | MOSFET, substrat relié à la source s'il est omis                         |
| `.model name NPN                                                     | PNP(IS=… BF=… VAF=…)`                                                    | carte de modèle bipolaire         |
| `.model name NMOS                                                    | PMOS(VTO=… KP=… LAMBDA=…)`                                               | carte de modèle MOSFET (niveau 1) |

Un nombre seul après les nœuds d'une source est sa valeur continue (`V1 a 0 5`). Les phases sont en degrés.

**Formes d'onde** (analyse transitoire) : `SIN(offset amplitude freq [delay [damping [phase]]])`, `PULSE(v1 v2 [delay rise fall width period])`, `PWL(t1 v1 t2 v2 …)`, `EXP(v1 v2 [td1 tau1 td2 tau2])`, `STEP(v1 v2 [delay])` _(extension)_. Les virgules et un espace avant `(` sont autorisés.

### Syntaxe

- `*` en début de ligne commence un commentaire ; `;` et `$` commencent des commentaires en fin de ligne.
- Une ligne commençant par `+` prolonge la ligne précédente.
- **Ligne de titre :** en SPICE classique, la première ligne est toujours un titre. ElecMap la détecte automatiquement : la première ligne n'est un titre que si elle ne s'analyse pas comme un élément. Forcez ce comportement avec `compile(src, { spice: { titleLine: true } })`, ou utilisez `.title My circuit`.
- `.end` arrête l'analyse. Les autres directives (`.ac`, `.tran`, `.op`…) sont ignorées et signalées dans `circuit.parserWarnings`.
- Le nœud de masse est `0` ; `gnd` et `GND` en sont des alias. Utilisez `compile(src, { ground: "ref" })` pour choisir un autre nom.

### Sous-circuits et paramètres

Un bloc `.subckt` définit un circuit réutilisable ; chaque ligne `X` en place une copie. Les paramètres s'écrivent `{expression}` dans les valeurs des éléments :

```ts
const c = new ElecMap(`
* Deux étages Sallen-Key : un passe-bas de Butterworth d'ordre 4
.param FC=1k R=10k
.subckt SK in out PARAMS: Q=0.7071
R1 in a {R}
R2 a b {R}
C1 a out {2*Q/(2*pi*FC*R)}
C2 b 0 {1/(2*Q*2*pi*FC*R)}
XU b out out OPAMP
.ends SK
V1 in 0 AC 1
X1 in mid SK Q=0.5412
X2 mid out SK Q=1.3066
`);

c.components().map((x) => x.id);
// ["V1", "X1.R1", "X1.R2", "X1.C1", "X1.C2", "X1.XU",
//        "X2.R1", "X2.R2", "X2.C1", "X2.C2", "X2.XU"]
c.nodes(); // ["in", "X1.a", "X1.b", "mid", "X2.a", "X2.b", "out"]
c.components().find((x) => x.id === "X1.C1")?.value; // 1,7227e-8 F = 2·0,5412 / (2π · 1 kHz · 10 kΩ)

const H = c.transferFunction({ input: "V1", output: "out" });
H.order; // 4
H.cutoffFrequency(); // 1000,0 Hz
20 * Math.log10(H.evaluate(2000).abs()); // -24,1 dB  (ordre 4 : -24 dB par octave)
```

- **Définition :** `.subckt NOM port… [PARAMS:] [K=défaut…]` … `.ends [NOM]`. Les blocs peuvent apparaître n'importe où, avant ou après leur utilisation. Un `.subckt` à l'intérieur d'un autre n'est pas autorisé, mais un sous-circuit peut instancier d'autres sous-circuits (lignes `X` dans le corps).
- **Instance :** `Xnom nœud… NOM [K=valeur…]`, avec un nœud par port. Les valeurs de l'instance remplacent les valeurs par défaut ; elles sont évaluées dans la portée de l'appelant, donc `R={2*RBASE}` peut utiliser un paramètre global.
- **Mise à plat :** le circuit est développé à la lecture. Dans `X1`, l'élément `R1` devient `X1.R1` et le nœud interne `a` devient `X1.a` ; les ports sont remplacés par les nœuds de l'instance, et la masse (`0`, `gnd`) reste globale. Les références à d'autres éléments du bloc (sources de commande de `F`/`H`, inductances de `K`) sont renommées de la même façon. Chaque élément peut alors être sondé : `c.voltage("X1.a")`, `c.current("X2.R1")`.
- **Paramètres :** `.param K=valeur…` définit des paramètres globaux. Les expressions acceptent les nombres avec suffixes SPICE (`1k`, `4k7`), `+ - * /`, `^` ou `**`, les parenthèses, `pi`, `e` et les fonctions `sqrt exp log ln log10 abs sin cos tan atan min max pow`. Les noms sont insensibles à la casse.
- Les cartes `.model` sont globales, même écrites dans un bloc. `X… OPAMP` reste l'AOP intégré.
- **Export :** `toSpice()` et `export("netlist")` écrivent le circuit mis à plat (`X1.R1 in X1.a 10k`), qui se relit tel quel : le type d'un élément est donné par la première lettre après le dernier `.`.

```json
{
  "version": 1,
  "title": "RC low-pass",
  "ground": "0",
  "components": [
    { "id": "V1", "type": "vsource", "nodes": ["in", "0"], "ac": { "mag": 1 } },
    { "id": "R1", "type": "resistor", "nodes": ["in", "out"], "value": 1000 },
    { "id": "C1", "type": "capacitor", "nodes": ["out", "0"], "value": 1e-7 }
  ]
}
```

- Toutes les valeurs sont de simples nombres en unités SI, les phases sont en degrés.
- `nodes` suit l'ordre des bornes de chaque type (voir [components.md](./components.md)).
- Les types TypeScript (`CircuitJSON`, `ComponentJSON`, …) et un JSON Schema (`CIRCUIT_SCHEMA`, draft 2020-12) sont exportés pour les éditeurs et les validateurs externes.

## Exporter et partager

`export(format)` écrit le circuit dans l'un des trois formats d'échange, et le constructeur sait tous les relire :

| Format      | `export` renvoie          | Usage                                                                         |
| ----------- | ------------------------- | ----------------------------------------------------------------------------- |
| `"json"`    | un objet `CircuitJSON`    | le document canonique, utilisé en interne                                     |
| `"netlist"` | du texte SPICE            | lisible par un humain et par d'autres simulateurs                             |
| `"base64"`  | un jeton sûr pour les URL | une seule chaîne sans espace, prête à être envoyée dans une URL ou un message |

```ts
const c = new ElecMap("V1 in 0 AC 1\nR1 in out 1k\nC1 out 0 100n");

const token = c.export("base64");
// "eyJ2ZXJzaW9uIjoxLCJjb21wb25lbnRzIjpbeyJpZCI6IlYxIiwidHlwZSI6InZzb3VyY2Ui…"
token.length; // 310    caractères [A-Za-z0-9_-], utilisable tel quel dans une URL

const copy = new ElecMap(token); // le format est détecté
copy.transferFunction({ input: "V1", output: "out" }).cutoffFrequency(); // 1591.5 Hz

c.export("netlist");
// * ElecMap circuit
// V1 in 0 AC 1
// R1 in out 1k
// C1 out 0 100n
// .end

c.export("json");
// { version: 1, components: [
//   { id: "V1", type: "vsource", nodes: ["in", "0"], ac: { mag: 1 } }, … ], ground: "0" }
```

Le format d'un texte est détecté : un texte commençant par `{` est du JSON, un seul mot sans espace est du base64, tout le reste est une netlist. On peut le fixer avec `format` :

```ts
new ElecMap(text, { format: "netlist" }); // une netlist, même si elle ressemble à autre chose
new ElecMap(token, { format: "base64" });
```

Le jeton base64 est le document JSON compact en UTF-8 : il transporte donc tout ce que porte le JSON. Toutes les conversions passent par le document JSON : lire une netlist, c'est netlist → JSON ; l'exporter en base64, c'est JSON → base64. Chaque format n'a donc besoin que d'un lecteur et d'un écrivain.

## Autres simulateurs : SPICE et LTspice

`export("netlist")` garde les extensions d'ElecMap (`OPAMP`, `STEP`, interrupteurs `ON`/`OFF`, paramètres de composants en ligne). Deux fonctions d'écriture les traduisent pour d'autres outils :

| Méthode       | Fichier | S'ouvre dans                                               |
| ------------- | ------- | ---------------------------------------------------------- |
| `toCir(opts)` | `.cir`  | LTspice, ngspice, KiCad (simulation par ngspice), PSpice   |
| `toAsc(opts)` | `.asc`  | LTspice, sous forme de schéma prêt à simuler et à modifier |

`opts.analysis` est l'analyse écrite à la fin, une ligne ou une liste de lignes (`".op"` par défaut), et `opts.idealGain` le gain en boucle ouverte donné aux AOP idéaux (10⁶ par défaut).

```ts
const amp = new ElecMap(`.title Non-inverting amplifier
V1 in 0 STEP(0 100m 1m) AC 1
R1 m 0 1k
R2 m out 9k
X1 in m out OPAMP
D1 out lim IS=1e-14
R3 lim 0 10k`);

amp.toCir({ analysis: [".ac dec 50 10 10meg", ".tran 3m"] });
// * Non-inverting amplifier
// V1 in 0 PWL(0 0 1m 0 1.000001m 100m) AC 1
// R1 m 0 1k
// R2 m out 9k
// EX1 out 0 in m 1meg
// D1 out lim DMOD
// R3 lim 0 10k
// .model DMOD D(IS=10f)
// .ac dec 50 10 10meg
// .tran 3m
// .end
```

Ce que `toCir` traduit :

- **Noms :** un élément commence par la lettre de ce qu'il devient (`X1` ci-dessus est une source `E`, `EX1`), les noms issus des sous-circuits perdent leurs points (`X1.R1` → `RX1_R1`), les nœuds gardent lettres, chiffres et `_`, et la masse est `0` (`gnd` compris). Les noms restent uniques, sans tenir compte de la casse.
- **AOP :** idéal → source commandée en tension de gain 10⁶ ; avec `GBW` → sous-circuit à un pôle (`OPAMP_X1`), même réponse que dans ElecMap ; avec rails → sous-circuit dont l'étage de gain est `B1 y 0 V=mid+half*tanh(…)`.
- **Interrupteurs :** fermé → source de 0 V (ou résistance `RON`), ouvert → résistance `ROFF`, ou rien si `ROFF` est infini.
- **Sources :** `STEP` → `PWL` avec une montée de 1 ns ; la forme d'onde précède `AC` (l'ordre qu'écrit LTspice).
- **Composants :** paramètres en ligne → une carte `.model` par jeu distinct (`DMOD`, `NPNMOD`…) ; les modèles nommés gardent leur nom, `W`/`L` restent sur la ligne du MOSFET.
- **Sources comportementales :** `^` → `**` (dans LTspice, `^` est le OU exclusif). Écrivez `if(c, a, b)` plutôt que `c ? a : b`, et `&&`/`||` plutôt que `&`/`|` : ngspice et LTspice diffèrent sur ces points. ngspice ne lit `I()` que pour une source de tension.

Le `.cir` se relit dans ElecMap avec les mêmes résultats : `new ElecMap(amp.toCir())` donne le même point de fonctionnement (à 10⁻⁴ près pour les AOP idéaux).

`toAsc` dessine le schéma de [`layout()`](./schematics.md) avec les symboles de LTspice, les mêmes éléments et valeurs que `toCir`, et place les cartes `.model` et l'analyse dans une directive :

```ts
const asc = amp.toAsc({ analysis: ".tran 3m" });
asc.split("\n").filter((l) => l.startsWith("SYMBOL"));
// ["SYMBOL voltage 0 464 R0", "SYMBOL res -16 80 R0", "SYMBOL res 144 -112 R270",
//  "SYMBOL Opamps\\opamp 192 -32 R0", "SYMBOL diode 512 16 R270", "SYMBOL res 688 80 R0"]
asc
  .split("\n")
  .filter((l) => l.startsWith("FLAG"))
  .map((l) => l.split(" ")[3]);
// ["in", "0", "m", "0", "out", "lim", "0"]    chaque nœud est nommé : tracez V(out) dans LTspice
asc.split("\n").at(-2);
// "TEXT -64 704 Left 2 !.model DMOD D(IS=10f)\\n.lib opamp.sub\\n.tran 3m"
```

- Les AOP utilisent le symbole et le modèle `opamp` de LTspice (`.lib opamp.sub`, `Aol` et `GBW` ; un AOP idéal reçoit `Aol=1meg GBW=1t`). Ce modèle n'a pas de rails : un AOP avec rails garde son sous-circuit `OPAMP_X1`.
- Les fils ne se touchent que par leurs extrémités. Le dessin est vérifié par rapport à la netlist avant d'être écrit, et un nœud que LTspice lirait autrement est relié par des étiquettes plutôt que par des fils.
- Les couplages `K` et les interrupteurs ouverts n'ont pas de symbole : ils sont écrits en directive et en commentaire.

Dans le [playground](https://loangue.github.io/ElecMap/playground/), les boutons **SPICE** et **LTspice** au-dessus du schéma téléchargent ces fichiers avec l'analyse de l'onglet ouvert.

## Validation

`compile()` exécute `validateCircuit()` et lève une `ElecMapError` de code `INVALID_CIRCUIT` si une erreur est trouvée. Chaque problème est listé dans `error.details.issues`, de sorte qu'une interface peut mettre en évidence le composant ou le nœud fautif. Les avertissements sont conservés dans `circuit.warnings`.

| Code                  | Gravité       | Signification                                                               |
| --------------------- | ------------- | --------------------------------------------------------------------------- |
| `MALFORMED`           | erreur        | Le document ou un composant n'a pas la bonne forme                          |
| `UNKNOWN_TYPE`        | erreur        | Type de composant non pris en charge                                        |
| `INVALID_NODES`       | erreur        | Nombre de nœuds incorrect                                                   |
| `INVALID_VALUE`       | erreur        | Valeur manquante, non finie ou hors limites                                 |
| `DUPLICATE_ID`        | erreur        | Deux composants partagent un identifiant                                    |
| `UNKNOWN_REFERENCE`   | erreur        | Source de commande, bobine couplée ou nœud de commande manquant             |
| `EMPTY_CIRCUIT`       | erreur        | Aucun composant                                                             |
| `NO_GROUND`           | erreur        | Rien n'est relié à la masse                                                 |
| `FLOATING_NODE`       | erreur        | Nœud sans aucun chemin vers la masse                                        |
| `VOLTAGE_SOURCE_LOOP` | erreur        | Maille constituée uniquement de sources de tension / courts-circuits idéaux |
| `NO_DC_PATH`          | avertissement | Nœud accessible uniquement à travers des condensateurs / sources de courant |
| `INDUCTOR_LOOP`       | avertissement | Maille de bobines et de sources de tension (singulière en continu)          |
| `SHORTED_COMPONENT`   | avertissement | Les deux bornes sur le même nœud                                            |
| `DANGLING_NODE`       | avertissement | Nœud relié à une seule borne                                                |

## Circuit compilé

`CompiledCircuit` est immuable (son document est gelé en profondeur) :

| Membre                                            | Description                                             |
| ------------------------------------------------- | ------------------------------------------------------- |
| `nodes`                                           | noms des nœuds hors masse, dans l'ordre des indices MNA |
| `nodeIndex(name)`                                 | indice d'un nœud, `-1` pour la masse                    |
| `hasNode(name)`, `isGround(name)`                 | recherche de nœuds (alias inclus)                       |
| `components`, `component(id)`, `hasComponent(id)` | recherche de composants                                 |
| `warnings`, `parserWarnings`                      | remarques non bloquantes                                |
| `toJSON()`, `toSpice()`                           | export (copie modifiable / netlist)                     |

<div class="em-hero">
<h1>ElecMap</h1>
<p class="em-tagline">Décrivez un circuit en quelques lignes de SPICE. Obtenez sa fonction de transfert, ses tensions, courants, impédances, sa réponse temporelle et son schéma, le tout depuis une seule classe TypeScript.</p>
<div class="em-buttons"><a class="em-button" href="./getting-started.md">Commencer →</a><span class="em-button em-ghost">{@link ElecMap | Référence de l'API}</span><a class="em-button em-ghost" href="https://github.com/LoanGue/ElecMap">GitHub</a></div>
</div>

## En 30 secondes

```ts
import { ElecMap } from "elecmap";

const filter = new ElecMap(`
V1 in 0 AC 1
R1 in out 1k
C1 out 0 100n
`);

const H = filter.transferFunction("out");
H.toLatex(); // "\frac{1}{1 + 10^{-4}\,s}"
H.filterType(); // "lowpass"
H.cutoffFrequency(); // 1591.55 (Hz)

filter.symbolicTransferFunction("out").toLatex(); // "\frac{1}{1 + R_{1} C_{1} s}"
filter.toSVG(); // le dessin ci-dessous
```

<div class="em-row">
<figure class="em-figure">
{@include ./figures/rc-lowpass.svg}
<figcaption><code>filter.toSVG({ showValues: true })</code></figcaption>
</figure>
<figure class="em-figure">
<div class="em-math">H(s) = \frac{1}{1 + R_{1} C_{1} s} = \frac{1}{1 + 10^{-4}\,s}</div>
<figcaption>Fonctions de transfert littérale et numérique, générées en LaTeX</figcaption>
</figure>
</div>

## Guides

Chaque guide est une suite de courts exemples exécutables, accompagnés de leur sortie réelle.

<div class="em-cards">
<a class="em-card" href="./getting-started.md"><span class="em-icon">🚀</span><strong>Premiers pas</strong><span>Installer, décrire un premier circuit, lire les résultats.</span></a>
<a class="em-card" href="./voltages-currents-power.md"><span class="em-icon">🔋</span><strong>Tensions, courants et puissance</strong><span>Point de fonctionnement continu, phaseurs AC, balayages, bilan de puissance.</span></a>
<a class="em-card" href="./transfer-functions.md"><span class="em-icon">📈</span><strong>Fonctions de transfert</strong><span>H(s) en LaTeX, diagrammes de Bode, pôles, coupure, Q, réponse à une sinusoïde.</span></a>
<a class="em-card" href="./literal-transfer-functions.md"><span class="em-icon">∑</span><strong>Fonctions de transfert littérales</strong><span>H(s) écrite avec R₁, C₂… et réévaluée avec de nouvelles valeurs.</span></a>
<a class="em-card" href="./impedances-equivalents.md"><span class="em-icon">Ω</span><strong>Impédances et équivalents</strong><span>R, L, C équivalents, Z(s), Thévenin et Norton.</span></a>
<a class="em-card" href="./time-domain.md"><span class="em-icon">⏱</span><strong>Domaine temporel</strong><span>Réponses indicielle et impulsionnelle, simulation transitoire.</span></a>
<a class="em-card" href="./diodes.md"><span class="em-icon">▷|</span><strong>Diodes</strong><span>Circuits non linéaires : redresseurs, régulateurs Zener, petits signaux.</span></a>
<a class="em-card" href="./transistors.md"><span class="em-icon">⏚</span><strong>Transistors</strong><span>Bipolaires et MOSFET : polarisation, amplificateurs, logique CMOS.</span></a>
<a class="em-card" href="./sensitivities.md"><span class="em-icon">∂</span><strong>Sensibilités</strong><span>Quel composant compte : dérivées, classement, stabilité de polarisation.</span></a>
<a class="em-card" href="./schematics.md"><span class="em-icon">✏️</span><strong>Schémas</strong><span>Dessins SVG automatiques, CEI ou ANSI, interactifs.</span></a>
<a class="em-card" href="./format.md"><span class="em-icon">📄</span><strong>Netlists et JSON</strong><span>Syntaxe d'entrée, format JSON, erreurs de validation.</span></a>
</div>

## Ce qu'il contient

| Vous voulez…                                              | Appel                                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| une tension ou un courant                                 | {@link ElecMap.voltage}, {@link ElecMap.current}                                                        |
| H(s), en nombres ou en symboles                           | {@link ElecMap.transferFunction}, {@link ElecMap.symbolicTransferFunction}                              |
| un diagramme de Bode, des pôles, une fréquence de coupure | {@link TransferFunction.bode}, {@link TransferFunction.poles}, {@link TransferFunction.cutoffFrequency} |
| un R, L, C ou Z équivalent                                | {@link ElecMap.equivalentResistance}, {@link ElecMap.impedance}                                         |
| Thévenin / Norton                                         | {@link ElecMap.thevenin}, {@link ElecMap.norton}                                                        |
| la réponse au cours du temps                              | {@link TransferFunction.stepResponse}, {@link ElecMap.transient}                                        |
| un dessin                                                 | {@link ElecMap.toSVG}                                                                                   |

ElecMap n'a **aucune dépendance à l'exécution**, est distribué en ESM + CommonJS avec des types complets, et fonctionne sous Node.js ≥ 18 et dans les navigateurs. Composants : R, L, C, bobines couplées, sources de tension et de courant, sources commandées (E, F, G, H), amplificateurs opérationnels (idéal, gain fini, GBW), interrupteurs, diodes / diodes Zener, transistors bipolaires et MOSFET avec cartes `.model` SPICE.

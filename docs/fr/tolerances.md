---
title: Tolérances (Monte-Carlo)
category: Guides
---

# Tolérances (Monte-Carlo)

Une résistance de 1 kΩ vendue à ±5 % vaut quelque part entre 950 Ω et 1050 Ω. `monteCarlo` construit de nombreuses copies du circuit, chacune avec ses composants tirés au hasard dans leur tolérance, pour voir la dispersion du circuit réel : la plage d'une fréquence de coupure, l'enveloppe d'un diagramme de Bode, le rendement d'un réseau de polarisation.

Là où les {@link ElecMap.sensitivity | sensibilités} donnent la pente autour du point nominal, le Monte-Carlo donne la dispersion réelle, avec toutes les tolérances à la fois et sans linéariser.

## Une première analyse

```ts
import { ElecMap } from "elecmap";

const rc = new ElecMap(`
V1 in 0 DC 5 AC 1
R1 in out 1k
C1 out 0 100n
`);

const mc = rc.monteCarlo({ tolerances: { R1: 0.05, C1: 0.1 }, runs: 200 });
mc.length; // 200
mc.samples[0]; // { run: 0, values: { R1: 1012.7, C1: 9.005e-8 } }
mc.samples[1].values; // { R1: 1002.7, C1: 1.096e-7 }
```

`tolerances` donne une tolérance relative par composant : `0.05` vaut ±5 %. Le champ qui varie est celui de {@link ElecMap.setValue | `setValue`} (`value` pour R, L, C, `dc` pour une source, `bf` pour un bipolaire…). `samples` liste les valeurs tirées à chaque tirage. Le circuit `rc` lui-même n'est pas modifié.

## Statistiques d'une grandeur quelconque

`statistics(mesure)` calcule une grandeur sur le circuit nominal et sur chaque tirage :

```ts
const fc = mc.statistics((c) => c.transferFunction("out").cutoffFrequency());
fc.nominal; // 1591.5 Hz
fc.mean; // 1608.1
fc.std; // 108.1
[fc.min, fc.max]; // [1390.7, 1835.6]
[fc.percentile(0.05), fc.percentile(0.95)]; // [1440.7, 1781.3]   90 % des circuits
fc.values; // les 200 valeurs, une par tirage
```

<figure class="em-figure">
{@include ./figures/tolerance-fc.svg}
<figcaption>Fréquence de coupure de 200 filtres RC avec R ±5 % et C ±10 %. Le trait pointillé est la valeur nominale.</figcaption>
</figure>

Le pire cas est R et C tous deux au plus bas ou tous deux au plus haut : 1378 Hz et 1861 Hz. Les 200 tirages s'en approchent (1391 Hz et 1836 Hz), mais 90 % des circuits restent entre 1441 Hz et 1781 Hz.

La mesure peut être n'importe quoi de calculé sur un circuit : une tension, un courant, un gain, une puissance, une constante de temps. Un tirage où elle renvoie `undefined` (pas de fréquence de coupure, par exemple) compte comme `NaN` dans `values` et n'entre pas dans les statistiques.

## Enveloppe de Bode

`bode(sortie)` trace le diagramme de Bode de chaque tirage, sur la grille de fréquences du circuit nominal, et son enveloppe point par point. Ici, un passe-bas de Sallen-Key à gain unité avec des résistances à 5 % et des condensateurs à 10 % :

```ts
const sk = new ElecMap(`
V1 in 0 AC 1
R1 in a 10k
R2 a b 10k
C1 a out 22n
C2 b 0 10n
XU b out out OPAMP
`);
const tol = sk.monteCarlo({
  tolerances: { R1: 0.05, R2: 0.05, C1: 0.1, C2: 0.1 },
  runs: 200,
});

const bode = tol.bode("out", { fStart: 100, fStop: 10e3, points: 20 });
bode.freq; // 41 fréquences, de 100 Hz à 10 kHz
bode.nominal.magnitudeDb; // Bode du circuit nominal
bode.runs; // 200 diagrammes de Bode, un par tirage

// À 1 kHz (indice 20) :
bode.nominal.magnitudeDb[20]; // -2.03 dB
[bode.magnitudeDb.min[20], bode.magnitudeDb.max[20]]; // [-3.06, -0.99]
[bode.phase.min[20], bode.phase.max[20]]; // [-93.6, -75.1] °
bode.magnitudeDb.mean; // courbe moyenne ; aussi .std
```

<figure class="em-figure">
{@include ./figures/tolerance-bode.svg}
<figcaption>Enveloppe du diagramme de Bode de 200 filtres de Sallen-Key : autour de f₀, le gain varie de ±1 dB.</figcaption>
</figure>

Combinez-le avec les méthodes de {@link TransferFunction} pour suivre les paramètres du filtre :

```ts
const f0 = tol.statistics((c) => c.transferFunction("out").naturalFrequency());
const q = tol.statistics((c) => c.transferFunction("out").qFactor());
[f0.min, f0.max]; // [959.5, 1189.7] Hz   nominal 1073.0
[q.min, q.max]; // [0.683, 0.816]       nominal 0.742
```

## Lois de tirage et graine

Par défaut, toutes les valeurs de l'intervalle de tolérance sont équiprobables (`"uniform"`). Avec `distribution: "gaussian"`, les valeurs suivent une loi normale de σ = tolérance / 3 : 99,7 % d'entre elles tombent dans la tolérance, comme pour des composants triés d'un lot de production. Les quelques valeurs au-delà sont conservées.

```ts
const g = rc
  .monteCarlo({ tolerances: { R1: 0.05, C1: 0.1 }, runs: 200, distribution: "gaussian" })
  .statistics((c) => c.transferFunction("out").cutoffFrequency());
g.std; // 61.6 Hz   (108.1 Hz avec des tolérances uniformes)
[g.min, g.max]; // [1443.4, 1781.5]
```

<figure class="em-figure">
{@include ./figures/tolerance-distributions.svg}
<figcaption>Le même filtre avec des tolérances uniformes et gaussiennes : la dispersion gaussienne est plus étroite et centrée sur la valeur nominale.</figcaption>
</figure>

Chaque composant peut avoir sa propre loi. Les tirages viennent d'un générateur à graine : la même `seed` (1 par défaut) donne toujours les mêmes tirages, les résultats sont donc reproductibles. Changez-la pour tirer un autre lot.

```ts
rc.monteCarlo({
  tolerances: {
    R1: 0.01, // résistance à 1 %, uniforme
    C1: { tolerance: 0.2, distribution: "gaussian" }, // condensateur à 20 %
  },
  runs: 3,
  seed: 42,
}).samples.map((s) => s.values);
// [{ R1: 1002.0, C1: 1.044e-7 }, { R1: 1003.4, C1: 9.592e-8 }, { R1: 995.5, C1: 1.062e-7 }]
```

## Autres champs : gain d'un transistor

Utilisez `"id.champ"` pour faire varier un autre champ que celui par défaut. Le β (`bf`) varie beaucoup d'un transistor à l'autre : ±50 % autour de 200 est courant. La polarisation à quatre résistances du [guide des transistors](./transistors.md#un-étage-émetteur-commun) est conçue pour l'absorber :

```ts
const bias = new ElecMap(`
VCC vcc 0 12
RB1 vcc b 47k
RB2 b 0 10k
RC vcc c 2.2k
RE e 0 470
Q1 c b e QN
.model QN NPN(BF=200 IS=1e-14)
`);
const ic = bias
  .monteCarlo({ tolerances: { "Q1.bf": 0.5 }, runs: 100 })
  .statistics((c) => c.current("RC") * 1e3);
[ic.min, ic.nominal, ic.max]; // [2.561, 2.772, 2.851] mA

// Les mêmes transistors avec un courant de base fixe (1,2 MΩ de VCC à la base) :
// [0.951, 1.888, 2.820] mA
```

<figure class="em-figure">
{@include ./figures/tolerance-bias.svg}
<figcaption>Courant collecteur de 100 étages avec β = 200 ± 50 %. Avec le pont et RE, Ic reste entre −8 % et +3 % ; avec un courant de base fixe, il suit β.</figcaption>
</figure>

Des tolérances sur toutes les pièces donnent la dispersion réelle en production :

```ts
const all = bias.monteCarlo({
  tolerances: { RB1: 0.05, RB2: 0.05, RC: 0.05, RE: 0.05, "Q1.bf": 0.5 },
  runs: 200,
});
const icAll = all.statistics((c) => c.current("RC") * 1e3);
const vc = all.statistics((c) => c.voltage("c"));
[icAll.min, icAll.max]; // [2.386, 3.163] mA
[vc.min, vc.max]; // [4.83, 6.97] V    nominal 5,90 V : l'étage ne sature jamais
```

## Utiliser directement les tirages

`circuit(i)` renvoie le circuit du tirage `i`, un {@link ElecMap} complet sur lequel toutes les analyses sont disponibles. `circuits()` les renvoie tous, et `nominal` est le circuit d'origine.

```ts
const worst = fc.values.indexOf(fc.min);
mc.circuit(worst)
  .components()
  .find((c) => c.id === "R1"); // { id: "R1", value: 1041.0, … }   C1 = 109.9 nF
mc.circuit(worst).transient({ tStop: 5e-3, tStep: 1e-5 }); // n'importe quelle analyse
```

## Comment c'est calculé

Pour chaque tirage et chaque champ tolérancé de valeur nominale `p`, ElecMap tire un écart `d` et utilise `p · (1 + t · d)` :

- uniforme : `d` uniforme dans [−1, 1] ;
- gaussienne : `d` normal de σ = 1/3 (transformation de Box-Muller).

Les nombres aléatoires viennent de mulberry32, un petit générateur 32 bits initialisé par `seed`. Les tirages sont faits à l'appel de `monteCarlo`, mais chaque circuit n'est compilé que lorsqu'une analyse en a besoin, puis conservé : tirer 10 000 circuits est instantané, et chaque tirage coûte ensuite une analyse. Sur le filtre RC ci-dessus, 200 fréquences de coupure prennent environ 0,1 s, et les 200 diagrammes de Bode du Sallen-Key environ 0,07 s.

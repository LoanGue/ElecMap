---
title: Sensibilités
category: Guides
---

# Sensibilités

Quel composant compte ? `sensitivity(sortie, id)` indique de combien une sortie bouge quand un composant change. `sensitivities(sortie)` pose la question pour tous les composants à la fois et les classe. Elles servent à choisir des tolérances, trouver le composant à ajuster, ou vérifier qu'un montage ne dépend pas d'un paramètre mal maîtrisé comme le β d'un transistor.

## Un composant

```ts
import { ElecMap } from "elecmap";

const divider = new ElecMap(`
V1 in 0 10
R1 in out 1k
R2 out 0 3k
`);

divider.sensitivity("out", "R1");
// {
//   id: "R1", field: "value", value: 1000,
//   output: 7.5,             V(out)
//   derivative: -0.001875,   ∂V(out)/∂R1 en V/Ω : +1 Ω sur R1 → −1,875 mV
//   normalized: -0.25,       +1 % sur R1 → −0,25 % sur V(out)
// }
```

`derivative` est la sensibilité absolue `∂y/∂p`, en unité de sortie par unité du composant. `normalized` est la sensibilité relative, `(p/y)·∂y/∂p` : la variation en pourcentage de la sortie pour 1 % de variation du composant. Elle n'a pas d'unité, ce qui permet de comparer des composants de natures différentes. Une sensibilité normalisée de 1 signifie « proportionnel », et −1 « inversement proportionnel ».

La sortie peut être une tension de nœud, une tension entre deux nœuds ou un courant :

```ts
divider.sensitivity(["in", "out"], "R1").normalized; // 0.75
divider.sensitivity({ current: "R2" }, "R2").derivative; // -6.25e-7 A/Ω
divider.sensitivity("out", "V1").normalized; // 1   (champ "dc" de la source)
```

Le champ qui varie est celui de {@link ElecMap.setValue | `setValue`} : `value` pour R, L, C, `dc` pour les sources, `gain` pour les sources commandées, `is` pour une diode, `bf` pour un BJT, `w` pour un MOSFET. Choisissez-en un autre avec `field` :

```ts
const amp = new ElecMap(`
V1 in 0 1
R1 in 0 1k
E1 out 0 in 0 4
R2 out 0 1k
`);
amp.sensitivity("out", "E1", { field: "gain" }).derivative; // 1   ∂V(out)/∂gain = V(in)
```

## Tous les composants, classés

`sensitivities(sortie)` renvoie une entrée par composant ayant une valeur, triée par `|normalized|` décroissant :

```ts
const loaded = new ElecMap(`
V1 in 0 10
R1 in out 1k
R2 out 0 3k
R3 out 0 6k
`);

loaded.sensitivities("out").map((s) => [s.id, s.normalized]);
// [["V1", 1], ["R1", -0.3333], ["R2", 0.2222], ["R3", 0.1111]]
```

R2 ∥ R3 = 2 kΩ, donc V(out) = 10 V · 2k / 3k. R1 a le plus d'effet, et R3, la plus grande des deux résistances en parallèle, en a le moins. Les AOP idéaux (sans gain) sont ignorés. Une sortie nulle donne `normalized: NaN`, et ces entrées sont placées en dernier.

## À une fréquence

Avec `at: { freq }`, la sortie est l'**amplitude** du phaseur :

```ts
const rc = new ElecMap(`
V1 in 0 DC 5 AC 1
R1 in out 1k
C1 out 0 100n
`);

const s = rc.sensitivity("out", "C1", { at: { freq: 1000 } });
s.output; // 0.8467   |V(out)| à 1 kHz
s.normalized; // -0.2830  = −(ωRC)² / (1 + (ωRC)²)
rc.sensitivity("out", "C1").derivative; // 0   en continu, le condensateur est ouvert
```

## N'importe quelle grandeur

La sortie peut aussi être une fonction qui calcule un nombre quelconque à partir du circuit : une fréquence de coupure, un facteur de qualité, un gain ou une puissance. La fonction reçoit une copie modifiée du circuit :

```ts
const fc = (c: ElecMap) => c.transferFunction("out").cutoffFrequency();
rc.sensitivity(fc, "R1").normalized; // -1   fc = 1/(2πRC)
rc.sensitivity(fc, "C1").normalized; // -1
```

Un passe-bas Sallen-Key à gain unitaire montre le résultat classique : f₀ dépend de chaque composant avec un exposant −½, alors que Q ne dépend que du rapport des condensateurs :

```ts
const sk = new ElecMap(`
V1 in 0 AC 1
R1 in a 10k
R2 a b 10k
C1 a out 22n
C2 b 0 10n
XU b out out OPAMP
`);
const f0 = (c: ElecMap) => c.transferFunction("out").naturalFrequency();
const q = (c: ElecMap) => c.transferFunction("out").qFactor();

f0(sk); // 1073,0 Hz
q(sk); // 0,7416
for (const id of ["R1", "R2", "C1", "C2"]) {
  [sk.sensitivity(f0, id).normalized, sk.sensitivity(q, id).normalized];
}
// R1 : [-0.5, ≈0]   R2 : [-0.5, ≈0]   C1 : [-0.5, 0.5]   C2 : [-0.5, -0.5]
```

Conséquence : avec des résistances égales, une tolérance de 5 % sur les résistances déplace f₀ de 2,5 % mais ne change pas Q.

## Circuits non linéaires : stabilité de la polarisation

Les sensibilités fonctionnent aussi sur les circuits non linéaires : chaque évaluation recalcule le point de fonctionnement. Elles montrent pourquoi la polarisation à quatre résistances du [guide des transistors](./transistors.md#un-étage-émetteur-commun) est partout :

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

bias.current("RC"); // 2,772 mA   courant de collecteur
bias.sensitivities({ current: "RC" }).map((s) => [s.id, s.field, s.normalized]);
// [["VCC", "dc", 1.452], ["RB1", "value", -1.211], ["RB2", "value", 1.132],
//  ["RE", "value", -0.903], ["Q1", "bf", 0.0833], ["RC", "value", ≈0]]
```

<figure class="em-figure">
{@include ./figures/bias-sensitivities.svg}
<figcaption>Sensibilités normalisées du courant de collecteur. Les résistances et l'alimentation fixent Ic, et β compte à peine.</figcaption>
</figure>

Une variation de 1 % de β ne déplace Ic que de 0,083 %, car le pont et RE imposent le courant. Avec un courant de base fixe (une seule résistance de 1,2 MΩ entre VCC et la base, émetteur à la masse), Ic est proportionnel à β :

```ts
const fixed = new ElecMap(`
VCC vcc 0 12
RB vcc b 1.2meg
RC vcc c 2.2k
Q1 c b e QN
VE e 0 0
.model QN NPN(BF=200 IS=1e-14)
`);
fixed.sensitivity({ current: "RC" }, "Q1").normalized; // 0.998

// β de 100 à 400 :
// pont + RE :             Ic 2,559 → 2,893 mA   (+13 %)
// courant de base fixe :  Ic 0,946 → 3,770 mA   (×4)
```

<figure class="em-figure">
{@include ./figures/bias-beta.svg}
<figcaption>Courant de collecteur en fonction de β pour les deux polarisations.</figcaption>
</figure>

La résistance de collecteur RC n'a pas d'effet sur Ic tant que le transistor reste en régime linéaire direct. Elle fixe en revanche la tension de collecteur : `bias.sensitivity("c", "RC").normalized` vaut −1,034.

## Méthode de calcul

La dérivée est calculée par différences centrées avec extrapolation de Richardson. ElecMap évalue la sortie en `p ± h` et `p ± h/2`, avec `h = 10⁻³·|p|` (ou 10⁻³ quand `p = 0`), puis combine les résultats : `(4·D(h/2) − D(h)) / 3`. L'erreur de troncature est d'ordre h⁴. Les résultats sont précis à environ 10 chiffres significatifs sur les circuits linéaires, et à la tolérance de convergence de Newton-Raphson (environ 6 chiffres) sur les circuits non linéaires.

Chaque sensibilité coûte quatre analyses d'une copie modifiée, et le circuit lui-même n'est pas modifié. `sensitivities` répète ce calcul pour chaque composant. Un paramètre de composant non renseigné (une diode sans `IS`) varie autour de sa valeur SPICE par défaut.

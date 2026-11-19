---
title: Diodes et circuits non linéaires
category: Guides
---

# Diodes et circuits non linéaires

Une diode rend le circuit non linéaire : les courants ne sont plus proportionnels aux sources. ElecMap résout alors le circuit par **Newton-Raphson**, comme SPICE, et toutes les analyses que vous connaissez continuent de fonctionner :

| Analyse                                               | Ce qui se passe avec une diode                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `operatingPoint()`, `voltage()`, `current()`          | solution continue non linéaire exacte                                       |
| `transient()`                                         | solution non linéaire exacte à chaque pas de temps                          |
| `ac()`, `transferFunction()`, `impedance()`, Thévenin | petits signaux : la diode est remplacée par sa résistance au point de repos |
| `symbolicTransferFunction()`                          | indisponible (`UNSUPPORTED`)                                                |

## Une première diode

Une diode s'écrit `D<nom> anode cathode [modèle]`. Ses paramètres viennent d'une carte `.model`, placée n'importe où dans la netlist :

```ts
import { ElecMap } from "elecmap";

const circuit = new ElecMap(`
V1 in 0 5
R1 in a 1k
D1 a 0 D1N4148
.model D1N4148 D(IS=2.52n N=1.752 RS=0.568 BV=100 IBV=100u CJO=4p)
`);

const op = circuit.operatingPoint();
op.voltage("a"); // 0.65323 V   tension de seuil
op.current("D1"); // 0.0043468 A de l'anode vers la cathode
op.power("D1"); // 0.0028394 W
op.iterations; // 6           itérations de Newton
```

<figure class="em-figure">
{@include ./figures/diode.svg}
</figure>

Sans modèle, la diode est celle de SPICE par défaut (`IS = 10 fA`, `N = 1`). Les paramètres peuvent aussi être écrits sur la ligne elle-même, où ils remplacent ceux du modèle :

```ts
new ElecMap(`
V1 in 0 5
R1 in a 1k
D1 a 0
D2 a 0 D1N4148 RS=2
.model D1N4148 D(IS=2.52n N=1.752 RS=0.568)
`);
```

### Paramètres

| SPICE | JSON  | Signification                                 | Défaut  |
| ----- | ----- | --------------------------------------------- | ------- |
| `IS`  | `is`  | courant de saturation (A)                     | `1e-14` |
| `N`   | `n`   | coefficient d'émission                        | `1`     |
| `RS`  | `rs`  | résistance série (Ω)                          | `0`     |
| `BV`  | `bv`  | tension de claquage inverse (V), Zener        | aucune  |
| `IBV` | `ibv` | courant à `−BV` (A)                           | `1e-3`  |
| `NBV` | `nbv` | coefficient d'émission du claquage            | `N`     |
| `CJO` | `cjo` | capacité de jonction à polarisation nulle (F) | `0`     |
| `VJ`  | `vj`  | potentiel de jonction (V)                     | `1`     |
| `M`   | `m`   | coefficient de gradualité                     | `0.5`   |
| `TT`  | `tt`  | temps de transit (s)                          | `0`     |
| `FC`  | `fc`  | coefficient de capacité en direct             | `0.5`   |

Le courant suit la loi de Shockley, plus un claquage exponentiel quand `BV` est donné :

<div class="em-math">I = I_S \left(e^{V_j / N V_T} - 1\right) - I_{BV}\, e^{-(V_j + BV) / N_{BV} V_T}, \qquad V_j = V_{AK} - R_S I, \quad V_T = 25{,}865\ \text{mV}</div>

`CJ0`/`CJ`, `PB` et `MJ` sont acceptés pour `CJO`, `VJ` et `M`. Les autres paramètres SPICE (`XTI`, `EG`, `KF`…) sont acceptés et signalés dans `warnings`. Un facteur de surface après le nom du modèle (`D1 a 0 DMOD 2`) multiplie `IS`, `IBV`, `CJO` et divise `RS`.

En JSON, les paramètres sont des champs du composant ; le nom du modèle est conservé pour l'aller-retour vers SPICE :

```ts
circuit.toJSON().components[2];
// { id: "D1", type: "diode", nodes: ["a", "0"], model: "D1N4148",
//   is: 2.52e-9, n: 1.752, rs: 0.568, bv: 100, ibv: 0.0001, cjo: 4e-12 }
```

## Régulateur Zener

Avec `BV`, la diode conduit en inverse dès que `V_KA` atteint la tension de claquage. On la monte à l'envers, cathode sur la sortie :

```ts
const regulator = new ElecMap(`
V1 in 0 12
R1 in k 470
DZ 0 k DZ51
RL k 0 1k
.model DZ51 D(BV=5.1 IBV=5m)
`);

regulator.voltage("k"); // 5.1167 V
regulator.current("DZ"); // -0.0095287 A   négatif : circule de la cathode vers l'anode
regulator.current("RL"); // 0.0051167 A
```

<figure class="em-figure">
{@include ./figures/zener.svg}
</figure>

`setValue` résout à nouveau le circuit : c'est le moyen le plus rapide de vérifier la régulation.

```ts
for (const v of [10, 12, 15]) regulator.setValue("V1", v).voltage("k");
// 5.1016   5.1167   5.1299      régulation en ligne : +28 mV pour +5 V
regulator.setValue("V1", 12);

for (const r of [10e3, 1e3, 500]) regulator.setValue("RL", r).voltage("k");
// 5.1268   5.1167   5.0972      régulation en charge
regulator.setValue("RL", 1e3);
```

Vu de la sortie, le régulateur est une source de 5,12 V derrière 2,69 Ω : la résistance dynamique de la Zener en parallèle avec R1 et RL.

```ts
const th = regulator.thevenin("k");
th.voltage; // 5.1167 V
th.resistance; // 2.6916 Ω
```

## Analyse petits signaux

Les analyses petits signaux (`ac`, `transferFunction`, `impedance`, `thevenin`…) calculent d'abord le point de fonctionnement continu, puis remplacent chaque diode par sa tangente : `R_S` en série avec la jonction, une résistance `r_d = N·V_T / I` en parallèle avec sa capacité au point de fonctionnement (voir [capacité de jonction](#capacité-de-jonction-et-temps-de-transit)).

```ts
const amp = new ElecMap(`
V1 in 0 DC 5 AC 1
R1 in a 1k
D1 a 0 D1N4148
.model D1N4148 D(IS=2.52n N=1.752 RS=0.568 CJO=4p)
`);

amp.impedance("a").dcGain(); // 10.874 Ω   = (r_d + R_S) ∥ R1

const H = amp.transferFunction({ input: "V1", output: "a" });
H.toLatex();
// "\frac{0.01087 + \left(3.813 \times 10^{-14}\right) s}{1 + \left(6.716 \times 10^{-11}\right) s}"
H.poles()[0].abs() / (2 * Math.PI); // 2369600000 Hz   la capacité de jonction
H.zeros()[0].abs() / (2 * Math.PI); // 45389000000 Hz  R_S en série avec elle
```

Le système linéarisé est accessible par `circuit.smallSignal`, un `MnaSystem` que l'on peut passer aux fonctions de bas niveau. Pour un circuit linéaire, c'est `circuit.system` lui-même.

> [!NOTE]
> Le point de fonctionnement utilise les valeurs continues des sources ; les amplitudes AC ne le déplacent pas. Une amplitude AC de 1 V sur un circuit à diode signifie « 1 V de petit signal », pas une sinusoïde de 1 V : pour voir un écrêtage ou une distorsion, utilisez une simulation transitoire.

## Redresseurs et écrêteurs

`transient` résout le circuit non linéaire à chaque pas, en partant de la solution du pas précédent :

```ts
const rectifier = new ElecMap(`
V1 in 0 SIN(0 10 50)
D1 in out DMOD
R1 out 0 1k
C1 out 0 100u
.model DMOD D(IS=1e-14)
`);

const tr = rectifier.transient({ tStop: 60e-3, tStep: 20e-6 });
Math.max(...tr.voltage("out")); // 9.2757 V   crête moins un seuil de diode
Math.max(...tr.current("D1")); // 0.33007 A  pics du courant de charge
```

<figure class="em-figure">
{@include ./figures/rectifier.svg}
</figure>

<figure class="em-figure">
{@include ./figures/rectifier-transient.svg}
<figcaption>Le condensateur se charge à chaque crête positive, puis se décharge dans R1 : environ 1,5 V d'ondulation</figcaption>
</figure>

## Capacité de jonction et temps de transit

Une jonction stocke une charge qui dépend de la tension. Deux parts s'additionnent :

- la charge de **déplétion**, fixée par `CJO`, `VJ` et `M`. Sa capacité diminue quand la tension inverse augmente. Au-delà de `FC·VJ` en direct, elle est prolongée par une droite et reste donc finie ;
- la charge de **diffusion** `TT·I`, portée par le courant direct. Sa capacité `TT·g_d` domine en conduction.

<div class="em-math">C_j(V) = \frac{C_{JO}}{\left(1 - V / V_J\right)^{M}} \quad (V < FC \cdot V_J), \qquad C_d = TT \cdot \frac{dI}{dV}</div>

Les analyses petits signaux prennent la capacité au point de fonctionnement ; un transitoire intègre la charge elle-même, et la capacité suit donc la tension à chaque pas. Avec `M = 0`, la capacité est constante et vaut `CJO`.

### Une varicap

Une diode polarisée en inverse est un condensateur réglé par sa tension. Ici, c'est le condensateur d'un filtre RC passe-bas, et la tension inverse déplace la fréquence de coupure :

```ts
const filter = new ElecMap(`
V1 in 0 DC 0 AC 1
R1 in a 10k
D1 0 a DVAR
.model DVAR D(CJO=30p VJ=0.7 M=0.5)
`);

for (const vr of [0, 2, 5, 10]) {
  filter.setValue("V1", vr, "dc").transferFunction("a").cutoffFrequency();
}
// 0 V :  530,52 kHz   C = 30 pF
// 2 V :  1,0419 MHz   C = 15,275 pF   = 30p / √(1 + 2/0,7)
// 5 V :  1,5139 MHz   C = 10,513 pF
// 10 V : 2,0742 MHz   C = 7,6732 pF
```

<figure class="em-figure">
{@include ./figures/varactor.svg}
<figcaption>La capacité suit CJO / √(1 + V/VJ) : la fréquence de coupure monte avec la tension inverse</figcaption>
</figure>

### Recouvrement inverse

Une diode qui conduit contient la charge de diffusion `TT·I_F`. Quand la source s'inverse, cette charge doit s'évacuer avant que la diode ne bloque : pendant un **temps de stockage**, la diode conduit en inverse, limitée seulement par la résistance.

```ts
const recovery = (tt: string) =>
  new ElecMap(`
V1 in 0 PULSE(5 -5 100n 1n 1n 1u 2u)
R1 in a 1k
D1 a 0 DS
.model DS D(IS=1e-14 TT=${tt})
`).transient({ tStop: 250e-9, tStep: 0.5e-9 });

const tr = recovery("50n");
tr.current("D1")[180]; // 0.0043071 A    I_F à 90 ns
tr.current("D1")[240]; // -0.0056572 A   I_R à 120 ns ≈ (−5 − 0,66 V) / 1 kΩ
// V(a) passe par 0 à 129 ns : un temps de stockage de 28 ns
// théorie : TT·ln(1 + I_F/I_R) = 28,3 ns
recovery("0").current("D1")[240]; // -5.01e-12 A  bloque immédiatement
```

<figure class="em-figure">
{@include ./figures/reverse-recovery.svg}
<figcaption>Avec un temps de transit de 50 ns, la diode conduit encore en inverse 28 ns après le front</figcaption>
</figure>

## Convergence

Newton-Raphson démarre chaque jonction à sa tension critique et limite le pas de tension de chaque jonction comme SPICE (`pnjlim`) : il converge sur la plupart des circuits sans aide. Si Newton seul échoue, ElecMap réessaie avec le **gmin stepping** (une conductance vers la masse qui décroît de 10 mS à 0), puis avec le **source stepping** (sources amenées progressivement de 0 à leur valeur). Les options règlent les tolérances :

```ts
circuit.operatingPoint({
  maxIterations: 100, // par résolution de Newton
  reltol: 1e-3, // tolérance relative sur les tensions et courants
  vntol: 1e-6, // tolérance absolue sur les tensions (V)
  abstol: 1e-12, // tolérance absolue sur les courants (A)
});
```

Quand toutes les stratégies échouent, l'erreur liste les composants non linéaires :

```ts
try {
  new ElecMap("V1 a 0 1\nD1 a 0").operatingPoint({ maxIterations: 2 });
} catch (e) {
  e.code; // "NO_CONVERGENCE"
  e.details; // { devices: ["D1"] }
}
```

En transitoire, un pas qui ne converge pas lève `NO_CONVERGENCE` avec `details.time` ; un `tStep` plus petit règle généralement le problème.

## Limites

- Les effets de la température (`XTI`, `EG`) et le bruit ne sont pas modélisés.
- Les fonctions de transfert littérales ne sont pas disponibles pour les circuits non linéaires :

```ts
amp.symbolicTransferFunction({ input: "V1", output: "a" });
// ElecMapError UNSUPPORTED: Symbolic analysis of a non-linear circuit (D1) is not supported:
// use the numeric transferFunction, linearised at the operating point
```

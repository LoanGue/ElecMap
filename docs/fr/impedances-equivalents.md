---
title: Impédances et équivalents
category: Guides
---

# Impédances et équivalents

À quoi ressemble un réseau vu depuis deux de ses nœuds ? À une seule résistance, un condensateur, une bobine, une impédance Z(s), ou une source derrière une impédance (Thévenin / Norton).

> Les équivalents sont calculés avec les sources indépendantes **éteintes** : les sources de tension deviennent des fils, les sources de courant des circuits ouverts. C'est pourquoi le nœud piloté par `V1` ci-dessous « voit » toujours 0 Ω.

## Résistance équivalente

```ts
import { ElecMap } from "elecmap";

const net = new ElecMap(`
V1 in 0 DC 12
R1 in a 1k
R2 a 0 2k
R3 a b 500
R4 b 0 1.5k
`);

net.equivalentResistance("a"); // 500     Ω, entre a et la masse : R1 ∥ R2 ∥ (R3 + R4)
net.equivalentResistance("a", "b"); // entre deux nœuds
```

## Capacité et inductance équivalentes

```ts
new ElecMap(`
V1 in 0 AC 1
C1 in a 100n
C2 a 0 100n
C3 a 0 47n
`).equivalentCapacitance("a"); // 2.47e-7   F (les trois sont en parallèle une fois V1 remplacée par un fil)

new ElecMap(`
V1 in 0 AC 1
L1 in a 10m
L2 a 0 22m
`).equivalentInductance("a"); // 0.006875  H (10 mH ∥ 22 mH)
```

Les bobines couplées (`K`) sont prises en compte.

### Quand le réseau mélange R, L et C

Un composant équivalent unique n'existe que si le réseau est constitué d'un seul type de composant. Sinon, une erreur explicite est levée, et la valeur peut être demandée en continu ou à une fréquence donnée :

```ts
const rlc = new ElecMap(`
V1 in 0 AC 1
R1 in a 10
L1 a b 1m
C1 b 0 1u
`);

rlc.equivalentResistance("a");
// lève ElecMapError NOT_HOMOGENEOUS: "The network is not purely resistive: Z(s) = …"

rlc.equivalentResistance("a", undefined, { mode: "dc" }); // 10     Z(0)
rlc.equivalentResistance("a", undefined, { mode: "freq", freq: 1e3 }); // Re Z(j·2π·1000)
```

## Impédance Z(s)

`impedance` renvoie Z(s) sous forme de {@link TransferFunction} : tout ce qui figure dans le [guide des fonctions de transfert](./transfer-functions.md) s'applique (LaTeX, Bode, pôles…).

```ts
const series = new ElecMap(`
V1 in 0 AC 1
R1 in a 10
L1 a b 1m
C1 b 0 1u
`);

series.inputImpedance("V1").toLatex(); // impédance vue par la source
```

<div class="em-math">Z_{in}(s) = \frac{10^{6} + 10\,s + 0.001\,s^{2}}{s}</div>

```ts
series.inputImpedance("V1").evaluate(5032.9).toString(); // "10 - 0.000266538920965j"  (résonance : Z = R)
series.equivalentImpedance("a", undefined, 5000).toString(); // Ω complexe à 5 kHz
series.outputImpedance("b").toLatex(); // impédance vue depuis le nœud b
```

<div class="em-math">Z_{out}(s) = \frac{10 + 10^{-3}\,s}{1 + 10^{-5}\,s + 10^{-9}\,s^{2}}</div>

## Thévenin et Norton

<figure class="em-figure">
{@include ./figures/bridge.svg}
<figcaption>Un pont de Wheatstone : que voit un détecteur placé entre <code>a</code> et <code>b</code> ?</figcaption>
</figure>

```ts
const bridge = new ElecMap(`
V1 in 0 DC 10
R1 in a 1k
R2 a 0 1k
R3 in b 1k
R4 b 0 1.2k
`);

const th = bridge.thevenin("a", "b");
th.voltage; // -0.4545   V   tension à vide V(a) − V(b)
th.resistance; // 1045.5  Ω   résistance de Thévenin
th.current; // -0.000435 A   courant de Norton (de court-circuit)
th.optimalLoad; // 1045.5  Ω   charge pour une puissance maximale
th.maxPower; // 0.0000494 W  puissance dans cette charge
```

`norton` renvoie le même objet. Avec une fréquence, tout devient complexe et la charge optimale est l'adaptation conjuguée :

```ts
const ac = series.thevenin("b", undefined, { freq: 1000 });
ac.impedance.toString(); // "10.7927309212 + 5.8354316305j"
ac.optimalLoad.toString(); // "10.7927309212 - 5.8354316305j"
ac.maxPower; // 0.0125  W
```

## Impédance littérale

La même chose, avec des symboles : voir les [fonctions de transfert littérales](./literal-transfer-functions.md#impédance-littérale).

```ts
new ElecMap(`
V1 in 0 AC 1
R1 in a 1k
R2 a 0 2k
C1 a 0 1u
`)
  .symbolicImpedance("a")
  .toLatex();
```

<div class="em-math">\frac{R_{1} R_{2}}{R_{1} + R_{2} + R_{1} R_{2} C_{1} s}</div>

---
title: Impedances and equivalents
category: Guides
---

# Impedances and equivalents

What does a network look like from two of its nodes? A single resistor, capacitor, inductor, an impedance Z(s), or a source behind an impedance (Thévenin / Norton).

> Equivalents are computed with the independent sources **turned off**: voltage sources become wires, current sources become open circuits. That is why the node driven by `V1` below always "sees" 0 Ω.

## Equivalent resistance

```ts
import { ElecMap } from "elecmap";

const net = new ElecMap(`
V1 in 0 DC 12
R1 in a 1k
R2 a 0 2k
R3 a b 500
R4 b 0 1.5k
`);

net.equivalentResistance("a"); // 500     Ω, between a and the ground: R1 ∥ R2 ∥ (R3 + R4)
net.equivalentResistance("a", "b"); // between two nodes
```

## Equivalent capacitance and inductance

```ts
new ElecMap(`
V1 in 0 AC 1
C1 in a 100n
C2 a 0 100n
C3 a 0 47n
`).equivalentCapacitance("a"); // 2.47e-7   F (the three are in parallel once V1 is a wire)

new ElecMap(`
V1 in 0 AC 1
L1 in a 10m
L2 a 0 22m
`).equivalentInductance("a"); // 0.006875  H (10 mH ∥ 22 mH)
```

Coupled inductors (`K`) are taken into account.

### When the network mixes R, L and C

A single equivalent component only exists if the network is made of one kind of component. Otherwise you get an explicit error, and you can ask for the value at DC or at a given frequency:

```ts
const rlc = new ElecMap(`
V1 in 0 AC 1
R1 in a 10
L1 a b 1m
C1 b 0 1u
`);

rlc.equivalentResistance("a");
// throws ElecMapError NOT_HOMOGENEOUS: "The network is not purely resistive: Z(s) = …"

rlc.equivalentResistance("a", undefined, { mode: "dc" }); // 10     Z(0)
rlc.equivalentResistance("a", undefined, { mode: "freq", freq: 1e3 }); // Re Z(j·2π·1000)
```

## Impedance Z(s)

`impedance` returns Z(s) as a {@link TransferFunction}: everything from the [transfer functions guide](./transfer-functions.md) applies (LaTeX, Bode, poles…).

```ts
const series = new ElecMap(`
V1 in 0 AC 1
R1 in a 10
L1 a b 1m
C1 b 0 1u
`);

series.inputImpedance("V1").toLatex(); // impedance seen by the source
```

<div class="em-math">Z_{in}(s) = \frac{10^{6} + 10\,s + 0.001\,s^{2}}{s}</div>

```ts
series.inputImpedance("V1").evaluate(5032.9).toString(); // "10 - 0.000266538920965j"  (resonance: Z = R)
series.equivalentImpedance("a", undefined, 5000).toString(); // complex Ω at 5 kHz
series.outputImpedance("b").toLatex(); // impedance seen from node b
```

<div class="em-math">Z_{out}(s) = \frac{10 + 10^{-3}\,s}{1 + 10^{-5}\,s + 10^{-9}\,s^{2}}</div>

## Thévenin and Norton

<figure class="em-figure">
{@include ./figures/bridge.svg}
<figcaption>A Wheatstone bridge: what does a detector between <code>a</code> and <code>b</code> see?</figcaption>
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
th.voltage; // -0.4545   V   open-circuit voltage V(a) − V(b)
th.resistance; // 1045.5  Ω   Thévenin resistance
th.current; // -0.000435 A   Norton (short-circuit) current
th.optimalLoad; // 1045.5  Ω   load for maximum power
th.maxPower; // 0.0000494 W  power in that load
```

`norton` returns the same object. With a frequency, everything becomes complex and the optimal load is the conjugate match:

```ts
const ac = series.thevenin("b", undefined, { freq: 1000 });
ac.impedance.toString(); // "10.7927309212 + 5.8354316305j"
ac.optimalLoad.toString(); // "10.7927309212 - 5.8354316305j"
ac.maxPower; // 0.0125  W
```

## Literal impedance

The same, with symbols: see [literal transfer functions](./literal-transfer-functions.md#literal-impedance).

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

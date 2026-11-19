---
title: Sensitivities
category: Guides
---

# Sensitivities

Which component matters? `sensitivity(output, id)` tells how much an output moves when one component changes. `sensitivities(output)` asks the question for every component at once and ranks them. Use it to pick tolerances, find the part to trim, or check that a design does not depend on a poorly controlled parameter such as a transistor's β.

## One component

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
//   derivative: -0.001875,   ∂V(out)/∂R1 in V/Ω: +1 Ω on R1 → −1.875 mV
//   normalized: -0.25,       +1 % on R1 → −0.25 % on V(out)
// }
```

`derivative` is the absolute sensitivity `∂y/∂p`, in output units per component unit. `normalized` is the relative one, `(p/y)·∂y/∂p`: the percentage change of the output for a 1 % change of the component. It has no unit, so components of different kinds can be compared. A normalised sensitivity of 1 means proportional, and −1 means inversely proportional.

The output can be a node voltage, a voltage between two nodes or a current:

```ts
divider.sensitivity(["in", "out"], "R1").normalized; // 0.75
divider.sensitivity({ current: "R2" }, "R2").derivative; // -6.25e-7 A/Ω
divider.sensitivity("out", "V1").normalized; // 1   (field "dc" of the source)
```

The varied field is the one of {@link ElecMap.setValue | `setValue`}: `value` for R, L, C, `dc` for sources, `gain` for controlled sources, `is` for a diode, `bf` for a BJT, `w` for a MOSFET. Choose another one with `field`:

```ts
const amp = new ElecMap(`
V1 in 0 1
R1 in 0 1k
E1 out 0 in 0 4
R2 out 0 1k
`);
amp.sensitivity("out", "E1", { field: "gain" }).derivative; // 1   ∂V(out)/∂gain = V(in)
```

## Every component, ranked

`sensitivities(output)` returns one entry per component that has a value, sorted by decreasing `|normalized|`:

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

R2 ∥ R3 = 2 kΩ, so V(out) = 10 V · 2k / 3k. R1 has the largest effect, and R3, the larger of the two parallel resistors, has the smallest. Ideal op-amps (no gain) are skipped. An output of 0 gives `normalized: NaN`, and these entries come last.

## At a frequency

With `at: { freq }`, the output is the **amplitude** of the phasor:

```ts
const rc = new ElecMap(`
V1 in 0 DC 5 AC 1
R1 in out 1k
C1 out 0 100n
`);

const s = rc.sensitivity("out", "C1", { at: { freq: 1000 } });
s.output; // 0.8467   |V(out)| at 1 kHz
s.normalized; // -0.2830  = −(ωRC)² / (1 + (ωRC)²)
rc.sensitivity("out", "C1").derivative; // 0   in DC the capacitor is open
```

## Any quantity

The output can also be a function that computes any number from the circuit. Pass a cut-off frequency, a Q factor, a gain or a power. The function receives a modified copy of the circuit:

```ts
const fc = (c: ElecMap) => c.transferFunction("out").cutoffFrequency();
rc.sensitivity(fc, "R1").normalized; // -1   fc = 1/(2πRC)
rc.sensitivity(fc, "C1").normalized; // -1
```

A unity-gain Sallen-Key low-pass shows the classic result: f₀ depends on every component with an exponent of −½, while Q depends on the capacitor ratio only:

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

f0(sk); // 1073.0 Hz
q(sk); // 0.7416
for (const id of ["R1", "R2", "C1", "C2"]) {
  [sk.sensitivity(f0, id).normalized, sk.sensitivity(q, id).normalized];
}
// R1: [-0.5, ≈0]   R2: [-0.5, ≈0]   C1: [-0.5, 0.5]   C2: [-0.5, -0.5]
```

The result: with equal resistors, a 5 % resistor tolerance moves f₀ by 2.5 % but leaves Q unchanged.

## Non-linear circuits: bias stability

Sensitivities work on non-linear circuits too: each evaluation solves the operating point again. This shows why the four-resistor bias of the [transistors guide](./transistors.md#a-common-emitter-stage) is used everywhere:

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

bias.current("RC"); // 2.772 mA   collector current
bias.sensitivities({ current: "RC" }).map((s) => [s.id, s.field, s.normalized]);
// [["VCC", "dc", 1.452], ["RB1", "value", -1.211], ["RB2", "value", 1.132],
//  ["RE", "value", -0.903], ["Q1", "bf", 0.0833], ["RC", "value", ≈0]]
```

<figure class="em-figure">
{@include ./figures/bias-sensitivities.svg}
<figcaption>Normalised sensitivities of the collector current. The resistors and the supply set Ic, and β barely matters.</figcaption>
</figure>

A 1 % change of β moves Ic by only 0.083 %, because the divider and RE set the current. With a fixed base current (a single 1.2 MΩ resistor from VCC to the base, emitter grounded), Ic is proportional to β:

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

// β from 100 to 400:
// divider + RE:       Ic 2.559 → 2.893 mA   (+13 %)
// fixed base current: Ic 0.946 → 3.770 mA   (×4)
```

<figure class="em-figure">
{@include ./figures/bias-beta.svg}
<figcaption>Collector current against β for both bias networks.</figcaption>
</figure>

The collector resistor RC has no effect on Ic as long as the transistor stays in the forward-active region. It does set the collector voltage, though: `bias.sensitivity("c", "RC").normalized` is −1.034.

## How it is computed

The derivative is computed by central differences with Richardson extrapolation. ElecMap evaluates the output at `p ± h` and `p ± h/2`, with `h = 10⁻³·|p|` (or 10⁻³ when `p = 0`), and combines the results: `(4·D(h/2) − D(h)) / 3`. The truncation error is of order h⁴. Results are accurate to about 10 significant digits on linear circuits, and to the convergence tolerance of Newton-Raphson (about 6 digits) on non-linear ones.

Each sensitivity costs four analyses of a modified copy, and the circuit itself is not changed. `sensitivities` repeats this for every component. A device parameter that is not set (a diode without `IS`) is varied around its SPICE default.

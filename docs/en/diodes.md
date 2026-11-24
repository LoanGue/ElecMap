---
title: Diodes and non-linear circuits
category: Guides
---

# Diodes and non-linear circuits

A diode makes the circuit non-linear: currents are no longer proportional to the sources. ElecMap then solves the circuit with **Newton-Raphson**, as SPICE does, and every familiar analysis keeps working:

| Analysis                                              | What happens with a diode                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| `operatingPoint()`, `voltage()`, `current()`          | exact non-linear DC solution                                      |
| `transient()`                                         | exact non-linear solution at every time step                      |
| `ac()`, `transferFunction()`, `impedance()`, Thévenin | small-signal: the diode is replaced by its resistance at the bias |
| `symbolicTransferFunction()`                          | not available (`UNSUPPORTED`)                                     |

## A first diode

A diode is written `D<name> anode cathode [model]`. Its parameters come from a `.model` card, anywhere in the netlist:

```ts
import { ElecMap } from "elecmap";

const circuit = new ElecMap(`
V1 in 0 5
R1 in a 1k
D1 a 0 D1N4148
.model D1N4148 D(IS=2.52n N=1.752 RS=0.568 BV=100 IBV=100u CJO=4p)
`);

const op = circuit.operatingPoint();
op.voltage("a"); // 0.65323 V   forward voltage
op.current("D1"); // 0.0043468 A anode → cathode
op.power("D1"); // 0.0028394 W
op.iterations; // 6           Newton iterations
```

<figure class="em-figure">
{@include ./figures/diode.svg}
</figure>

Without a model, the diode is the SPICE default (`IS = 10 fA`, `N = 1`). Parameters can also be written on the line itself, where they override the model:

```ts
new ElecMap(`
V1 in 0 5
R1 in a 1k
D1 a 0
D2 a 0 D1N4148 RS=2
.model D1N4148 D(IS=2.52n N=1.752 RS=0.568)
`);
```

### Parameters

| SPICE | JSON  | Meaning                               | Default |
| ----- | ----- | ------------------------------------- | ------- |
| `IS`  | `is`  | saturation current (A)                | `1e-14` |
| `N`   | `n`   | emission coefficient                  | `1`     |
| `RS`  | `rs`  | series resistance (Ω)                 | `0`     |
| `BV`  | `bv`  | reverse breakdown voltage (V), Zener  | none    |
| `IBV` | `ibv` | current at `−BV` (A)                  | `1e-3`  |
| `NBV` | `nbv` | emission coefficient of the breakdown | `N`     |
| `CJO` | `cjo` | zero-bias junction capacitance (F)    | `0`     |
| `VJ`  | `vj`  | junction potential (V)                | `1`     |
| `M`   | `m`   | grading coefficient                   | `0.5`   |
| `TT`  | `tt`  | transit time (s)                      | `0`     |
| `FC`  | `fc`  | forward-bias capacitance coefficient  | `0.5`   |

The current is the Shockley law, plus an exponential breakdown when `BV` is set:

<div class="em-math">I = I_S \left(e^{V_j / N V_T} - 1\right) - I_{BV}\, e^{-(V_j + BV) / N_{BV} V_T}, \qquad V_j = V_{AK} - R_S I, \quad V_T = 25.865\ \text{mV}</div>

`CJ0`/`CJ`, `PB` and `MJ` are accepted for `CJO`, `VJ` and `M`. Other SPICE parameters (`XTI`, `EG`, `KF`…) are accepted and reported in `warnings`. An area factor after the model name (`D1 a 0 DMOD 2`) multiplies `IS`, `IBV`, `CJO` and divides `RS`.

In JSON, the parameters are fields of the component; the model name is kept for the round trip to SPICE:

```ts
circuit.toJSON().components[2];
// { id: "D1", type: "diode", nodes: ["a", "0"], model: "D1N4148",
//   is: 2.52e-9, n: 1.752, rs: 0.568, bv: 100, ibv: 0.0001, cjo: 4e-12 }
```

## Zener regulator

With `BV`, the diode conducts in reverse once `V_KA` reaches the breakdown voltage. Put it upside down, cathode on the output:

```ts
const regulator = new ElecMap(`
V1 in 0 12
R1 in k 470
DZ 0 k DZ51
RL k 0 1k
.model DZ51 D(BV=5.1 IBV=5m)
`);

regulator.voltage("k"); // 5.1167 V
regulator.current("DZ"); // -0.0095287 A   negative: flows from cathode to anode
regulator.current("RL"); // 0.0051167 A
```

<figure class="em-figure">
{@include ./figures/zener.svg}
</figure>

`setValue` re-solves the circuit, which is the quickest way to check the regulation:

```ts
for (const v of [10, 12, 15]) regulator.setValue("V1", v).voltage("k");
// 5.1016   5.1167   5.1299      line regulation: +28 mV for +5 V
regulator.setValue("V1", 12);

for (const r of [10e3, 1e3, 500]) regulator.setValue("RL", r).voltage("k");
// 5.1268   5.1167   5.0972      load regulation
regulator.setValue("RL", 1e3);
```

Seen from the output, the regulator is a 5.12 V source behind 2.69 Ω, the zener's dynamic resistance in parallel with R1 and RL:

```ts
const th = regulator.thevenin("k");
th.voltage; // 5.1167 V
th.resistance; // 2.6916 Ω
```

## Small-signal analysis

Small-signal analyses (`ac`, `transferFunction`, `impedance`, `thevenin`…) first compute the DC operating point, then replace every diode by its tangent: `R_S` in series with the junction, a resistance `r_d = N·V_T / I` in parallel with its capacitance at the operating point (see [junction capacitance](#junction-capacitance-and-transit-time)).

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
H.poles()[0].abs() / (2 * Math.PI); // 2369600000 Hz   the junction capacitance
H.zeros()[0].abs() / (2 * Math.PI); // 45389000000 Hz  R_S in series with it
```

The linearised system is available as `circuit.smallSignal`, an `MnaSystem` that can be passed to the low-level functions. For a linear circuit it is `circuit.system` itself.

> [!NOTE]
> The operating point uses the DC values of the sources; AC magnitudes do not move it. An AC magnitude of 1 V on a diode circuit means "1 V of small signal", not a 1 V sine: to see clipping or distortion, use a transient.

## Rectifiers and clippers

`transient` solves the non-linear circuit at every step, starting from the guess of the previous step:

```ts
const rectifier = new ElecMap(`
V1 in 0 SIN(0 10 50)
D1 in out DMOD
R1 out 0 1k
C1 out 0 100u
.model DMOD D(IS=1e-14)
`);

const tr = rectifier.transient({ tStop: 60e-3, tStep: 20e-6 });
Math.max(...tr.voltage("out")); // 9.2757 V   peak minus one diode drop
Math.max(...tr.current("D1")); // 0.33007 A  charging current peaks
```

<figure class="em-figure">
{@include ./figures/rectifier.svg}
</figure>

<figure class="em-figure">
{@include ./figures/rectifier-transient.svg}
<figcaption>The capacitor charges on each positive peak, then discharges into R1: about 1.5 V of ripple</figcaption>
</figure>

## Junction capacitance and transit time

A junction stores charge, and the charge depends on the voltage. Two parts add up:

- the **depletion** charge, set by `CJO`, `VJ` and `M`. Its capacitance falls as the reverse voltage grows. Above `FC·VJ` in forward bias it is continued by a straight line, so it stays finite;
- the **diffusion** charge `TT·I`, carried by the forward current. Its capacitance `TT·g_d` dominates in conduction.

<div class="em-math">C_j(V) = \frac{C_{JO}}{\left(1 - V / V_J\right)^{M}} \quad (V < FC \cdot V_J), \qquad C_d = TT \cdot \frac{dI}{dV}</div>

Small-signal analyses use the capacitance at the operating point; a transient integrates the charge itself, so the capacitance follows the voltage at every step. With `M = 0` the capacitance is constant and equal to `CJO`.

### A varactor

A reverse-biased diode is a capacitor tuned by its voltage. Here it is the capacitor of an RC low-pass filter, and the reverse voltage moves the cut-off frequency:

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
// 0 V:  530.52 kHz   C = 30 pF
// 2 V:  1.0419 MHz   C = 15.275 pF   = 30p / √(1 + 2/0.7)
// 5 V:  1.5139 MHz   C = 10.513 pF
// 10 V: 2.0742 MHz   C = 7.6732 pF
```

<figure class="em-figure">
{@include ./figures/varactor.svg}
<figcaption>The capacitance follows CJO / √(1 + V/VJ), so the cut-off frequency rises with the reverse voltage</figcaption>
</figure>

### Reverse recovery

A conducting diode holds the diffusion charge `TT·I_F`. When the source reverses, that charge has to leave before the diode can block: for a **storage time** the diode conducts in reverse, limited only by the resistor.

```ts
const recovery = (tt: string) =>
  new ElecMap(`
V1 in 0 PULSE(5 -5 100n 1n 1n 1u 2u)
R1 in a 1k
D1 a 0 DS
.model DS D(IS=1e-14 TT=${tt})
`).transient({ tStop: 250e-9, tStep: 0.5e-9 });

const tr = recovery("50n");
tr.current("D1")[180]; // 0.0043071 A    I_F at 90 ns
tr.current("D1")[240]; // -0.0056572 A   I_R at 120 ns ≈ (−5 − 0.66 V) / 1 kΩ
// V(a) crosses 0 at 129 ns: a storage time of 28 ns
// theory: TT·ln(1 + I_F/I_R) = 28.3 ns
recovery("0").current("D1")[240]; // -5.01e-12 A  blocks at once
```

<figure class="em-figure">
{@include ./figures/reverse-recovery.svg}
<figcaption>With a 50 ns transit time the diode keeps conducting in reverse for 28 ns after the edge</figcaption>
</figure>

## Convergence

Newton-Raphson starts each junction at its critical voltage and limits each junction's voltage step like SPICE (`pnjlim`), so it converges on most circuits without help. If plain Newton fails, ElecMap retries with **gmin stepping** (a conductance to ground decreasing from 10 mS to 0), then with **source stepping** (sources ramped from 0 to their value). The options set the tolerances:

```ts
circuit.operatingPoint({
  maxIterations: 100, // per Newton solve
  reltol: 1e-3, // relative tolerance on voltages and currents
  vntol: 1e-6, // absolute tolerance on voltages (V)
  abstol: 1e-12, // absolute tolerance on currents (A)
});
```

When every strategy fails, the error lists the non-linear devices:

```ts
try {
  new ElecMap("V1 a 0 1\nD1 a 0").operatingPoint({ maxIterations: 2 });
} catch (e) {
  e.code; // "NO_CONVERGENCE"
  e.details; // { devices: ["D1"] }
}
```

In a transient, a step that does not converge throws `NO_CONVERGENCE` with `details.time`; a smaller `tStep` usually fixes it.

## Limitations

- Temperature effects (`XTI`, `EG`) and noise are not modelled.
- Literal transfer functions are not available for non-linear circuits:

```ts
amp.symbolicTransferFunction({ input: "V1", output: "a" });
// ElecMapError UNSUPPORTED: Symbolic analysis of a non-linear circuit (D1) is not supported:
// use the numeric transferFunction, linearised at the operating point
```

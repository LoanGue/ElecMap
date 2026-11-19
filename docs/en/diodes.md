---
title: Diodes and non-linear circuits
category: Guides
---

# Diodes and non-linear circuits

A diode makes the circuit non-linear: currents are no longer proportional to the sources. ElecMap then solves the circuit with **Newton-Raphson**, as SPICE does, and every analysis you already know keeps working:

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

| SPICE | JSON  | Meaning                                 | Default |
| ----- | ----- | --------------------------------------- | ------- |
| `IS`  | `is`  | saturation current (A)                  | `1e-14` |
| `N`   | `n`   | emission coefficient                    | `1`     |
| `RS`  | `rs`  | series resistance (Ω)                   | `0`     |
| `BV`  | `bv`  | reverse breakdown voltage (V), Zener    | none    |
| `IBV` | `ibv` | current at `−BV` (A)                    | `1e-3`  |
| `NBV` | `nbv` | emission coefficient of the breakdown   | `N`     |
| `CJO` | `cjo` | junction capacitance (F), held constant | `0`     |

The current is the Shockley law, plus an exponential breakdown when `BV` is set:

<div class="em-math">I = I_S \left(e^{V_j / N V_T} - 1\right) - I_{BV}\, e^{-(V_j + BV) / N_{BV} V_T}, \qquad V_j = V_{AK} - R_S I, \quad V_T = 25.865\ \text{mV}</div>

Other SPICE parameters (`TT`, `M`, `VJ`…) are accepted and reported in `warnings`. An area factor after the model name (`D1 a 0 DMOD 2`) multiplies `IS`, `IBV`, `CJO` and divides `RS`.

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

Small-signal analyses (`ac`, `transferFunction`, `impedance`, `thevenin`…) first compute the DC operating point, then replace every diode by its tangent: a resistance `r_d = N·V_T / I + R_S` in parallel with `CJO`.

```ts
const amp = new ElecMap(`
V1 in 0 DC 5 AC 1
R1 in a 1k
D1 a 0 D1N4148
.model D1N4148 D(IS=2.52n N=1.752 RS=0.568 CJO=4p)
`);

amp.impedance("a").dcGain(); // 10.874 Ω   = r_d ∥ R1

const H = amp.transferFunction({ input: "V1", output: "a" });
H.toLatex(); // "\frac{0.01087}{1 + \left(4.349 \times 10^{-11}\right) s}"
H.cutoffFrequency(); // 3659200000 Hz, r_d ∥ R1 with CJO
```

The linearised system is available as `circuit.smallSignal`, an `MnaSystem` you can pass to the low-level functions. For a linear circuit it is `circuit.system` itself.

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

- The junction capacitance `CJO` is constant: it does not depend on the bias, and transit time (`TT`) is ignored.
- Literal transfer functions are not available for non-linear circuits:

```ts
amp.symbolicTransferFunction({ input: "V1", output: "a" });
// ElecMapError UNSUPPORTED: Symbolic analysis of a non-linear circuit (D1) is not supported:
// use the numeric transferFunction, linearised at the operating point
```

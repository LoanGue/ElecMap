---
title: Time domain
category: Guides
---

# Time domain

Two complementary tools:

| Tool                                | What it does                                 | Best for                                  |
| ----------------------------------- | -------------------------------------------- | ----------------------------------------- |
| `H.stepResponse()`, `H.response()`… | exact response computed from H(s)            | one input, one output, zero initial state |
| `circuit.transient()`               | step-by-step simulation of the whole circuit | every voltage and current, real waveforms |

## Step response

```ts
import { ElecMap } from "elecmap";

const rlc = new ElecMap(`
V1 in 0 AC 1
R1 in a 20
L1 a out 10m
C1 out 0 1u
`);
const H = rlc.transferFunction("out");

const step = H.stepResponse({ tStop: 2e-3 });
step.time; // s
step.value; // V(out) when V1 jumps from 0 to 1 V
```

The figures that characterise it:

```ts
H.stepInfo();
// {
//   finalValue: 1,
//   peak: 1.7286,          maximum value
//   peakTime: 0.00032,     s
//   overshoot: 72.86,      %
//   riseTime: 0.000111,    s, 10 % → 90 %
//   settlingTime: 0.00384  s, within 2 % of the final value
// }
```

## Impulse response

```ts
const rc = new ElecMap(`
V1 in 0 AC 1
R1 in out 1k
C1 out 0 100n
`).transferFunction("out");

rc.impulseResponse({ tStop: 2e-4, points: 3 }).value;
// [10000, 5134.2, 2636.0, 1353.4]    h(t) = (1/RC)·e^(−t/RC)
```

If H(s) has a direct feed-through (same degree at the numerator and denominator), its Dirac part is returned separately as `impulse`.

## Response to any input signal

```ts
const sine = (t: number) => Math.sin(2 * Math.PI * 1000 * t);
const out = rc.response(sine, { tStop: 3e-3, points: 300 });
// out.time, out.value: includes the start-up transient, unlike apply()
```

## Transient simulation

`transient` simulates the whole circuit. Sources keep the waveform written in the netlist (`SIN`, `PULSE`, `PWL`, `EXP`):

<figure class="em-figure">
{@include ./figures/rlc.svg}
</figure>

```ts
const circuit = new ElecMap(`
V1 in 0 PULSE(0 1 0 1n 1n 0.5m 1m)
R1 in a 20
L1 a out 10m
C1 out 0 1u
`);

const tr = circuit.transient({ tStop: 2e-3, tStep: 2e-6 });
tr.time; // s
tr.voltage("out"); // V, one value per time point
tr.current("L1"); // A
tr.power("R1"); // W
```

<figure class="em-figure">
{@include ./figures/rlc-transient.svg}
<figcaption>The simulation (orange) matches the exact step response computed from H(s) (dashed) until the input falls at 0.5 ms</figcaption>
</figure>

### Options

```ts
circuit.transient({
  tStop: 10e-3, // end time (s)
  tStep: 1e-6, // time step (s), default tStop / 1000
  method: "gear2", // "gear2" (default), "trap" or "euler"
  initial: "op", // start from the DC operating point ("op"), from IC= values ("ic"), or "auto"
  inputs: {
    // override a source: waveform object, constant, or any function of time
    V1: { kind: "pulse", v1: 0, v2: 5, width: 1e-3, period: 2e-3 },
  },
});
```

### Initial conditions

Capacitors and inductors accept an initial value with `IC=`:

```ts
const discharge = new ElecMap(`
R1 a 0 1k
C1 a 0 1u IC=5
`);
const d = discharge.transient({ tStop: 5e-3 });
d.voltage("a"); // starts at 5 V, decays with τ = 1 ms
```

## Op-amp saturation: a Schmitt trigger

`VSAT=v` (or `VPOS=v VNEG=v`) bounds an op-amp output: it saturates smoothly between the rails, a non-linear element solved by Newton-Raphson. In an inverting Schmitt trigger, the positive feedback `R1`, `R2` sets the thresholds at `±VSAT·R1/(R1 + R2) = ±7.5 V`:

```ts
const netlist = (v1: string) => `
V1 n1 0 ${v1}
R3 in n1 1k
X1 n2 in out OPAMP VSAT=15
R2 n2 out 1k
R1 n2 0 1k
`;
new ElecMap(netlist("DC 5")).operatingPoint().voltage("out"); // -15.000025
new ElecMap(netlist("DC -5")).operatingPoint().voltage("out"); // 15.000025

const r = new ElecMap(netlist("SIN(0 10 1)")).transient({ tStop: 2, tStep: 1e-3 });
const vin = r.voltage("n1");
const out = r.voltage("out");
r.time
  .map((t, i) => [t, vin[i], out[i]])
  .filter(([, , o], i) => i > 1 && Math.sign(o) !== Math.sign(out[i - 1]));
// [[0.635, -7.5, 15], [1.135, 7.5, -15], [1.635, -7.5, 15]]   (s, V, V; rounded)
```

- Inside the hysteresis band both outputs are solutions. The DC solve starts from 0 V: the output goes to the rail opposite to the input.
- An ideal op-amp with rails uses an open-loop gain of 10⁶. It needs no extra dynamics: each Newton solve starts from the open-loop response to the inputs, so the output switches within one time step when a threshold is crossed.
- With `GBW`, the output follows the pole `A/(2π·GBW)` behind a saturated gain stage, so it slews at about `VSAT·2π·GBW/A` (940 V/s for `GAIN=1e5 GBW=1e6`).
- Small-signal analyses are linearised at the operating point: a saturated op-amp has a gain of about 0.

```ts
const amp = new ElecMap("V1 p 0 10\nX1 p m out OPAMP GAIN=1e5 VSAT=15\nR2 m out 1k\nR1 m 0 1k");
amp.operatingPoint().voltage("out"); // 15.0000005
amp.transferFunction("out").dcGain(); // 2e-7
```

## Waveforms

| SPICE                                       | JSON `kind` | Shape                             |
| ------------------------------------------- | ----------- | --------------------------------- |
| `SIN(offset amplitude freq …)`              | `sine`      | sine, optional delay and damping  |
| `PULSE(v1 v2 delay rise fall width period)` | `pulse`     | trapezoidal pulse train           |
| `PWL(t1 v1 t2 v2 …)`                        | `pwl`       | piecewise linear                  |
| `EXP(v1 v2 td1 tau1 td2 tau2)`              | `exp`       | exponential rise and fall         |
| JSON only                                   | `step`      | step from `v1` to `v2` at `delay` |

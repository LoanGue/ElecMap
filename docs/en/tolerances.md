---
title: Tolerances (Monte-Carlo)
category: Guides
---

# Tolerances (Monte-Carlo)

A 1 kΩ resistor sold at ±5 % is somewhere between 950 Ω and 1050 Ω. `monteCarlo` builds many copies of the circuit, each with its components drawn at random within their tolerance, so that you see the spread of the real circuit: the range of a cut-off frequency, the envelope of a Bode plot, the yield of a bias network.

Where {@link ElecMap.sensitivity | sensitivities} give the slope around the nominal point, Monte-Carlo gives the actual spread, with every tolerance at once and without linearising.

## A first analysis

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

`tolerances` gives a relative tolerance per component: `0.05` is ±5 %. The varied field is the one of {@link ElecMap.setValue | `setValue`} (`value` for R, L, C, `dc` for a source, `bf` for a BJT…). `samples` lists the values drawn for every run. The circuit `rc` itself is not changed.

## Statistics of any quantity

`statistics(measure)` computes a quantity on the nominal circuit and on every run:

```ts
const fc = mc.statistics((c) => c.transferFunction("out").cutoffFrequency());
fc.nominal; // 1591.5 Hz
fc.mean; // 1608.1
fc.std; // 108.1
[fc.min, fc.max]; // [1390.7, 1835.6]
[fc.percentile(0.05), fc.percentile(0.95)]; // [1440.7, 1781.3]   90 % of the circuits
fc.values; // the 200 values, one per run
```

<figure class="em-figure">
{@include ./figures/tolerance-fc.svg}
<figcaption>Cut-off frequency of 200 RC filters with R ±5 % and C ±10 %. The dashed line is the nominal value.</figcaption>
</figure>

The worst case is R and C both at their lowest or both at their highest: 1378 Hz and 1861 Hz. The 200 runs come close to it (1391 Hz and 1836 Hz), but 90 % of the circuits stay between 1441 Hz and 1781 Hz.

The measure can be anything computed from a circuit: a voltage, a current, a gain, a power, a time constant. A run where it returns `undefined` (no cut-off frequency, for instance) is counted as `NaN` in `values` and left out of the statistics.

## Bode envelope

`bode(output)` draws the Bode diagram of every run, on the frequency grid of the nominal circuit, and its envelope point by point. Here, a unity-gain Sallen-Key low-pass with 5 % resistors and 10 % capacitors:

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
bode.freq; // 41 frequencies, from 100 Hz to 10 kHz
bode.nominal.magnitudeDb; // Bode of the nominal circuit
bode.runs; // 200 Bode plots, one per run

// At 1 kHz (index 20):
bode.nominal.magnitudeDb[20]; // -2.03 dB
[bode.magnitudeDb.min[20], bode.magnitudeDb.max[20]]; // [-3.06, -0.99]
[bode.phase.min[20], bode.phase.max[20]]; // [-93.6, -75.1] °
bode.magnitudeDb.mean; // mean curve; also .std
```

<figure class="em-figure">
{@include ./figures/tolerance-bode.svg}
<figcaption>Envelope of the Bode diagram of 200 Sallen-Key filters: around f₀, the gain varies by ±1 dB.</figcaption>
</figure>

Combine it with {@link TransferFunction} methods to follow the filter parameters:

```ts
const f0 = tol.statistics((c) => c.transferFunction("out").naturalFrequency());
const q = tol.statistics((c) => c.transferFunction("out").qFactor());
[f0.min, f0.max]; // [959.5, 1189.7] Hz   nominal 1073.0
[q.min, q.max]; // [0.683, 0.816]       nominal 0.742
```

## Distributions and seed

By default, every value in the tolerance interval is equally likely (`"uniform"`). With `distribution: "gaussian"`, values follow a normal law with σ = tolerance / 3: 99.7 % of them fall within the tolerance, as for components sorted from a production batch. A few values beyond it are kept.

```ts
const g = rc
  .monteCarlo({ tolerances: { R1: 0.05, C1: 0.1 }, runs: 200, distribution: "gaussian" })
  .statistics((c) => c.transferFunction("out").cutoffFrequency());
g.std; // 61.6 Hz   (108.1 Hz with uniform tolerances)
[g.min, g.max]; // [1443.4, 1781.5]
```

<figure class="em-figure">
{@include ./figures/tolerance-distributions.svg}
<figcaption>The same filter with uniform and gaussian tolerances: the gaussian spread is narrower and centred on the nominal value.</figcaption>
</figure>

Each component can have its own distribution. The draws come from a seeded generator: the same `seed` (default 1) always gives the same runs, so results are reproducible. Change it to draw another batch.

```ts
rc.monteCarlo({
  tolerances: {
    R1: 0.01, // 1 % resistor, uniform
    C1: { tolerance: 0.2, distribution: "gaussian" }, // 20 % capacitor
  },
  runs: 3,
  seed: 42,
}).samples.map((s) => s.values);
// [{ R1: 1002.0, C1: 1.044e-7 }, { R1: 1003.4, C1: 9.592e-8 }, { R1: 995.5, C1: 1.062e-7 }]
```

## Other fields: transistor gain

Use `"id.field"` to vary another field than the default one. β (`bf`) varies widely from one transistor to another: ±50 % around 200 is common. The four-resistor bias of the [transistors guide](./transistors.md#a-common-emitter-stage) is designed to absorb it:

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

// The same transistors with a fixed base current (1.2 MΩ from VCC to the base):
// [0.951, 1.888, 2.820] mA
```

<figure class="em-figure">
{@include ./figures/tolerance-bias.svg}
<figcaption>Collector current of 100 stages with β = 200 ± 50 %. With the divider and RE, Ic stays within −8 % / +3 %; with a fixed base current it follows β.</figcaption>
</figure>

Tolerances on every part give the real production spread:

```ts
const all = bias.monteCarlo({
  tolerances: { RB1: 0.05, RB2: 0.05, RC: 0.05, RE: 0.05, "Q1.bf": 0.5 },
  runs: 200,
});
const icAll = all.statistics((c) => c.current("RC") * 1e3);
const vc = all.statistics((c) => c.voltage("c"));
[icAll.min, icAll.max]; // [2.386, 3.163] mA
[vc.min, vc.max]; // [4.83, 6.97] V    nominal 5.90 V: the stage never saturates
```

## Using the runs directly

`circuit(i)` returns the circuit of run `i`, a full {@link ElecMap} on which every analysis is available. `circuits()` returns all of them, and `nominal` is the original circuit.

```ts
const worst = fc.values.indexOf(fc.min);
mc.circuit(worst)
  .components()
  .find((c) => c.id === "R1"); // { id: "R1", value: 1041.0, … }   C1 = 109.9 nF
mc.circuit(worst).transient({ tStop: 5e-3, tStep: 1e-5 }); // any analysis
```

## How it is computed

For each run and each toleranced field of nominal value `p`, ElecMap draws a deviation `d` and uses `p · (1 + t · d)`:

- uniform: `d` uniform in [−1, 1];
- gaussian: `d` normal with σ = 1/3 (Box-Muller transform).

The random numbers come from mulberry32, a small 32-bit generator seeded by `seed`. The runs are drawn when `monteCarlo` is called, but each circuit is compiled only when an analysis needs it, and then kept: drawing 10 000 runs is instant, and each run then costs one analysis. On the RC filter above, 200 cut-off frequencies take about 0.1 s, and the 200 Bode plots of the Sallen-Key about 0.07 s.

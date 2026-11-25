---
title: Transfer functions
category: Guides
---

# Transfer functions

A transfer function H(s) relates an output (a voltage, a current) to an input source. ElecMap computes it exactly from the circuit, as a ratio of two polynomials in `s`.

## Get H(s)

```ts
import { ElecMap } from "elecmap";

const filter = new ElecMap(`
V1 in 0 AC 1
R1 in a 10k
R2 a b 10k
C1 a out 22n
C2 b 0 10n
X1 b out out OPAMP
`);

const H = filter.transferFunction("out"); // V(out) / V1
```

<figure class="em-figure">
{@include ./figures/sallen-key.svg}
<figcaption>A Sallen-Key low-pass filter (<code>X1</code> is an ideal op-amp: <code>X1 in+ in- out OPAMP</code>)</figcaption>
</figure>

### Choosing input and output

```ts
filter.transferFunction("out"); // V(out) / the only AC source
filter.transferFunction({ input: "V1", output: "out" }); // explicit input
filter.transferFunction({ input: "V1", output: ["a", "b"] }); // V(a) − V(b)
filter.transferFunction({ input: "V1", output: { current: "R1" } }); // I(R1) / V1 (admittance)
```

### Between two voltages of the circuit

The input can also be a node voltage rather than a source: `H = V(out) / V(in)`. The circuit is still driven by its source; the path from the source to `in` cancels out.

```ts
const stage = new ElecMap(`
V1 s 0 AC 1
R0 s in 470
R1 in out 1k
C1 out 0 100n`);
const H = stage.transferFunction({ input: { voltage: "in" }, output: "out" });
H.toString(); // "V(out)/V(in): (1) / (1 + 0.0001·s)"
H.cutoffFrequency(); // 1591.55
stage
  .transferFunction({ input: { voltage: ["in", "out"], source: "V1" }, output: "out" })
  .toString(); // "V(out)/V(in,out): (10000) / (s)", V(C1) / V(R1): an integrator
```

The voltage must depend on the source; otherwise the ratio is undefined and an `INVALID_ARGUMENT` error is thrown.

Without `source`, a circuit with several sources still works: every source that reaches the input voltage is tried, and the ratio is kept when they all give the same one. That is the case for sources in series, for instance harmonics summed into `ve`. When the ratio depends on which source drives, an `INVALID_ARGUMENT` error names the sources and `source` must be given.

```ts
const sum = new ElecMap(`
V1 ve m SIN(0 1 1k) AC 1
V2 m 0 SIN(0 0.33 3k) AC 1
R1 ve out 1k
C1 out 0 1u`);
sum.transferFunction({ input: { voltage: "ve" }, output: "out" }).toString();
// "V(out)/V(ve): (1) / (1 + 0.001·s)"
```

## Display it in LaTeX

```ts
H.toLatex();
// "\frac{1}{1 + \left(2 \times 10^{-4}\right) s + \left(2.2 \times 10^{-8}\right) s^{2}}"
```

<div class="em-math">\frac{1}{1 + \left(2 \times 10^{-4}\right) s + \left(2.2 \times 10^{-8}\right) s^{2}}</div>

Options change the presentation, never the value:

```ts
const rc = new ElecMap(`
V1 in 0 AC 1
R1 in out 1k
C1 out 0 100n
`).transferFunction("out");

rc.toLatex(); // "\frac{1}{1 + 10^{-4}\,s}"
rc.toLatex({ name: "H(s)", normalize: "monic" }); // "H(s) = \frac{10^{4}}{s + 10^{4}}"
rc.toLatex({ order: "descending" }); // "\frac{1}{10^{-4}\,s + 1}"
rc.toLatex({ variable: "p", digits: 3 }); // other variable name, 3 significant digits
rc.toString(); // "V(out)/V1: (1) / (1 + 0.0001·s)"
```

## Evaluate at a frequency

```ts
rc.evaluate(1000).toString(); // "0.716956800325 - 0.450477243368j"   H(j·2π·1000)
rc.magnitude(1000); // 0.8467
rc.magnitudeDb(1000); // -1.445   (dB)
rc.phase(1000); // -32.14   (degrees)
```

## Bode plot

```ts
const bode = H.bode({ fStart: 10, fStop: 1e5, points: 30 }); // 30 points per decade
bode.freq; // Hz
bode.magnitudeDb; // dB
bode.phase; // degrees, unwrapped (no ±180° jumps)
```

<figure class="em-figure">
{@include ./figures/sallen-key-bode.svg}
<figcaption>Bode plot of the Sallen-Key filter for three values of C1 (see <a href="./literal-transfer-functions.md">literal transfer functions</a> to recompute H(s) for each one)</figcaption>
</figure>

Without arguments, `bode()` picks a range around the poles and zeros.

## Filter characteristics

```ts
H.filterType(); // "lowpass"
H.naturalFrequency(); // 1073.0   f₀ (Hz)
H.qFactor(); // 0.742
H.dampingRatio(); // 0.674
H.cutoffFrequency(); // 1122.9   −3 dB (Hz)
H.dcGain(); // 1
H.highFrequencyGain(); // 0
```

For a band-pass, there are two cut-off frequencies:

```ts
const bandPass = new ElecMap(`
V1 in 0 AC 1
C1 in a 100n
R1 a 0 10k
R2 a out 10k
C2 out 0 1n
`).transferFunction("out");

bandPass.filterType(); // "bandpass"
bandPass.cutoffFrequencies(); // [154.6, 16388]
bandPass.peakFrequency(); // 1591.5
bandPass.peakGain(); // 0.980
```

`filterType()` returns one of `"lowpass"`, `"highpass"`, `"bandpass"`, `"bandstop"`, `"allpass"`, `"flat"`, `"other"`.

## Poles and zeros

```ts
const rlc = new ElecMap(`
V1 in 0 AC 1
R1 in a 20
L1 a out 10m
C1 out 0 1u
`).transferFunction("out");

rlc.poles().map(String); // ["-1000 - 9949.87437107j", "-1000 + 9949.87437107j"]   (rad/s)
rlc.zeros(); // []
rlc.isStable(); // true   (all poles in the left half-plane)
rlc.timeConstants(); // [0.001]   (s, 1/|Re p|)
rlc.order; // 2
```

## Response to a sine

`apply` gives the steady-state output for a sine (or a sum of sines) at the input:

```ts
const out = rc.apply({ amplitude: 2, freq: 1000, phase: 0 });
out.components[0].amplitude; // 1.693   (V)
out.components[0].phase; // -32.14  (degrees)
out.at(0.25e-3); // 1.434   value at t = 0.25 ms
```

A sum of sines is passed as an array, or with an offset:

```ts
rc.apply({
  offset: 1,
  components: [
    { amplitude: 1, freq: 100 },
    { amplitude: 1, freq: 10_000 }, // filtered out
  ],
});
```

For transients (steps, pulses, any signal), see [Time domain](./time-domain.md).

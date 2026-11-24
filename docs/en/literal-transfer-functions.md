---
title: Literal transfer functions
category: Guides
---

# Literal transfer functions

Instead of numbers, get H(s) written with the component names, as in a textbook. The result is exact, and values can be plugged back in at any time.

## From a circuit to a formula

```ts
import { ElecMap } from "elecmap";

const rc = new ElecMap(`
V1 in 0 AC 1
R1 in out 1k
C1 out 0 100n
`);

rc.symbolicTransferFunction("out").toLatex(); // "\frac{1}{1 + R_{1} C_{1} s}"
```

<div class="em-math">H(s) = \frac{1}{1 + R_{1} C_{1} s}</div>

It works for any linear circuit. The Sallen-Key filter:

<figure class="em-figure">
{@include ./figures/sallen-key.svg}
</figure>

```ts
const filter = new ElecMap(`
V1 in 0 AC 1
R1 in a 10k
R2 a b 10k
C1 a out 22n
C2 b 0 10n
X1 b out out OPAMP
`);

const H = filter.symbolicTransferFunction("out");
H.toLatex({ name: "H(s)" });
```

<div class="em-math">H(s) = \frac{1}{1 + C_{2} \left(R_{1} + R_{2}\right) s + R_{1} R_{2} C_{1} C_{2} s^{2}}</div>

The inverting amplifier gives the well-known `−Rf/R1`:

```ts
new ElecMap(`
V1 in 0 AC 1
R1 in n 1k
Rf n out 10k
X1 0 n out OPAMP
`)
  .symbolicTransferFunction("out")
  .toLatex(); // "-\frac{R_{f}}{R_{1}}"
```

<div class="em-math">-\frac{R_{f}}{R_{1}}</div>

## Plain text

```ts
H.toString();
// "V(out)/V1 = (1) / (1 + s*R1*C2 + s*R2*C2 + s^2*R1*R2*C1*C2)"
```

## Plug values back in

`substitute` turns the formula into a numeric {@link TransferFunction}. Components not mentioned keep their value from the netlist:

```ts
const tuned = H.substitute({ C1: 20e-9 });
tuned.qFactor(); // 0.7071   (Butterworth)
tuned.naturalFrequency(); // 1125.4  (Hz)
tuned.bode(); // and every other TransferFunction method
```

This is the fastest way to explore a design: the formula is computed once, then each `substitute` is instantaneous.

<figure class="em-figure">
{@include ./figures/sallen-key-bode.svg}
<figcaption>Three values of C1, three calls to <code>substitute</code></figcaption>
</figure>

## Keep only some components literal

The other components are replaced by their value:

```ts
filter.symbolicTransferFunction({ output: "out", symbols: ["C1", "C2"] }).toLatex();
```

<div class="em-math">\frac{1}{1 + \left(2 \times 10^{4}\right) C_{2} s + 10^{8} C_{1} C_{2} s^{2}}</div>

This also keeps large circuits fast: the cost grows with the number of symbols.

## Rename symbols

```ts
filter.symbolicTransferFunction({ output: "out", names: { R1: "R_a", R2: "R_b" } }).toLatex();
// uses R_a and R_b instead of R_{1} and R_{2}
```

## Descending powers

```ts
H.toLatex({ order: "descending" });
```

<div class="em-math">\frac{1}{R_{1} R_{2} C_{1} C_{2} s^{2} + C_{2} \left(R_{1} + R_{2}\right) s + 1}</div>

## Literal impedance

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

<div class="em-math">Z(s) = \frac{R_{1} R_{2}}{R_{1} + R_{2} + R_{1} R_{2} C_{1} s}</div>

The impedance is seen between `a` and the ground, with the sources turned off (V1 becomes a wire, so R1 ends up in parallel with R2 and C1).

## Symbol names

| Component                  | Symbol                             |
| -------------------------- | ---------------------------------- |
| `R1`, `L1`, `C1`, `Rf`     | `R_{1}`, `L_{1}`, `C_{1}`, `R_{f}` |
| coupling `K1`              | mutual inductance `M_{K1}`         |
| `E1` (VCVS), `H1` (CCVS)   | `A_{E1}`, `r_{H1}`                 |
| `G1` (VCCS), `F1` (CCCS)   | `g_{G1}`, `\beta_{F1}`             |
| op-amp `X1 … GAIN=… GBW=…` | `A_{X1}`, `\omega_{X1}`            |

A real op-amp makes the bandwidth appear:

```ts
new ElecMap(`
V1 in 0 AC 1
R1 in n 1k
Rf n out 10k
X1 0 n out OPAMP GAIN=1e5 GBW=1e6
`)
  .symbolicTransferFunction("out")
  .toLatex();
```

<div class="em-math">-\frac{R_{f} A_{X1} \omega_{X1}}{\omega_{X1} \left(R_{1} + R_{f} + R_{1} A_{X1}\right) + \left(R_{1} + R_{f}\right) s}</div>

## Limits

- Common factors made of a single term (`R_{1}`, `2`, `s`…) are simplified; a factor like `(1 + R_{1} C_{1} s)` shared by the numerator and the denominator is not.
- Up to about 30 unknowns. Beyond that, keep only the interesting components literal with `symbols`.

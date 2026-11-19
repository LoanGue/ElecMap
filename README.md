# ElecMap

[![CI](https://github.com/LoanGue/ElecMap/actions/workflows/ci.yml/badge.svg)](https://github.com/LoanGue/ElecMap/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-API-blue.svg)](https://loangue.github.io/ElecMap/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

> A TypeScript engine for electrical circuit analysis: describe a circuit as a SPICE netlist or JSON, then get transfer functions (numeric and literal, in LaTeX), node voltages, branch currents, equivalent impedances, time-domain responses and an SVG schematic, all from a single importable class.

- **Zero runtime dependencies**, ESM + CommonJS, full type definitions.
- Runs in **Node.js ≥ 18** and in **browsers**.
- Linear analysis by Modified Nodal Analysis: rational H(s) with exact pole/zero structure, cross-checked against literal (symbolic) results in the test suite.

**Status:** feature-complete for linear circuits; the first npm release (`npm install elecmap`) is coming.

## Quick start

```ts
import { ElecMap } from "elecmap";

const c = new ElecMap(`
V1 in 0 DC 5 AC 1
R1 in out 1k
C1 out 0 100n
`);

c.transferFunction("out").toLatex(); // \frac{1}{1 + 10^{-4}\,s}
c.symbolicTransferFunction("out").toLatex(); // \frac{1}{1 + R_{1} C_{1} s}
c.transferFunction("out").cutoffFrequency(); // 1591.55 Hz
c.voltage("out", { freq: 1e3 }).abs(); // 0.847 V (AC phasor)
c.current("R1"); // 0 A (DC operating point)
c.inputImpedance("V1").evaluate(1e3); // Complex Ω seen by V1 at 1 kHz
c.transient({ tStop: 1e-3 }).voltage("out"); // number[]
c.toSVG(); // standalone <svg> schematic
```

## Features

| Area           | What you get                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| Input          | SPICE netlists (engineering suffixes, `.title`, waveforms), canonical JSON, round-trip `toJSON()` / `toSpice()` |
| DC / AC        | Operating point, phasors at any frequency, log sweeps, voltage between any two nodes, current in any branch     |
| Transfer funcs | Exact H(s), LaTeX, Bode, poles/zeros, stability, filter type, cutoff, Q, ω₀, ζ, response to sines               |
| Literal H(s)   | Transfer functions and impedances in terms of component symbols (`R_{1}`, `C_{2}`…), with partial substitution  |
| Equivalents    | Equivalent R, L, C and Z(s), input/output impedance, Thévenin / Norton, maximum power transfer                  |
| Power          | DC and complex AC power per component                                                                           |
| Time domain    | Exact step/impulse/arbitrary-input responses of H(s); transient simulation (trapezoidal, Gear-2, Euler)         |
| Schematics     | Automatic SVG layout and routing, IEC or ANSI symbols, light/dark themes, interactive `data-*` attributes       |

Components: R, L, C, coupled inductors / transformers, independent V and I sources (DC, AC, sine, pulse, PWL, exp), the four controlled sources (E, F, G, H), op-amps (ideal, finite gain, single-pole GBW), fixed-state switches, diodes / Zener diodes, bipolar transistors (Ebers-Moll) and MOSFETs (level 1) with SPICE `.model` cards, solved by Newton-Raphson (see the [diodes](./docs/en/diodes.md) and [transistors](./docs/en/transistors.md) guides).

## Examples

Runnable with `npx tsx examples/<name>.ts` (all of them run in CI):

- [`rc-lowpass.ts`](./examples/rc-lowpass.ts): transfer function, Bode table, DC value, response to a sine.
- [`sallen-key.ts`](./examples/sallen-key.ts): literal vs numeric H(s), Q and f₀, re-tuning by substitution, step response.
- [`rlc-transient.ts`](./examples/rlc-transient.ts): transient simulation of a square-wave driven RLC compared with the exact step response.
- [`bridge-thevenin.ts`](./examples/bridge-thevenin.ts): node voltages, Thévenin equivalent, literal unbalance voltage, power balance.
- [`json-input.ts`](./examples/json-input.ts): building a circuit from JSON, exporting SPICE, error codes.
- [`schematic.ts`](./examples/schematic.ts): writes IEC and ANSI SVG drawings of a few circuits.

## Documentation

- [Input formats](./docs/en/format.md): netlist syntax, JSON document, validation codes.
- [Component catalogue](./docs/en/components.md): ports, fields, sign conventions.
- [Algorithms](./docs/en/algorithms.md): MNA, transfer functions, transient, layout, symbolic engine.
- [Documentation site](https://loangue.github.io/ElecMap/): guides with runnable examples and the full API reference, also [in French](https://loangue.github.io/ElecMap/fr/). It is rebuilt on every push to `main`; `npm run docs` builds it locally into `docs/api` (sources in `docs/en`, `docs/fr` and `docs/site`).

## Circuit input

Circuits are described with a standard **SPICE netlist** or with the canonical **JSON format**; both compile to the same immutable, validated circuit:

```ts
import { compile } from "elecmap";

const circuit = compile(`
V1 in 0 AC 1
R1 in out 4k7
C1 out 0 100n
`);
circuit.nodes; // ["in", "out"]
circuit.toJSON(); // { version: 1, ground: "0", components: [...] }
```

- [Formats: netlist syntax, JSON document, validation codes](./docs/en/format.md)
- [Component catalogue: ports, fields, sign conventions](./docs/en/components.md)

## Analyses available today

```ts
import { ElecMap } from "elecmap";

const c = new ElecMap(`
V1 in 0 DC 5 AC 1
R1 in out 1k
C1 out 0 100n
`);

c.voltage("out"); // 5 (DC, volts)
c.voltage("in", "out"); // 0 (between two nodes)
c.current("R1"); // 0 (DC, amperes, first node → second node)

const v = c.voltage("out", { freq: 1591.55 }); // AC phasor (Complex)
v.abs(); // ≈ 0.707
v.arg(); // ≈ −π/4

c.current("C1", { freq: 1e3, input: "V1", amplitude: 2 }); // drive one source only
c.acSweep({ fStart: 10, fStop: 1e6, points: 20 }).voltage("out"); // log sweep
c.operatingPoint().nodeVoltages(); // { "0": 0, in: 5, out: 5 }
c.power(); // DC power per component (W), sources negative
c.setValue("R1", 2200); // parametric changes, caches invalidated
```

### Transfer functions

```ts
const H = c.transferFunction("out"); // V(out) / V1 (the only AC source)
// or: c.transferFunction({ input: "V1", output: ["a", "b"] }), output: { current: "R2" }

H.toLatex(); // "\frac{1}{1 + 10^{-4}\,s}"
H.toLatex({ name: "H(s)", normalize: "monic" }); // "H(s) = \frac{10^{4}}{s + 10^{4}}"
H.evaluate(1e3); // Complex H(j·2π·1 kHz)
(H.magnitudeDb(1e3), H.phase(1e3)); // dB, degrees
H.apply({ amplitude: 2, freq: 1e3, phase: 0 }); // steady-state output sine(s), .at(t)
H.bode({ fStart: 10, fStop: 1e6 }); // { freq, magnitude, magnitudeDb, phase (unwrapped) }
(H.poles(), H.zeros(), H.isStable(), H.timeConstants());
(H.dcGain(), H.highFrequencyGain(), H.order);
H.filterType(); // "lowpass" | "highpass" | "bandpass" | "bandstop" | "allpass" | "flat" | "other"
(H.cutoffFrequency(), H.cutoffFrequencies(), H.bandwidth(), H.peakFrequency());
(H.naturalFrequency(), H.qFactor(), H.dampingRatio());
```

### Symbolic transfer functions

```ts
const c = new ElecMap(`
V1 in 0 AC 1
R1 in a 10k
R2 a b 10k
C1 a out 10n
C2 b 0 10n
X1 b out out OPAMP
`);
const H = c.symbolicTransferFunction("out");
H.toLatex({ name: "H(s)" });
// H(s) = \frac{1}{1 + C_{2} \left(R_{1} + R_{2}\right) s + R_{1} R_{2} C_{1} C_{2} s^{2}}
H.toString(); // V(out)/V1 = (1) / (1 + s*R1*C2 + s*R2*C2 + s^2*R1*R2*C1*C2)
H.substitute({ R1: 22e3 }); // numeric TransferFunction with new values (others: circuit values)
c.symbolicTransferFunction({ output: "out", symbols: ["C1", "C2"] }); // R1, R2 kept numeric
c.symbolicImpedance("a"); // literal Z(s)
```

Each component becomes a symbol named after its id (`R1` → `R_{1}`, `Rf` → `R_{f}`; `names` overrides it); controlled sources give `A_{E1}`, `g_{G1}`, `\beta_{F1}`, `r_{H1}`, couplings a mutual inductance `M_{K1}`, finite-gain op-amps `A_{X1}` and `\omega_{X1}`. The expression is exact: common monomial factors are removed, but non-trivial common factors are not searched for.

### Equivalents and power

```ts
c.equivalentResistance("a", "b"); // Ω (throws NOT_HOMOGENEOUS if the network is reactive)
c.equivalentCapacitance("a"); // F, purely capacitive networks
c.equivalentInductance("a"); // H, coupled inductors included
c.equivalentResistance("a", "b", { mode: "dc" }); // Z(0) of any network
c.equivalentCapacitance("a", "b", { mode: "freq", freq: 1e3 }); // value at 1 kHz

const Z = c.impedance("a", "b"); // Z(s) as a TransferFunction: .evaluate(f), .toLatex(), .poles()…
c.equivalentImpedance("a", "b", 1e3); // Complex Ω
(c.inputImpedance("V1"), c.outputImpedance("out")); // Z(s)

c.thevenin("out"); // { voltage, resistance, current (Norton), optimalLoad, maxPower }
c.thevenin("out", undefined, { freq: 1e3 }); // phasors, complex impedance, conjugate match

c.power(); // DC power per component (W)
c.power({ freq: 1e3 }); // complex power S = ½·V·I* (W + j·var) per component
```

### Time domain

```ts
const H = c.transferFunction({ input: "V1", output: "out" });
H.stepResponse({ tStop: 5e-3 }); // { time, value } — exact (matrix exponential), zero initial state
H.impulseResponse(); // h(t); a Dirac part (direct feed-through) is returned as `impulse`
H.stepInfo(); // { finalValue, peak, peakTime, overshoot (%), riseTime (10–90 %), settlingTime (2 %) }
H.response((t) => Math.sin(2 * Math.PI * 1e3 * t), { tStop: 5e-3 }); // any input

const tr = c.transient({
  tStop: 10e-3,
  tStep: 1e-6, // default tStop / 1000
  method: "gear2", // or "trap", "euler"
  inputs: { V1: { kind: "pulse", v1: 0, v2: 5, width: 1e-3, period: 2e-3 } }, // or (t) => …
});
tr.time; // s
(tr.voltage("out"), tr.current("C1"), tr.power("R1")); // arrays aligned with tr.time
```

Sources keep their SPICE waveform (`SIN`, `PULSE`, `PWL`, `EXP`) unless overridden by `inputs`. The simulation starts from the DC operating point, or from the `IC=` values of capacitors and inductors when any is given (`initial: "op" | "ic"` to force).

### Schematic drawing

```ts
const svg = c.toSVG(); // standalone <svg> string, IEC symbols, light/dark aware
c.toSVG({
  style: "ansi", // zig-zag resistors, +/− sources
  showValues: true, // "10 kΩ", "AC 1 V", "10·V(c,0)"…
  showIds: true,
  nodeLabels: "named", // true (all), false, or "named": hides purely numeric SPICE nodes
  highlight: ["R1", "out"], // components and/or nodes drawn in the accent colour
  theme: "auto", // "light" | "dark" | "none" (no <style>, style it yourself)
  scale: 20, // px per grid unit
  background: false,
  title: "RC low-pass", // <title> for accessibility
});
c.layout(); // the placement itself: components, pins, wire segments, junctions, grounds
```

The layout is computed from scratch, without any external library: nodes are ordered into columns from the source to the output, shunt elements hang vertically to individual ground symbols, series elements run horizontally and feedback branches go above; wires are then routed on a grid by an A* maze router that forbids overlaps and only allows perpendicular crossings. Every element carries `data-id` / `data-node` / `data-type` attributes so a host page can make the drawing interactive. Details in [algorithms](./docs/en/algorithms.md#schematic-layout).

Supported components: R, C, L, coupled inductors (K), independent V/I sources, the four controlled sources (E, G, F, H), op-amps (ideal, finite gain, single-pole GBW), fixed-state switches, diodes (D), bipolar transistors (Q) and MOSFETs (M), with `.model` cards. See [algorithms](./docs/en/algorithms.md#modified-nodal-analysis) for how they are stamped.

## Limitations

- Non-linear components: diodes, BJTs (Ebers-Moll with Early effect) and level-1 MOSFETs; their capacitances are constant. Switches have a fixed state.
- `.model` supports `D`, `NPN`, `PNP`, `NMOS`, `PMOS` (level 1); no `.subckt` / `.include` yet: netlists must be flat.
- Literal transfer functions are linear-only: a circuit with a diode gives its numeric, linearised transfer function only.
- Literal transfer functions remove common monomial factors only; a pole/zero cancellation that holds for every component value may leave the expression one order higher than the numeric one. They are limited to about 30 unknowns (use `symbols` to keep only some components literal).
- Dense linear algebra: comfortable up to a few hundred nodes.

## Roadmap

1. ✅ Tooling & CI
2. ✅ Math core (complex numbers, polynomials, linear solvers)
3. ✅ Input formats (SPICE parser, JSON schema, validation)
4. ✅ Linear components & Modified Nodal Analysis
5. ✅ DC / AC analyses, `voltage` / `current`
6. ✅ Numeric transfer functions
7. ✅ Equivalent impedances, Thévenin / Norton, power
8. ✅ Transient analysis
9. ✅ SVG rendering
10. ✅ Symbolic transfer functions
11. ✅ Documentation, examples, packaging checks
12. First npm release (v0.1.0)
13. Non-linear components: 🚧 diodes and Newton-Raphson ✅, BJT and MOSFET ✅; `.subckt`, sensitivities

## Development

```sh
npm install
npm run check   # lint, format, type-check, tests, build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow and [docs/algorithms.md](./docs/en/algorithms.md) for the numerical methods.

## License

[MIT](./LICENSE) © Loan Gue

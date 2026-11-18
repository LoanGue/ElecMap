# ElecMap

> A TypeScript engine for electrical circuit analysis: compile a schematic, feed it a signal, and get transfer functions, node voltages, branch currents, equivalent impedances and an optimised SVG drawing, all from a single importable class.

**Status:** 🚧 early development, not yet published on npm.

## Goals

- **Input formats:** standard SPICE netlists and a canonical, machine-readable JSON format (the compiled form).
- **One class:** build an `ElecMap` instance from a schematic, then call analysis methods with your variables (input frequency, time, signal…).
- **Analyses:** DC operating point, AC sweep, transient, transfer functions (LaTeX output, numeric then symbolic), poles/zeros, Bode data, voltage between any two nodes, current in any branch, equivalent R/L/C/Z, Thévenin/Norton, power balance.
- **Rendering:** automatic, readable SVG schematic layout.
- **Zero runtime dependencies**, ESM + CJS, full type definitions, works in browsers and Node.js.

## Planned API (preview)

```ts
import { ElecMap } from "elecmap";

const circuit = new ElecMap(`
V1 in 0 AC 1
R1 in out 1k
C1 out 0 100n
`);

const H = circuit.transferFunction({ input: "V1", output: ["out", "0"] });
H.toLatex(); // \frac{1}{1 + 10^{-4} s}
H.evaluate(1591.5); // |H| ≈ 0.707, phase ≈ -45°
circuit.voltage("in", "out", { freq: 1000 });
circuit.current("R1", { freq: 1000 });
circuit.toSVG();
```

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

- [Formats: netlist syntax, JSON document, validation codes](./docs/format.md)
- [Component catalogue: ports, fields, sign conventions](./docs/components.md)

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

A runnable example lives in [`examples/rc-lowpass.ts`](./examples/rc-lowpass.ts).

Supported components: R, C, L, coupled inductors (K), independent V/I sources, the four controlled sources (E, G, F, H), op-amps (ideal, finite gain, single-pole GBW) and fixed-state switches. See [algorithms](./docs/algorithms.md#modified-nodal-analysis) for how they are stamped.

## Roadmap

1. ✅ Tooling & CI
2. ✅ Math core (complex numbers, polynomials, linear solvers)
3. ✅ Input formats (SPICE parser, JSON schema, validation)
4. ✅ Linear components & Modified Nodal Analysis
5. ✅ DC / AC analyses, `voltage` / `current`
6. ✅ Numeric transfer functions
7. Equivalent impedances, Thévenin / Norton, power
8. Transient analysis
9. SVG rendering
10. Symbolic transfer functions
11. Non-linear components (diodes, BJT, MOSFET)

## Development

```sh
npm install
npm run check   # lint, format, type-check, tests, build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow and [docs/algorithms.md](./docs/algorithms.md) for the numerical methods.

## License

[MIT](./LICENSE) © Loan Gue

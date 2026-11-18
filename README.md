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

## Roadmap

1. ✅ Tooling & CI
2. ✅ Math core (complex numbers, polynomials, linear solvers)
3. Input formats (SPICE parser, JSON schema, validation)
4. Linear components & Modified Nodal Analysis
5. DC / AC analyses, `voltage` / `current`
6. Numeric transfer functions
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

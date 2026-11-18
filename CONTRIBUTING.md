# Contributing to ElecMap

Thanks for your interest! ElecMap is a zero-dependency TypeScript library.

## Setup

Requires Node.js 22 or newer for development (the published package itself runs on Node.js 18+ and modern browsers).

```sh
git clone https://github.com/LoanGue/ElecMap.git
cd ElecMap
npm install
```

## Scripts

| Command             | Description                                         |
| ------------------- | --------------------------------------------------- |
| `npm run build`     | Build ESM + CJS bundles and type definitions (tsup) |
| `npm test`          | Run the test suite (vitest)                         |
| `npm run coverage`  | Run tests with coverage                             |
| `npm run lint`      | Lint with ESLint                                    |
| `npm run format`    | Format with Prettier                                |
| `npm run typecheck` | Type-check with `tsc`                               |
| `npm run docs`      | Generate API docs into `docs/api` (typedoc)         |
| `npm run examples`  | Run every script of `examples/`                     |
| `npm run test:pack` | Pack the library and import it as ESM and CJS       |
| `npm run check`     | Lint, format, types, tests, build                   |

CI runs `check` on Node 22 and 24, plus `examples`, `docs` (warnings are errors) and `test:pack`.

## Workflow

1. Create a branch (`feat/...`, `fix/...`, `docs/...`, `chore/...`).
2. Add tests for any behaviour change. Analytical reference values are preferred (e.g. `fc = 1/(2πRC)`).
3. Run `npm run check`.
4. If the change affects the published package, add a changeset: `npx changeset`.
5. Open a pull request against `main`.

## Project layout

| Path             | Content                                                                    |
| ---------------- | -------------------------------------------------------------------------- |
| `src/math`       | Complex numbers, polynomials, rational functions, linear solvers, roots    |
| `src/format`     | SPICE parser and writer, JSON types and schema, catalogue, units           |
| `src/core`       | Compilation and validation of circuits, errors                             |
| `src/mna`        | Modified Nodal Analysis: per-component models (stamps) and system assembly |
| `src/analysis`   | DC, AC, transfer functions, equivalents, power, transient                  |
| `src/symbolic`   | Multivariate polynomials and literal transfer functions                    |
| `src/render`     | Schematic layout, routing and SVG output                                   |
| `src/ElecMap.ts` | The facade class                                                           |
| `tests/`         | vitest suites, mirroring `src/`                                            |
| `examples/`      | Runnable examples (`npx tsx examples/<name>.ts`)                           |

## Adding a component

1. Declare its JSON shape in `src/format/types.ts` and its SPICE syntax in `src/format/spice.ts` (parser and writer).
2. Add it to the catalogue in `src/format/catalog.ts`, to the validation in `src/format/validate.ts` and to [docs/components.md](./docs/components.md).
3. Write its MNA model in `src/mna/models.ts`: stamps for DC/AC, companion model for transient, linear forms for currents.
4. Give it a symbolic stamp in `src/symbolic/system.ts` and a symbol in `src/render`.
5. Test it against an analytical result, and cross-check numeric vs symbolic in `tests/symbolic`.

## Conventions

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/).
- Public APIs must have TSDoc comments: they feed the generated documentation.
- No runtime dependencies.

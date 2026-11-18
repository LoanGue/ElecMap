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

| Command             | Description                                           |
| ------------------- | ----------------------------------------------------- |
| `npm run build`     | Build ESM + CJS bundles and type definitions (tsup)   |
| `npm test`          | Run the test suite (vitest)                           |
| `npm run coverage`  | Run tests with coverage                               |
| `npm run lint`      | Lint with ESLint                                      |
| `npm run format`    | Format with Prettier                                  |
| `npm run typecheck` | Type-check with `tsc`                                 |
| `npm run docs`      | Generate API docs into `docs/api` (typedoc)           |
| `npm run check`     | Everything CI runs: lint, format, types, tests, build |

## Workflow

1. Create a branch (`feat/...`, `fix/...`, `docs/...`, `chore/...`).
2. Add tests for any behaviour change. Analytical reference values are preferred (e.g. `fc = 1/(2πRC)`).
3. Run `npm run check`.
4. If the change affects the published package, add a changeset: `npx changeset`.
5. Open a pull request against `main`.

## Conventions

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/).
- Public APIs must have TSDoc comments: they feed the generated documentation.
- No runtime dependencies.

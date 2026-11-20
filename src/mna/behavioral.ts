/**
 * Behavioural sources: their expression compiled into a function of the MNA
 * unknowns that returns its value and its gradient (forward-mode automatic
 * differentiation), for the Newton linearisation.
 *
 * @module
 */
import { ElecMapError } from "../core/errors";
import { applyBinary, applyFunction, parseExpression } from "../format/expression";
import type { Expr } from "../format/expression";

/** A probed quantity: `Σ coef·x[index]` (ground indices already removed). */
export type ProbeForm = { index: number; coef: number }[];

/** Compiled expression of a behavioural source. */
export interface CompiledExpression {
  /** Probed quantities, in the order of the gradient. */
  readonly probes: readonly ProbeForm[];
  /** Value and partial derivatives with respect to each probe, at the probe values `u`. */
  evaluate(u: readonly number[], time: number): { value: number; gradient: number[] };
}

/** How the probes of an expression map to the MNA unknowns. */
export interface ProbeResolver {
  /** `V(a)` (index −1 for ground). */
  node(name: string): number;
  /** `I(id)`: the current of a component, as a combination of unknowns. */
  current(id: string): ProbeForm;
}

type Dual = { v: number; d: number[] };

/** Compiles the expression of a behavioural source. */
export function compileExpression(
  id: string,
  source: string,
  resolve: ProbeResolver,
): CompiledExpression {
  const fail = (m: string): never => {
    throw new ElecMapError("INVALID_ARGUMENT", `${id}: ${m}`, { componentId: id });
  };
  const tree = parseExpression(source, fail, { probes: true });
  const probes: ProbeForm[] = [];
  const keys = new Map<string, number>();
  const slot = (key: string, form: () => ProbeForm) => {
    let k = keys.get(key);
    if (k === undefined) {
      k = probes.length;
      keys.set(key, k);
      probes.push(form());
    }
    return k;
  };
  const voltage = (a: string, b?: string): ProbeForm =>
    [
      { index: resolve.node(a), coef: 1 },
      ...(b === undefined ? [] : [{ index: resolve.node(b), coef: -1 }]),
    ].filter((t) => t.index >= 0);

  type Node = (u: readonly number[], time: number) => Dual;
  const n = () => probes.length;
  const constant =
    (v: number): Node =>
    () => ({ v, d: new Array<number>(n()).fill(0) });

  const build = (e: Expr): Node => {
    switch (e.k) {
      case "num":
        return constant(e.v);
      case "id":
        if (e.name === "TIME") return (_u, t) => ({ v: t, d: new Array<number>(n()).fill(0) });
        if (e.name === "PI") return constant(Math.PI);
        if (e.name === "E") return constant(Math.E);
        return fail(`unknown parameter "${e.name.toLowerCase()}" in "${source}"`);
      case "probe": {
        const k =
          e.kind === "V"
            ? slot(`V:${e.args.join(",")}`, () => voltage(e.args[0] as string, e.args[1]))
            : slot(`I:${e.args[0] as string}`, () => resolve.current(e.args[0] as string));
        return (u) => {
          const d = new Array<number>(n()).fill(0);
          d[k] = 1;
          return { v: u[k] as number, d };
        };
      }
      case "unary": {
        const x = build(e.x);
        if (e.op === "-") {
          return (u, t) => {
            const a = x(u, t);
            return { v: -a.v, d: a.d.map((g) => -g) };
          };
        }
        return (u, t) => ({ v: x(u, t).v === 0 ? 1 : 0, d: new Array<number>(n()).fill(0) });
      }
      case "binary": {
        const [l, r] = [build(e.l), build(e.r)];
        const op = e.op;
        return (u, t) => {
          const a = l(u, t);
          const b = r(u, t);
          const v = applyBinary(op, a.v, b.v);
          let d: number[];
          switch (op) {
            case "+":
              d = a.d.map((g, i) => g + (b.d[i] as number));
              break;
            case "-":
              d = a.d.map((g, i) => g - (b.d[i] as number));
              break;
            case "*":
              d = a.d.map((g, i) => g * b.v + a.v * (b.d[i] as number));
              break;
            case "/":
              d = a.d.map((g, i) => (g * b.v - a.v * (b.d[i] as number)) / (b.v * b.v));
              break;
            case "^": {
              const { partials } = applyFunction("POW", [a.v, b.v]);
              const [pa, pb] = partials as [number, number];
              d = a.d.map((g, i) => pa * g + (pb === 0 ? 0 : pb * (b.d[i] as number)));
              break;
            }
            default:
              d = new Array<number>(n()).fill(0);
          }
          return { v, d };
        };
      }
      case "call": {
        const args = e.args.map(build);
        const f = e.f;
        return (u, t) => {
          const xs = args.map((a) => a(u, t));
          const { value, partials } = applyFunction(
            f,
            xs.map((x) => x.v),
          );
          const d = new Array<number>(n()).fill(0);
          xs.forEach((x, j) => {
            const p = partials[j] as number;
            if (p !== 0) x.d.forEach((g, i) => (d[i] = (d[i] as number) + p * g));
          });
          return { v: value, d };
        };
      }
    }
  };

  const root = build(tree);
  return {
    probes,
    evaluate(u, time) {
      const r = root(u, time);
      // A slope that is not finite (√ at 0…) would make the Jacobian unusable.
      return { value: r.v, gradient: r.d.map((g) => (Number.isFinite(g) ? g : 0)) };
    },
  };
}

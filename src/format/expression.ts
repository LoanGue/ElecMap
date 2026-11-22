/**
 * Arithmetic expressions: SPICE parameters (`{2*R}`, `.param F={1/(2*pi*R*C)}`)
 * and the expressions of behavioural sources (`V=V(in)^2/2`).
 *
 * Numbers accept SPICE suffixes (`1k`, `100n`); identifiers are parameters
 * (case-insensitive) or the constants `pi` and `e`. Operators, from the lowest
 * precedence: `||`, `&&`, comparisons `< <= > >= == !=` (1 when true, 0
 * otherwise), `+ -`, `* /`, unary `- + !`, `^` or `**` (power,
 * right-associative); parentheses. Functions: see {@link EXPRESSION_FUNCTIONS}.
 *
 * Behavioural expressions also accept the probes `V(node)`, `V(a,b)`,
 * `I(component)` and the variable `time` (s).
 *
 * @module
 */
import { parseValue } from "./units";

/** Parameter values, keyed by upper-case name. */
export type ParamScope = ReadonlyMap<string, number>;

const CONSTANTS: Record<string, number> = { PI: Math.PI, E: Math.E };

/** Binary operators of an {@link Expr}. */
export type BinaryOperator =
  "+" | "-" | "*" | "/" | "^" | "<" | "<=" | ">" | ">=" | "==" | "!=" | "&&" | "||";

/** Syntax tree of an expression. */
export type Expr =
  | { k: "num"; v: number }
  /** Parameter, constant or `TIME` (upper-case). */
  | { k: "id"; name: string }
  /** `V(a)`, `V(a,b)` (node names as written) or `I(id)`. */
  | { k: "probe"; kind: "V" | "I"; args: string[] }
  | { k: "unary"; op: "-" | "!"; x: Expr }
  | { k: "binary"; op: BinaryOperator; l: Expr; r: Expr }
  /** Function call, name upper-case. */
  | { k: "call"; f: string; args: Expr[] };

/** A function of expressions: its value and partial derivatives. */
interface FunctionSpec {
  /** Accepted argument counts (`[min, max]`, max `Infinity` for variadic). */
  arity: readonly [number, number];
  value: (...a: number[]) => number;
  /** Partial derivatives `∂f/∂aᵢ`. */
  partials: (...a: number[]) => number[];
}

const unary = (value: (x: number) => number, d: (x: number) => number): FunctionSpec => ({
  arity: [1, 1],
  value,
  partials: (x) => [d(x as number)],
});
const flat = (value: (...a: number[]) => number, arity: readonly [number, number]) => ({
  arity,
  value,
  partials: (...a: number[]) => a.map(() => 0),
});
const pick = (better: (a: number, b: number) => boolean): FunctionSpec => ({
  arity: [1, Infinity],
  value: (...a) => a.reduce((m, x) => (better(x, m) ? x : m)),
  partials: (...a) => {
    let k = 0;
    a.forEach((x, i) => {
      if (better(x, a[k] as number)) k = i;
    });
    return a.map((_, i) => (i === k ? 1 : 0));
  },
});
const pow: FunctionSpec = {
  arity: [2, 2],
  value: (a, b) => Math.pow(a as number, b as number),
  partials: (a, b) => {
    const [x, y] = [a as number, b as number];
    return [y === 0 ? 0 : y * Math.pow(x, y - 1), x > 0 ? Math.pow(x, y) * Math.log(x) : 0];
  },
};

const FUNCTIONS: Record<string, FunctionSpec> = {
  SQRT: unary(Math.sqrt, (x) => 0.5 / Math.sqrt(x)),
  EXP: unary(Math.exp, Math.exp),
  LOG: unary(Math.log, (x) => 1 / x),
  LN: unary(Math.log, (x) => 1 / x),
  LOG10: unary(Math.log10, (x) => 1 / (x * Math.LN10)),
  ABS: unary(Math.abs, (x) => Math.sign(x)),
  SIN: unary(Math.sin, Math.cos),
  COS: unary(Math.cos, (x) => -Math.sin(x)),
  TAN: unary(Math.tan, (x) => 1 / Math.cos(x) ** 2),
  ASIN: unary(Math.asin, (x) => 1 / Math.sqrt(1 - x * x)),
  ACOS: unary(Math.acos, (x) => -1 / Math.sqrt(1 - x * x)),
  ATAN: unary(Math.atan, (x) => 1 / (1 + x * x)),
  SINH: unary(Math.sinh, Math.cosh),
  COSH: unary(Math.cosh, Math.sinh),
  TANH: unary(Math.tanh, (x) => 1 - Math.tanh(x) ** 2),
  ATAN2: {
    arity: [2, 2],
    value: (y, x) => Math.atan2(y as number, x as number),
    partials: (y, x) => {
      const r = (x as number) ** 2 + (y as number) ** 2;
      return [(x as number) / r, -(y as number) / r];
    },
  },
  MIN: pick((a, b) => a < b),
  MAX: pick((a, b) => a > b),
  POW: pow,
  FLOOR: flat(Math.floor, [1, 1]),
  CEIL: flat(Math.ceil, [1, 1]),
  ROUND: flat(Math.round, [1, 1]),
  SGN: flat(Math.sign, [1, 1]),
  SIGN: flat(Math.sign, [1, 1]),
  U: flat((x) => ((x as number) > 0 ? 1 : 0), [1, 1]),
  URAMP: unary(
    (x) => Math.max(x, 0),
    (x) => (x > 0 ? 1 : 0),
  ),
  LIMIT: {
    arity: [3, 3],
    value: (x, lo, hi) => Math.min(Math.max(x as number, lo as number), hi as number),
    partials: (x, lo, hi) => {
      const [v, a, b] = [x as number, lo as number, hi as number];
      return v < a ? [0, 1, 0] : v > b ? [0, 0, 1] : [1, 0, 0];
    },
  },
  IF: {
    arity: [3, 3],
    value: (c, a, b) => (c !== 0 ? (a as number) : (b as number)),
    partials: (c) => (c !== 0 ? [0, 1, 0] : [0, 0, 1]),
  },
};
/**
 * Functions available in expressions (names are case-insensitive): `sqrt exp
 * log ln log10 abs sin cos tan asin acos atan atan2 sinh cosh tanh min max pow
 * floor ceil round sgn sign u uramp limit if`.
 *
 * `u(x)` is the unit step (1 for `x > 0`), `uramp(x) = max(x, 0)`,
 * `limit(x, lo, hi)` clamps `x`, and `if(c, a, b)` is `a` when `c ≠ 0`.
 */
export const EXPRESSION_FUNCTIONS: readonly string[] = Object.keys(FUNCTIONS).map((f) =>
  f.toLowerCase(),
);

type Tok =
  | { k: "num"; v: number }
  | { k: "id"; v: string }
  | { k: "op"; v: string }
  | { k: "probe"; kind: "V" | "I"; args: string[] };

const PROBE = /\s*([vi])\s*\(\s*([^\s(),]+)\s*(?:,\s*([^\s(),]+)\s*)?\)/iy;
const TOKEN =
  /\s*(?:((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:[a-zµμΩ][a-z0-9µμΩ]*)?)|([a-z_][a-z0-9_]*)|(\*\*|<=|>=|==|!=|&&|\|\||[-+*/^(),<>!]))/iy;

function lex(src: string, probes: boolean, fail: (m: string) => never): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    if (probes) {
      PROBE.lastIndex = i;
      const p = PROBE.exec(src);
      if (p) {
        const kind = (p[1] as string).toUpperCase() as "V" | "I";
        const args = [p[2] as string, ...(p[3] === undefined ? [] : [p[3]])];
        if (kind === "I" && args.length > 1) fail(`I() takes one component id`);
        out.push({ k: "probe", kind, args });
        i = PROBE.lastIndex;
        continue;
      }
    }
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(src);
    if (!m) fail(`unexpected "${src.slice(i).trim()}"`);
    if (m[1] !== undefined) {
      const v = parseValue(m[1]);
      if (v === undefined) fail(`invalid number "${m[1]}"`);
      out.push({ k: "num", v });
    } else if (m[2] !== undefined) out.push({ k: "id", v: m[2].toUpperCase() });
    else out.push({ k: "op", v: m[3] === "**" ? "^" : (m[3] as string) });
    i = TOKEN.lastIndex;
  }
  return out;
}

/** Options of {@link parseExpression}. */
export interface ParseExpressionOptions {
  /** Accept the probes `V(…)` and `I(…)` (behavioural sources). */
  probes?: boolean;
}

/**
 * Parses an expression into its syntax tree. Identifiers are not resolved.
 *
 * @param fail called with a message on any error (it must throw).
 */
export function parseExpression(
  src: string,
  fail: (message: string) => never,
  options: ParseExpressionOptions = {},
): Expr {
  const err = (m: string): never => fail(`in "${src}": ${m}`);
  const toks = lex(src, options.probes ?? false, err);
  let i = 0;
  const isOp = (...vs: string[]) => {
    const t = toks[i];
    return t?.k === "op" && vs.includes(t.v);
  };
  const expect = (v: string) => {
    if (!isOp(v)) err(`expected "${v}"`);
    i++;
  };
  const left =
    (next: () => Expr, ...ops: BinaryOperator[]) =>
    (): Expr => {
      let l = next();
      while (isOp(...ops)) {
        const op = (toks[i++] as { v: string }).v as BinaryOperator;
        l = { k: "binary", op, l, r: next() };
      }
      return l;
    };

  const atom = (): Expr => {
    const t = toks[i];
    if (t === undefined) return err("unexpected end");
    i++;
    if (t.k === "num") return { k: "num", v: t.v };
    if (t.k === "probe") return { k: "probe", kind: t.kind, args: t.args };
    if (t.k === "op") {
      if (t.v !== "(") return err(`unexpected "${t.v}"`);
      const v = or();
      expect(")");
      return v;
    }
    if (isOp("(")) {
      const f = FUNCTIONS[t.v];
      if (!f) return err(`unknown function "${t.v.toLowerCase()}"`);
      i++;
      const args = [or()];
      while (isOp(",")) {
        i++;
        args.push(or());
      }
      expect(")");
      const [min, max] = f.arity;
      if (args.length < min || args.length > max) {
        const n = min === max ? `${min}` : max === Infinity ? `at least ${min}` : `${min}-${max}`;
        err(`${t.v.toLowerCase()}() takes ${n} argument${min === 1 && max === 1 ? "" : "s"}`);
      }
      return { k: "call", f: t.v, args };
    }
    return { k: "id", name: t.v };
  };
  const power = (): Expr => {
    const base = atom();
    if (isOp("^")) {
      i++;
      return { k: "binary", op: "^", l: base, r: prefix() };
    }
    return base;
  };
  const prefix = (): Expr => {
    if (isOp("-", "!")) {
      const op = (toks[i++] as { v: string }).v as "-" | "!";
      return { k: "unary", op, x: prefix() };
    }
    if (isOp("+")) {
      i++;
      return prefix();
    }
    return power();
  };
  const product = left(prefix, "*", "/");
  const sum = left(product, "+", "-");
  const compare = left(sum, "<", "<=", ">", ">=", "==", "!=");
  const and = left(compare, "&&");
  const or: () => Expr = left(and, "||");

  const e = or();
  if (i < toks.length) {
    const t = toks[i] as Tok;
    err(`unexpected "${t.k === "probe" ? t.kind : String(t.v)}"`);
  }
  return e;
}

/** Value of a binary operator. */
export function applyBinary(op: BinaryOperator, a: number, b: number): number {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return a / b;
    case "^":
      return a ** b;
    case "<":
      return a < b ? 1 : 0;
    case "<=":
      return a <= b ? 1 : 0;
    case ">":
      return a > b ? 1 : 0;
    case ">=":
      return a >= b ? 1 : 0;
    case "==":
      return a === b ? 1 : 0;
    case "!=":
      return a !== b ? 1 : 0;
    case "&&":
      return a !== 0 && b !== 0 ? 1 : 0;
    case "||":
      return a !== 0 || b !== 0 ? 1 : 0;
  }
}

/** Value and partial derivatives of a function call. */
export function applyFunction(f: string, args: number[]): { value: number; partials: number[] } {
  const spec = FUNCTIONS[f] as FunctionSpec;
  return { value: spec.value(...args), partials: spec.partials(...args) };
}

/**
 * Replaces every parameter and constant by its value and folds the constant
 * sub-expressions. `TIME` and probes stay.
 *
 * @param keep identifiers left as they are (e.g. `TIME`).
 */
export function resolveParameters(
  e: Expr,
  scope: ParamScope,
  fail: (message: string) => never,
  keep: readonly string[] = [],
): Expr {
  const go = (x: Expr): Expr => {
    switch (x.k) {
      case "num":
      case "probe":
        return x;
      case "id": {
        if (keep.includes(x.name)) return x;
        const v = scope.get(x.name) ?? CONSTANTS[x.name];
        if (v === undefined) return fail(`unknown parameter "${x.name.toLowerCase()}"`);
        return { k: "num", v };
      }
      case "unary": {
        const a = go(x.x);
        if (a.k === "num") return { k: "num", v: x.op === "-" ? -a.v : a.v === 0 ? 1 : 0 };
        return { ...x, x: a };
      }
      case "binary": {
        const [l, r] = [go(x.l), go(x.r)];
        if (l.k === "num" && r.k === "num") return { k: "num", v: applyBinary(x.op, l.v, r.v) };
        return { ...x, l, r };
      }
      case "call": {
        const args = x.args.map(go);
        if (args.every((a) => a.k === "num")) {
          return {
            k: "num",
            v: applyFunction(
              x.f,
              args.map((a) => (a as { v: number }).v),
            ).value,
          };
        }
        return { ...x, args };
      }
    }
  };
  return go(e);
}

/**
 * Evaluates an expression with the given parameters.
 *
 * @param fail called with a message on any error (it must throw).
 */
export function evaluate(src: string, scope: ParamScope, fail: (message: string) => never): number {
  const err = (m: string): never => fail(`in "${src}": ${m}`);
  const e = resolveParameters(parseExpression(src, fail), scope, err);
  const v = (e as { v: number }).v;
  if (!Number.isFinite(v)) err("the result is not a finite number");
  return v;
}

const PRECEDENCE: Record<BinaryOperator, number> = {
  "||": 1,
  "&&": 2,
  "<": 3,
  "<=": 3,
  ">": 3,
  ">=": 3,
  "==": 3,
  "!=": 3,
  "+": 4,
  "-": 4,
  "*": 5,
  "/": 5,
  "^": 7,
};

/**
 * Writes an expression back as text, with the parentheses it needs. `power`
 * spells the power operator (`**` for LTspice, where `^` is a logical XOR).
 */
export function formatExpression(e: Expr, options: { power?: "^" | "**" } = {}): string {
  const power = options.power ?? "^";
  // Levels: binary operators 1–5 and 7, unary 6, atoms 8.
  const level = (x: Expr): number =>
    x.k === "binary" ? PRECEDENCE[x.op] : x.k === "unary" ? 6 : x.k === "num" && x.v < 0 ? 6 : 8;
  const wrap = (x: Expr, min: number) => (level(x) < min ? `(${go(x)})` : go(x));
  const go = (x: Expr): string => {
    switch (x.k) {
      case "num":
        return String(x.v);
      case "id":
        return x.name.toLowerCase();
      case "probe":
        return `${x.kind}(${x.args.join(",")})`;
      case "unary":
        return `${x.op}${wrap(x.x, 6)}`;
      case "call":
        return `${x.f.toLowerCase()}(${x.args.map(go).join(", ")})`;
      case "binary": {
        const p = PRECEDENCE[x.op];
        // "^" is right-associative, the others left-associative.
        const [lmin, rmin] = x.op === "^" ? [p + 1, p] : [p, p + 1];
        const sep = p >= 5 ? "" : " ";
        const op = x.op === "^" ? power : x.op;
        return `${wrap(x.l, lmin)}${sep}${op}${sep}${wrap(x.r, rmin)}`;
      }
    }
  };
  return go(e);
}

/** Every probe of an expression. */
export function probesOf(e: Expr): Extract<Expr, { k: "probe" }>[] {
  switch (e.k) {
    case "probe":
      return [e];
    case "unary":
      return probesOf(e.x);
    case "binary":
      return [...probesOf(e.l), ...probesOf(e.r)];
    case "call":
      return e.args.flatMap(probesOf);
    default:
      return [];
  }
}

/** Renames the nodes and components the probes of an expression refer to. */
export function renameProbes(
  e: Expr,
  node: (n: string) => string,
  component: (id: string) => string,
): Expr {
  switch (e.k) {
    case "probe":
      return { ...e, args: e.args.map(e.kind === "V" ? node : component) };
    case "unary":
      return { ...e, x: renameProbes(e.x, node, component) };
    case "binary":
      return {
        ...e,
        l: renameProbes(e.l, node, component),
        r: renameProbes(e.r, node, component),
      };
    case "call":
      return { ...e, args: e.args.map((a) => renameProbes(a, node, component)) };
    default:
      return e;
  }
}

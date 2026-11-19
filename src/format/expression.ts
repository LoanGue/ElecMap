/**
 * Arithmetic expressions of SPICE parameters: `{2*R}`, `.param F={1/(2*pi*R*C)}`.
 *
 * Numbers accept SPICE suffixes (`1k`, `100n`); identifiers are parameters
 * (case-insensitive) or the constants `pi` and `e`. Operators: `+ - * /`, `^` or
 * `**` (power, right-associative), unary `-` and `+`, parentheses. Functions:
 * `sqrt exp log ln log10 abs sin cos tan atan min max pow`.
 *
 * @module
 */
import { parseValue } from "./units";

/** Parameter values, keyed by upper-case name. */
export type ParamScope = ReadonlyMap<string, number>;

const CONSTANTS: Record<string, number> = { PI: Math.PI, E: Math.E };

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  SQRT: Math.sqrt,
  EXP: Math.exp,
  LOG: Math.log,
  LN: Math.log,
  LOG10: Math.log10,
  ABS: Math.abs,
  SIN: Math.sin,
  COS: Math.cos,
  TAN: Math.tan,
  ATAN: Math.atan,
  MIN: Math.min,
  MAX: Math.max,
  POW: Math.pow,
};

type Tok = { k: "num"; v: number } | { k: "id"; v: string } | { k: "op"; v: string };

const TOKEN =
  /\s*(?:((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:[a-zµμΩ][a-z0-9µμΩ]*)?)|([a-z_][a-z0-9_]*)|(\*\*|[-+*/^(),]))/iy;

function lex(src: string, fail: (m: string) => never): Tok[] {
  const out: Tok[] = [];
  TOKEN.lastIndex = 0;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
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

/**
 * Evaluates an expression with the given parameters.
 *
 * @param fail called with a message on any error (it must throw).
 */
export function evaluate(src: string, scope: ParamScope, fail: (message: string) => never): number {
  const toks = lex(src, (m) => fail(`in "${src}": ${m}`));
  let i = 0;
  const err = (m: string): never => fail(`in "${src}": ${m}`);
  const peek = () => toks[i];
  const isOp = (v: string) => {
    const t = toks[i];
    return t?.k === "op" && t.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) err(`expected "${v}"`);
    i++;
  };

  const sum = (): number => {
    let v = product();
    while (isOp("+") || isOp("-")) {
      const op = (toks[i++] as Tok).v;
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const product = (): number => {
    let v = unary();
    while (isOp("*") || isOp("/")) {
      const op = (toks[i++] as Tok).v;
      const r = unary();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const unary = (): number => {
    if (isOp("-")) {
      i++;
      return -unary();
    }
    if (isOp("+")) {
      i++;
      return unary();
    }
    return power();
  };
  const power = (): number => {
    const base = atom();
    if (isOp("^")) {
      i++;
      return base ** unary();
    }
    return base;
  };
  const atom = (): number => {
    const t = peek();
    if (t === undefined) return err("unexpected end");
    i++;
    if (t.k === "num") return t.v;
    if (t.k === "op") {
      if (t.v !== "(") return err(`unexpected "${t.v}"`);
      const v = sum();
      expect(")");
      return v;
    }
    if (isOp("(")) {
      const f = FUNCTIONS[t.v];
      if (!f) return err(`unknown function "${t.v.toLowerCase()}"`);
      i++;
      const args = [sum()];
      while (isOp(",")) {
        i++;
        args.push(sum());
      }
      expect(")");
      return f(...args);
    }
    const v = scope.get(t.v) ?? CONSTANTS[t.v];
    if (v === undefined) return err(`unknown parameter "${t.v.toLowerCase()}"`);
    return v;
  };

  const v = sum();
  if (i < toks.length) err(`unexpected "${String((toks[i] as Tok).v)}"`);
  if (!Number.isFinite(v)) err("the result is not a finite number");
  return v;
}

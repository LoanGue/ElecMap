import { ElecMapError } from "../core/errors";
import { latexNumber } from "../format/latex";
import type { NodeName } from "../format/types";
import { Polynomial } from "../math/polynomial";
import { Rational } from "../math/rational";
import type { MnaSystem } from "../mna/system";
import { resolveInput, TransferFunction } from "../analysis/transfer";
import type { OutputSpec } from "../analysis/transfer";
import { MPoly } from "./mpoly";
import type { MTerm } from "./mpoly";
import { SymbolicSystem } from "./system";
import type { CircuitSymbol, SymbolicOptions, SymForm } from "./system";

/** Options for {@link SymbolicTransferFunction.toLatex}. */
export interface SymbolicLatexOptions {
  /** Left-hand side, e.g. `"H(s)"`. */
  name?: string;
  /** Order of the powers of `s` (default `"ascending"`). */
  order?: "ascending" | "descending";
  /** Significant digits of numeric coefficients (default 4). */
  digits?: number;
  /** Laplace variable (default `s`). */
  variable?: string;
}

/**
 * A transfer function (or impedance) whose coefficients are polynomials in
 * the component symbols: `H(s) = N(s) / D(s)` with `N = Σ nₖ(R, L, C…)·s^k`.
 *
 * Common monomial and integer factors are removed; non-monomial common factors
 * are not searched for, so the expression may be of higher order than the
 * numeric transfer function when pole/zero pairs cancel for every value.
 *
 * Get one with {@link ElecMap.symbolicTransferFunction} or {@link ElecMap.symbolicImpedance}.
 * The examples of this page use a Sallen-Key low-pass filter:
 *
 * ```ts
 * import { ElecMap } from "elecmap";
 *
 * const filter = new ElecMap(`
 * V1 in 0 AC 1
 * R1 in a 10k
 * R2 a b 10k
 * C1 a out 22n
 * C2 b 0 10n
 * X1 b out out OPAMP
 * `);
 * const H = filter.symbolicTransferFunction("out");
 * ```
 */
export class SymbolicTransferFunction {
  /**
   * Literal symbols, in display order.
   *
   * @example
   * ```ts
   * H.symbols.map((x) => x.latex); // ["R_{1}", "R_{2}", "C_{1}", "C_{2}"]
   * H.symbols[2]; // { id: "C1", latex: "C_{1}", name: "C1", kind: "capacitance", value: 2.2e-8 }
   * ```
   */
  readonly symbols: readonly CircuitSymbol[];

  constructor(
    /** Numerator (variable 0 is `s`, then one variable per symbol). */
    readonly num: MPoly,
    /** Denominator. */
    readonly den: MPoly,
    symbols: readonly CircuitSymbol[],
    /** Input source id and output label. */
    readonly meta: { input?: string; output?: string } = {},
  ) {
    this.symbols = symbols;
  }

  /**
   * Coefficients `[n₀, n₁, …]` of the numerator, as polynomials in the symbols.
   *
   * @example
   * ```ts
   * H.numeratorCoefficients.length; // 1   (constant numerator)
   * ```
   */
  get numeratorCoefficients(): MPoly[] {
    return this.num.coefficientsIn(0);
  }

  /**
   * Coefficients `[d₀, d₁, …]` of the denominator.
   *
   * @example
   * ```ts
   * H.denominatorCoefficients.length; // 3   (1, C2·(R1 + R2), R1·R2·C1·C2)
   * ```
   */
  get denominatorCoefficients(): MPoly[] {
    return this.den.coefficientsIn(0);
  }

  /**
   * Order of the expression (degree of `D` in `s`).
   *
   * @example
   * ```ts
   * H.order; // 2
   * ```
   */
  get order(): number {
    return this.den.degreeIn(0);
  }

  /**
   * Numeric transfer function obtained by giving the symbols values: their
   * circuit values by default, overridden by `values` (keyed by component id).
   *
   * @example
   * ```ts
   * H.substitute().naturalFrequency(); // 1073.0   (netlist values)
   * H.substitute({ C1: 20e-9 }).qFactor(); // 0.7071   (C1 changed, others from the netlist)
   * ```
   */
  substitute(values: Readonly<Record<string, number>> = {}): TransferFunction {
    const vals = [0, ...this.symbols.map((sym) => values[sym.id] ?? sym.value)];
    for (const id of Object.keys(values)) {
      if (!this.symbols.some((sym) => sym.id === id)) {
        throw new ElecMapError("NOT_FOUND", `"${id}" is not a symbol of this expression`, {
          componentId: id,
        });
      }
    }
    const poly = (p: MPoly) => new Polynomial(p.coefficientsIn(0).map((c) => c.evaluate(vals)));
    const den = poly(this.den);
    if (den.isZero()) {
      throw new ElecMapError("DIVISION_BY_ZERO", "The denominator vanishes for these values");
    }
    return new TransferFunction(new Rational(poly(this.num), den), this.meta);
  }

  /**
   * LaTeX, e.g. `\frac{1}{1 + R_{1} C_{1} s}`.
   *
   * @example
   * ```ts
   * H.toLatex({ name: "H(s)" });
   * // "H(s) = \frac{1}{1 + C_{2} \left(R_{1} + R_{2}\right) s + R_{1} R_{2} C_{1} C_{2} s^{2}}"
   * H.toLatex({ order: "descending" }); // highest power of s first
   * ```
   */
  toLatex(options: SymbolicLatexOptions = {}): string {
    const fmt = (p: MPoly) => this.polyLatex(p, options);
    const isOne = this.den.size === 1 && this.den.minExponents().every((e) => e === 0);
    const denTerm = this.den.terms[0] as MTerm;
    let body: string;
    if (this.num.isZero()) body = "0";
    else if (isOne && denTerm.c === 1) body = fmt(this.num);
    else if (this.num.terms.every((t) => t.c < 0)) {
      body = `-\\frac{${fmt(this.num.neg())}}{${fmt(this.den)}}`;
    } else body = `\\frac{${fmt(this.num)}}{${fmt(this.den)}}`;
    return options.name ? `${options.name} = ${body}` : body;
  }

  /**
   * Plain text, e.g. `1 / (1 + R1*C1*s)`.
   *
   * @example
   * ```ts
   * H.toString(); // "V(out)/V1 = (1) / (1 + s*R1*C2 + s*R2*C2 + s^2*R1*R2*C1*C2)"
   * ```
   */
  toString(): string {
    const text = (p: MPoly) => this.polyText(p);
    const label =
      this.meta.output && this.meta.input
        ? `${this.meta.output}/${this.meta.input} = `
        : this.meta.output
          ? `${this.meta.output} = `
          : "";
    return `${label}(${text(this.num)}) / (${text(this.den)})`;
  }

  // ---------------------------------------------------------------- formatting

  /** Polynomial grouped by powers of `s`: `R_{1} + \left(R_{1} R_{2} C_{1}\right) s`. */
  private polyLatex(p: MPoly, options: SymbolicLatexOptions): string {
    const variable = options.variable ?? "s";
    const groups = p
      .coefficientsIn(0)
      .map((c, k) => ({ c, k }))
      .filter((g) => !g.c.isZero());
    if (options.order === "descending") groups.reverse();
    let out = "";
    groups.forEach(({ c, k }, i) => {
      const power = k === 0 ? "" : k === 1 ? variable : `${variable}^{${k}}`;
      const { negative, body } = this.groupLatex(c, power, options.digits ?? 4);
      out += i === 0 ? (negative ? "-" : "") + body : (negative ? " - " : " + ") + body;
    });
    return out || "0";
  }

  /** One coefficient group `c(symbols)·s^k`, with its sign pulled out. */
  private groupLatex(c: MPoly, power: string, digits: number): { negative: boolean; body: string } {
    const terms = this.sortTerms(c.terms);
    const negative = terms.every((t) => t.c < 0);
    const sgn = negative ? -1 : 1;
    if (terms.length === 1) {
      const t = terms[0] as MTerm;
      return { negative, body: this.monomialLatex(t.exps, sgn * t.c, digits, power) };
    }
    // Factor out the common monomial: g·(a + b)·s^k
    const common = c.minExponents();
    const reduced = terms.map((t) => ({
      exps: t.exps.map((e, i) => e - (common[i] as number)),
      c: sgn * t.c,
    }));
    reduced.sort((x, y) => Number(x.c < 0) - Number(y.c < 0));
    let inner = "";
    reduced.forEach((t, i) => {
      const m = this.monomialLatex(t.exps, Math.abs(t.c), digits, "");
      inner += i === 0 ? (t.c < 0 ? "-" : "") + m : (t.c < 0 ? " - " : " + ") + m;
    });
    const factor = this.monomialLatex(common, 1, digits, "");
    if (factor === "1" && !power) return { negative, body: inner };
    const parts = [factor === "1" ? "" : factor, `\\left(${inner}\\right)`, power].filter(Boolean);
    return { negative, body: parts.join(" ") };
  }

  private monomialLatex(
    exps: readonly number[],
    coeff: number,
    digits: number,
    power: string,
  ): string {
    const parts: string[] = [];
    exps.forEach((e, i) => {
      if (i === 0 || e === 0) return;
      const sym = (this.symbols[i - 1] as CircuitSymbol).latex;
      parts.push(e === 1 ? sym : `${sym}^{${e}}`);
    });
    if (power) parts.push(power);
    const n = latexNumber(coeff, { digits });
    if (parts.length === 0) return n;
    if (n === "1") return parts.join(" ");
    return `${n.includes("\\times") ? `\\left(${n}\\right)` : n} ${parts.join(" ")}`;
  }

  private polyText(p: MPoly): string {
    const terms = this.sortTerms(p.terms).sort(
      (a, b) => (a.exps[0] as number) - (b.exps[0] as number),
    );
    if (terms.length === 0) return "0";
    return terms
      .map((t, i) => {
        const parts: string[] = [];
        t.exps.forEach((e, k) => {
          if (e === 0) return;
          const name = k === 0 ? "s" : (this.symbols[k - 1] as CircuitSymbol).name;
          parts.push(e === 1 ? name : `${name}^${e}`);
        });
        const abs = Math.abs(t.c);
        const coeff = abs === 1 && parts.length > 0 ? "" : String(Number(abs.toPrecision(6)));
        const body = [coeff, ...parts].filter(Boolean).join("*");
        return i === 0 ? (t.c < 0 ? "-" : "") + body : (t.c < 0 ? " - " : " + ") + body;
      })
      .join("");
  }

  /** Deterministic order: by total degree, then lexicographic on the symbols. */
  private sortTerms(terms: MTerm[]): MTerm[] {
    const total = (t: MTerm) => t.exps.reduce((a, e, i) => (i === 0 ? a : a + e), 0);
    return [...terms].sort((a, b) => {
      const d = total(a) - total(b);
      if (d !== 0) return d;
      for (let i = 1; i < a.exps.length; i++) {
        const x = (b.exps[i] as number) - (a.exps[i] as number);
        if (x !== 0) return x;
      }
      return 0;
    });
  }
}

// ------------------------------------------------------------------ computation

/** Options for {@link symbolicTransferFunction}. */
export interface SymbolicTransferOptions extends SymbolicOptions {
  input?: string;
  output: OutputSpec;
}

function outputSymForm(
  sym: SymbolicSystem,
  output: OutputSpec,
  input: string,
): { form: SymForm; label: string } {
  if (typeof output === "string") return { form: sym.voltageForm(output), label: `V(${output})` };
  if (Array.isArray(output)) {
    const [a, b] = output as readonly [NodeName, NodeName];
    return { form: sym.voltageForm(a, b), label: `V(${a},${b})` };
  }
  const { current } = output as { current: string };
  return { form: sym.currentForm(current, input), label: `I(${current})` };
}

/** Removes common monomial / integer factors and fixes the sign of `D`. */
function simplify(num: MPoly, den: MPoly): [MPoly, MPoly] {
  if (num.isZero()) return [num, MPoly.constant(den.nvars, 1)];
  const a = num.minExponents();
  const b = den.minExponents();
  const common = a.map((e, i) => Math.min(e, b[i] as number));
  const strip = (p: MPoly) =>
    p.mapExponents((exps) => exps.map((e, i) => e - (common[i] as number)));
  let [n, d] = [strip(num), strip(den)];
  const coeffs = [...n.terms, ...d.terms].map((t) => t.c);
  if (coeffs.every((c) => Number.isInteger(c))) {
    const g = coeffs.reduce((acc, c) => gcd(acc, Math.abs(c)), 0);
    if (g > 1) [n, d] = [n.scale(1 / g), d.scale(1 / g)];
  }
  // A purely numeric constant term of D is scaled to 1.
  const d0 = d.coefficientsIn(0)[0];
  if (d0 && d0.size === 1 && d0.minExponents().every((e) => e === 0)) {
    const k = (d0.terms[0] as MTerm).c;
    [n, d] = [n.scale(1 / k), d.scale(1 / k)];
  }
  // Sign: lowest power of s in D, first term positive.
  const low = d.coefficientsIn(0).find((c) => !c.isZero());
  const lead = low?.terms.reduce((x, y) => (Math.abs(y.c) > Math.abs(x.c) ? y : x));
  if (lead && lead.c < 0 && low?.terms.every((t) => t.c < 0)) [n, d] = [n.neg(), d.neg()];
  else if (lead && lead.c < 0 && d.terms.every((t) => t.c < 0)) [n, d] = [n.neg(), d.neg()];
  return [n, d];
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Common back end: `y / u` where `A·x = b·u` and `y = form(x)`. */
function symbolicRatio(
  sym: SymbolicSystem,
  b: readonly number[],
  form: SymForm,
  meta: { input?: string; output?: string },
): SymbolicTransferFunction {
  const det = sym.determinant();
  if (det.isZero()) {
    throw new ElecMapError(
      "SINGULAR_MATRIX",
      "The circuit equations are singular for every value (check for floating parts or ideal loops)",
    );
  }
  const raw = sym.numerator(b, form, det);
  const [n, d] = simplify(...sym.clearConductances(raw, det));
  return new SymbolicTransferFunction(n, d, sym.symbols, meta);
}

/** Literal transfer function `output / input`. */
export function symbolicTransferFunction(
  system: MnaSystem,
  options: SymbolicTransferOptions,
): SymbolicTransferFunction {
  const input = resolveInput(system, options.input);
  const sym = new SymbolicSystem(system, options);
  const { form, label } = outputSymForm(sym, options.output, input);
  const b = system.rhs((c) => (c.id === input ? 1 : 0)).map((v) => v.re);
  return symbolicRatio(sym, b, form, { input, output: label });
}

/** Literal impedance between two nodes (sources turned off). */
export function symbolicImpedance(
  system: MnaSystem,
  a: NodeName,
  b: NodeName = system.circuit.ground,
  options: SymbolicOptions = {},
): SymbolicTransferFunction {
  const ia = system.node(a);
  const ib = system.node(b);
  if (ia === ib) {
    throw new ElecMapError(
      "INVALID_ARGUMENT",
      `Impedance between a node and itself ("${a}", "${b}")`,
    );
  }
  const sym = new SymbolicSystem(system, options);
  const rhs = new Array<number>(system.size).fill(0);
  if (ia >= 0) rhs[ia] = 1;
  if (ib >= 0) rhs[ib] = -1;
  return symbolicRatio(sym, rhs, sym.voltageForm(a, b), { output: `Z(${a},${b})` });
}

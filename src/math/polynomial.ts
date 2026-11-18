import { ElecMapError } from "../core/errors";
import { Complex } from "./complex";
import { displayNumber } from "./display";

/**
 * Relative threshold under which the result of an addition is considered to be
 * pure floating-point cancellation noise and flushed to zero.
 */
const CANCELLATION_EPS = 1e-13;

/** Adds two numbers, flushing catastrophic-cancellation residue to exactly 0. */
function cleanSum(a: number, b: number): number {
  const r = a + b;
  return Math.abs(r) <= CANCELLATION_EPS * (Math.abs(a) + Math.abs(b)) ? 0 : r;
}

/**
 * Immutable univariate polynomial with real coefficients, stored in ascending
 * powers: `coeffs[k]` is the coefficient of `x^k`.
 *
 * In ElecMap the variable is usually the Laplace variable `s`.
 */
export class Polynomial {
  /** Coefficients in ascending powers, without trailing (high-order) zeros. */
  readonly coeffs: readonly number[];

  constructor(coeffs: readonly number[]) {
    let end = coeffs.length;
    while (end > 0 && coeffs[end - 1] === 0) end--;
    this.coeffs = coeffs.slice(0, end);
  }

  /** The zero polynomial. */
  static zero(): Polynomial {
    return new Polynomial([]);
  }

  /** The constant polynomial `c`. */
  static constant(c: number): Polynomial {
    return new Polynomial([c]);
  }

  /** The monomial `c·x^power`. */
  static monomial(power: number, c = 1): Polynomial {
    if (!Number.isInteger(power) || power < 0) {
      throw new ElecMapError("INVALID_ARGUMENT", `Invalid monomial power: ${power}`);
    }
    const coeffs = new Array<number>(power + 1).fill(0);
    coeffs[power] = c;
    return new Polynomial(coeffs);
  }

  /**
   * Builds the monic polynomial `∏ (x − rᵢ)`. Complex roots must come in
   * conjugate pairs; the residual imaginary part of the product is discarded.
   */
  static fromRoots(roots: readonly (number | Complex)[]): Polynomial {
    let acc: Complex[] = [Complex.ONE];
    for (const root of roots) {
      const r = Complex.from(root);
      const next: Complex[] = new Array<Complex>(acc.length + 1).fill(Complex.ZERO);
      for (let k = 0; k < acc.length; k++) {
        const a = acc[k] as Complex;
        next[k + 1] = (next[k + 1] as Complex).add(a);
        next[k] = (next[k] as Complex).sub(a.mul(r));
      }
      acc = next;
    }
    return new Polynomial(acc.map((c) => c.re));
  }

  /** Degree of the polynomial; `-1` for the zero polynomial. */
  get degree(): number {
    return this.coeffs.length - 1;
  }

  /** Coefficient of `x^k` (0 when out of range). */
  coeff(k: number): number {
    return this.coeffs[k] ?? 0;
  }

  /** Leading (highest-order) coefficient, 0 for the zero polynomial. */
  leading(): number {
    return this.coeffs[this.coeffs.length - 1] ?? 0;
  }

  isZero(): boolean {
    return this.coeffs.length === 0;
  }

  /** True if the polynomial is a constant (including zero). */
  isConstant(): boolean {
    return this.coeffs.length <= 1;
  }

  /** Largest absolute coefficient (infinity norm). */
  norm(): number {
    let m = 0;
    for (const c of this.coeffs) m = Math.max(m, Math.abs(c));
    return m;
  }

  add(other: Polynomial | number): Polynomial {
    const o = typeof other === "number" ? Polynomial.constant(other) : other;
    const n = Math.max(this.coeffs.length, o.coeffs.length);
    const out = new Array<number>(n);
    for (let k = 0; k < n; k++) out[k] = cleanSum(this.coeff(k), o.coeff(k));
    return new Polynomial(out);
  }

  sub(other: Polynomial | number): Polynomial {
    const o = typeof other === "number" ? Polynomial.constant(other) : other;
    return this.add(o.neg());
  }

  neg(): Polynomial {
    return new Polynomial(this.coeffs.map((c) => -c));
  }

  /** Multiplication by a scalar. */
  scale(factor: number): Polynomial {
    return new Polynomial(this.coeffs.map((c) => c * factor));
  }

  mul(other: Polynomial | number): Polynomial {
    if (typeof other === "number") return this.scale(other);
    if (this.isZero() || other.isZero()) return Polynomial.zero();
    const out = new Array<number>(this.coeffs.length + other.coeffs.length - 1).fill(0);
    for (let i = 0; i < this.coeffs.length; i++) {
      const a = this.coeffs[i] as number;
      if (a === 0) continue;
      for (let j = 0; j < other.coeffs.length; j++) {
        out[i + j] = (out[i + j] as number) + a * (other.coeffs[j] as number);
      }
    }
    return new Polynomial(out);
  }

  /** Polynomial long division: `this = q·divisor + r` with `deg r < deg divisor`. */
  divmod(divisor: Polynomial): { quotient: Polynomial; remainder: Polynomial } {
    if (divisor.isZero()) {
      throw new ElecMapError("DIVISION_BY_ZERO", "Division by the zero polynomial");
    }
    const dd = divisor.degree;
    const lead = divisor.leading();
    const rem = [...this.coeffs];
    if (rem.length - 1 < dd) return { quotient: Polynomial.zero(), remainder: this };
    const q = new Array<number>(rem.length - dd).fill(0);
    for (let k = rem.length - 1 - dd; k >= 0; k--) {
      const factor = (rem[k + dd] as number) / lead;
      q[k] = factor;
      if (factor === 0) continue;
      for (let j = 0; j <= dd; j++) {
        rem[k + j] = cleanSum(rem[k + j] as number, -factor * (divisor.coeffs[j] as number));
      }
      rem[k + dd] = 0;
    }
    return { quotient: new Polynomial(q), remainder: new Polynomial(rem.slice(0, dd)) };
  }

  /** Quotient of a division known to be exact (the remainder is discarded). */
  divExact(divisor: Polynomial): Polynomial {
    return this.divmod(divisor).quotient;
  }

  /** Formal derivative. */
  derivative(): Polynomial {
    return new Polynomial(this.coeffs.slice(1).map((c, k) => c * (k + 1)));
  }

  /** Evaluates the polynomial at a real point (Horner scheme). */
  evaluate(x: number): number {
    let acc = 0;
    for (let k = this.coeffs.length - 1; k >= 0; k--) acc = acc * x + (this.coeffs[k] as number);
    return acc;
  }

  /** Evaluates the polynomial at a complex point (Horner scheme). */
  evaluateComplex(z: Complex): Complex {
    let re = 0;
    let im = 0;
    for (let k = this.coeffs.length - 1; k >= 0; k--) {
      const nr = re * z.re - im * z.im + (this.coeffs[k] as number);
      im = re * z.im + im * z.re;
      re = nr;
    }
    return new Complex(re, im);
  }

  /** Substitutes `x → factor·x` (frequency scaling). */
  scaleVariable(factor: number): Polynomial {
    let p = 1;
    return new Polynomial(
      this.coeffs.map((c) => {
        const v = c * p;
        p *= factor;
        return v;
      }),
    );
  }

  /** Flushes coefficients whose magnitude is below `tolerance · norm()` to zero. */
  trim(tolerance = 1e-12): Polynomial {
    const limit = tolerance * this.norm();
    return new Polynomial(this.coeffs.map((c) => (Math.abs(c) <= limit ? 0 : c)));
  }

  /** Approximate equality, relative to the largest coefficient of both operands. */
  equals(other: Polynomial, tolerance = 1e-12): boolean {
    const scale = Math.max(this.norm(), other.norm(), Number.MIN_VALUE);
    const n = Math.max(this.coeffs.length, other.coeffs.length);
    for (let k = 0; k < n; k++) {
      if (Math.abs(this.coeff(k) - other.coeff(k)) > tolerance * scale) return false;
    }
    return true;
  }

  /** Human-readable representation, e.g. `1 + 0.001·s + 1e-8·s^2`. */
  toString(variable = "s"): string {
    if (this.isZero()) return "0";
    const terms: string[] = [];
    this.coeffs.forEach((c, k) => {
      if (c === 0) return;
      const v = k === 0 ? "" : k === 1 ? variable : `${variable}^${k}`;
      const n = displayNumber(c);
      terms.push(k === 0 ? n : n === "1" ? v : n === "-1" ? `-${v}` : `${n}·${v}`);
    });
    return terms.join(" + ").replace(/\+ -/g, "- ");
  }
}

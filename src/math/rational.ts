import { ElecMapError } from "../core/errors";
import { Complex } from "./complex";
import { Polynomial } from "./polynomial";

/**
 * Immutable rational function `N(x) / D(x)` with real polynomial coefficients.
 * Transfer functions and impedances are represented as rational functions of `s`.
 */
export class Rational {
  constructor(
    /** Numerator polynomial. */
    readonly num: Polynomial,
    /** Denominator polynomial (never zero). */
    readonly den: Polynomial = Polynomial.constant(1),
  ) {
    if (den.isZero()) {
      throw new ElecMapError("DIVISION_BY_ZERO", "Rational function with a zero denominator");
    }
  }

  /** Constant rational function. */
  static constant(c: number): Rational {
    return new Rational(Polynomial.constant(c));
  }

  /** The rational function `x` (i.e. `s` in the Laplace domain). */
  static variable(): Rational {
    return new Rational(Polynomial.monomial(1));
  }

  isZero(): boolean {
    return this.num.isZero();
  }

  add(other: Rational | number): Rational {
    const o = typeof other === "number" ? Rational.constant(other) : other;
    return new Rational(this.num.mul(o.den).add(o.num.mul(this.den)), this.den.mul(o.den));
  }

  sub(other: Rational | number): Rational {
    const o = typeof other === "number" ? Rational.constant(other) : other;
    return this.add(o.neg());
  }

  neg(): Rational {
    return new Rational(this.num.neg(), this.den);
  }

  mul(other: Rational | number): Rational {
    if (typeof other === "number") return new Rational(this.num.scale(other), this.den);
    return new Rational(this.num.mul(other.num), this.den.mul(other.den));
  }

  div(other: Rational | number): Rational {
    if (typeof other === "number") return new Rational(this.num, this.den.scale(other));
    if (other.num.isZero()) {
      throw new ElecMapError("DIVISION_BY_ZERO", "Division by a zero rational function");
    }
    return new Rational(this.num.mul(other.den), this.den.mul(other.num));
  }

  /** Multiplicative inverse `D / N`. */
  inv(): Rational {
    return Rational.constant(1).div(this);
  }

  /** Evaluates at a complex point, e.g. `s = jω`. */
  evaluate(z: Complex | number): Complex {
    const p = Complex.from(z);
    return this.num.evaluateComplex(p).div(this.den.evaluateComplex(p));
  }

  /**
   * Returns an equivalent rational function whose denominator is normalised:
   * - `"constant"`: the lowest-order non-zero denominator coefficient becomes 1
   *   (engineering form `… / (1 + a·s + b·s²)`),
   * - `"monic"`: the leading denominator coefficient becomes 1.
   */
  normalize(mode: "constant" | "monic" = "constant"): Rational {
    const d = this.den.coeffs;
    const pivot = mode === "monic" ? this.den.leading() : (d.find((c) => c !== 0) as number);
    return new Rational(this.num.scale(1 / pivot), this.den.scale(1 / pivot));
  }

  toString(variable = "s"): string {
    return `(${this.num.toString(variable)}) / (${this.den.toString(variable)})`;
  }
}

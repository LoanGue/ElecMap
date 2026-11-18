import { displayNumber } from "./display";
/**
 * Immutable complex number `re + j·im`.
 *
 * Electrical engineering convention: the imaginary unit is written `j`.
 */
export class Complex {
  /** 0 + 0j */
  static readonly ZERO = new Complex(0, 0);
  /** 1 + 0j */
  static readonly ONE = new Complex(1, 0);
  /** 0 + 1j */
  static readonly J = new Complex(0, 1);

  constructor(
    /** Real part. */
    readonly re: number,
    /** Imaginary part. */
    readonly im: number = 0,
  ) {}

  /** Builds a complex number from its magnitude and phase (radians). */
  static fromPolar(magnitude: number, phase: number): Complex {
    return new Complex(magnitude * Math.cos(phase), magnitude * Math.sin(phase));
  }

  /** Converts a number or complex into a {@link Complex}. */
  static from(value: number | Complex): Complex {
    return typeof value === "number" ? new Complex(value, 0) : value;
  }

  add(other: number | Complex): Complex {
    const o = Complex.from(other);
    return new Complex(this.re + o.re, this.im + o.im);
  }

  sub(other: number | Complex): Complex {
    const o = Complex.from(other);
    return new Complex(this.re - o.re, this.im - o.im);
  }

  mul(other: number | Complex): Complex {
    if (typeof other === "number") return new Complex(this.re * other, this.im * other);
    return new Complex(
      this.re * other.re - this.im * other.im,
      this.re * other.im + this.im * other.re,
    );
  }

  /** Division using Smith's algorithm (avoids overflow / underflow). */
  div(other: number | Complex): Complex {
    if (typeof other === "number") return new Complex(this.re / other, this.im / other);
    const { re: c, im: d } = other;
    if (Math.abs(c) >= Math.abs(d)) {
      if (c === 0 && d === 0) return new Complex(NaN, NaN);
      const r = d / c;
      const den = c + d * r;
      return new Complex((this.re + this.im * r) / den, (this.im - this.re * r) / den);
    }
    const r = c / d;
    const den = c * r + d;
    return new Complex((this.re * r + this.im) / den, (this.im * r - this.re) / den);
  }

  neg(): Complex {
    return new Complex(-this.re, -this.im);
  }

  conj(): Complex {
    return new Complex(this.re, -this.im);
  }

  /** Multiplicative inverse `1 / z`. */
  inv(): Complex {
    return Complex.ONE.div(this);
  }

  /** Magnitude `|z|`. */
  abs(): number {
    return Math.hypot(this.re, this.im);
  }

  /** Phase in radians, in `(-π, π]`. */
  arg(): number {
    return Math.atan2(this.im, this.re);
  }

  /** Principal square root. */
  sqrt(): Complex {
    const r = this.abs();
    if (r === 0) return Complex.ZERO;
    const re = Math.sqrt((r + this.re) / 2);
    const im = Math.sqrt((r - this.re) / 2);
    return new Complex(re, this.im < 0 ? -im : im);
  }

  isZero(): boolean {
    return this.re === 0 && this.im === 0;
  }

  /** True if both parts are finite numbers. */
  isFinite(): boolean {
    return Number.isFinite(this.re) && Number.isFinite(this.im);
  }

  /** Approximate equality with an absolute tolerance. */
  equals(other: number | Complex, tolerance = 1e-12): boolean {
    const o = Complex.from(other);
    return Math.abs(this.re - o.re) <= tolerance && Math.abs(this.im - o.im) <= tolerance;
  }

  toString(): string {
    if (this.im === 0) return displayNumber(this.re);
    const sign = this.im < 0 ? "-" : "+";
    return `${displayNumber(this.re)} ${sign} ${displayNumber(Math.abs(this.im))}j`;
  }
}

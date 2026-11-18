import { Polynomial } from "./polynomial";

/**
 * Minimal commutative-ring interface used by fraction-free algorithms
 * (Bareiss determinant). Implementations exist for numeric polynomials and,
 * later, for multivariate symbolic polynomials.
 */
export interface Ring<T> {
  readonly zero: T;
  readonly one: T;
  add(a: T, b: T): T;
  sub(a: T, b: T): T;
  mul(a: T, b: T): T;
  /** Division known to be exact in the ring. */
  divExact(a: T, b: T): T;
  isZero(a: T): boolean;
  /** Optional magnitude used to choose the best pivot. */
  magnitude?(a: T): number;
}

/** Ring of real numbers. */
export const NumberRing: Ring<number> = {
  zero: 0,
  one: 1,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  divExact: (a, b) => a / b,
  isZero: (a) => a === 0,
  magnitude: (a) => Math.abs(a),
};

/** Ring of real univariate polynomials. */
export const PolynomialRing: Ring<Polynomial> = {
  zero: Polynomial.zero(),
  one: Polynomial.constant(1),
  add: (a, b) => a.add(b),
  sub: (a, b) => a.sub(b),
  mul: (a, b) => a.mul(b),
  divExact: (a, b) => a.divExact(b),
  isZero: (a) => a.isZero(),
  magnitude: (a) => a.norm(),
};

/**
 * Determinant computed with the fraction-free Bareiss algorithm. Works over any
 * {@link Ring}; with {@link PolynomialRing} it yields `det(A(s))` as an exact
 * polynomial, which is how transfer functions are obtained from the MNA matrix.
 */
export function bareissDeterminant<T>(ring: Ring<T>, matrix: readonly (readonly T[])[]): T {
  const n = matrix.length;
  if (n === 0) return ring.one;
  const m = matrix.map((row) => [...row]);
  let sign = 1;
  let prev = ring.one;

  for (let k = 0; k < n - 1; k++) {
    // Pivot selection: largest magnitude when available, else first non-zero.
    let p = -1;
    let best = -1;
    for (let i = k; i < n; i++) {
      const v = (m[i] as T[])[k] as T;
      if (ring.isZero(v)) continue;
      const mag = ring.magnitude ? ring.magnitude(v) : 1;
      if (mag > best) {
        best = mag;
        p = i;
        if (!ring.magnitude) break;
      }
    }
    if (p === -1) return ring.zero;
    if (p !== k) {
      [m[k], m[p]] = [m[p] as T[], m[k] as T[]];
      sign = -sign;
    }
    const rowK = m[k] as T[];
    const pivot = rowK[k] as T;
    for (let i = k + 1; i < n; i++) {
      const rowI = m[i] as T[];
      const factor = rowI[k] as T;
      for (let j = k + 1; j < n; j++) {
        const v = ring.sub(ring.mul(rowI[j] as T, pivot), ring.mul(factor, rowK[j] as T));
        rowI[j] = ring.divExact(v, prev);
      }
      rowI[k] = ring.zero;
    }
    prev = pivot;
  }
  const det = (m[n - 1] as T[])[n - 1] as T;
  return sign === 1 ? det : ring.sub(ring.zero, det);
}

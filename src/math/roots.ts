import { ElecMapError } from "../core/errors";
import { Complex } from "./complex";
import { Polynomial } from "./polynomial";

/** Options for {@link polynomialRoots}. */
export interface RootOptions {
  /** Maximum number of Aberth–Ehrlich iterations (default 500). */
  maxIterations?: number;
  /** Relative convergence tolerance on root corrections (default 1e-14). */
  tolerance?: number;
}

/** Sorts roots by increasing magnitude, then by imaginary part. */
function sortRoots(roots: Complex[]): Complex[] {
  return roots.sort((a, b) => a.abs() - b.abs() || a.im - b.im);
}

/** Flushes tiny imaginary parts to zero so that real roots are exactly real. */
function cleanRoot(z: Complex): Complex {
  return Math.abs(z.im) <= 1e-9 * Math.max(z.abs(), Number.MIN_VALUE) ? new Complex(z.re, 0) : z;
}

/** Numerically stable roots of `a·x² + b·x + c`. */
function quadraticRoots(a: number, b: number, c: number): Complex[] {
  const disc = b * b - 4 * a * c;
  if (disc >= 0) {
    const q = -0.5 * (b + Math.sign(b || 1) * Math.sqrt(disc));
    const r1 = q / a;
    const r2 = q === 0 ? 0 : c / q;
    return [new Complex(r1), new Complex(r2)];
  }
  const re = -b / (2 * a);
  const im = Math.sqrt(-disc) / (2 * Math.abs(a));
  return [new Complex(re, -im), new Complex(re, im)];
}

/**
 * Finds all complex roots of a real polynomial using closed forms up to
 * degree 2 and the Aberth–Ehrlich simultaneous iteration above, followed by a
 * Newton polishing step. Roots are returned sorted by increasing magnitude.
 *
 * Used to compute the poles and zeros of transfer functions.
 *
 * @throws {@link ElecMapError} `INVALID_ARGUMENT` for the zero polynomial,
 *   `NO_CONVERGENCE` if the iteration does not converge.
 */
export function polynomialRoots(p: Polynomial, options: RootOptions = {}): Complex[] {
  if (p.isZero()) {
    throw new ElecMapError("INVALID_ARGUMENT", "The zero polynomial has infinitely many roots");
  }
  const maxIterations = options.maxIterations ?? 500;
  const tolerance = options.tolerance ?? 1e-14;

  // Roots at the origin.
  const roots: Complex[] = [];
  let shift = 0;
  while (p.coeff(shift) === 0) {
    roots.push(Complex.ZERO);
    shift++;
  }
  const q = new Polynomial(p.coeffs.slice(shift));
  const n = q.degree;
  if (n === 0) return sortRoots(roots);
  if (n === 1) return sortRoots([...roots, new Complex(-q.coeff(0) / q.coeff(1))]);
  if (n === 2) {
    return sortRoots([...roots, ...quadraticRoots(q.coeff(2), q.coeff(1), q.coeff(0))]);
  }

  // Monic form and derivative.
  const monic = q.scale(1 / q.leading());
  const dmonic = monic.derivative();

  // Initial guesses on a circle of radius |c0|^(1/n), with an irrational angle offset.
  const radius = Math.pow(Math.abs(monic.coeff(0)), 1 / n) || 1;
  let z: Complex[] = Array.from({ length: n }, (_, k) =>
    Complex.fromPolar(radius, (2 * Math.PI * k) / n + 0.4),
  );

  let converged = false;
  for (let iter = 0; iter < maxIterations && !converged; iter++) {
    converged = true;
    const next: Complex[] = [];
    for (let i = 0; i < n; i++) {
      const zi = z[i] as Complex;
      const pv = monic.evaluateComplex(zi);
      if (pv.isZero()) {
        next.push(zi);
        continue;
      }
      const ratio = pv.div(dmonic.evaluateComplex(zi));
      let sum = Complex.ZERO;
      for (let j = 0; j < n; j++) {
        if (j !== i) sum = sum.add(Complex.ONE.div(zi.sub(z[j] as Complex)));
      }
      const w = ratio.div(Complex.ONE.sub(ratio.mul(sum)));
      const zn = w.isFinite() ? zi.sub(w) : zi;
      next.push(zn);
      if (w.isFinite() && w.abs() > tolerance * Math.max(zn.abs(), 1e-300)) converged = false;
    }
    z = next;
  }
  if (!converged) {
    throw new ElecMapError("NO_CONVERGENCE", "Root finding did not converge", { degree: n });
  }

  // Newton polishing on the original polynomial.
  const dq = q.derivative();
  z = z.map((zi) => {
    let r = zi;
    for (let k = 0; k < 3; k++) {
      const d = dq.evaluateComplex(r);
      if (d.isZero()) break;
      const step = q.evaluateComplex(r).div(d);
      if (!step.isFinite()) break;
      r = r.sub(step);
    }
    return r;
  });

  return sortRoots([...roots, ...z.map(cleanRoot)]);
}

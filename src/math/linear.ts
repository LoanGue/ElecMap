import { ElecMapError } from "../core/errors";
import { Complex } from "./complex";

/** Dense real matrix stored as an array of rows. */
export type RealMatrix = number[][];
/** Dense complex matrix stored as an array of rows. */
export type ComplexMatrix = Complex[][];

function checkSquare(rows: number, cols: (number | undefined)[]): void {
  for (const c of cols) {
    if (c !== rows) {
      throw new ElecMapError("DIMENSION_MISMATCH", `Matrix must be square (${rows} rows)`);
    }
  }
}

/**
 * LU factorisation `P·A = L·U` of a dense real matrix with partial pivoting.
 * Factor once, then call {@link RealLU.solve} for as many right-hand sides as
 * needed (e.g. at every time step of a transient analysis).
 */
export class RealLU {
  private readonly lu: Float64Array[];
  private readonly perm: Int32Array;
  /** Size of the system. */
  readonly n: number;

  /**
   * @param matrix square matrix (not modified)
   * @param tolerance pivots whose magnitude is below `tolerance · max|A|` are treated as zero
   * @throws {@link ElecMapError} `SINGULAR_MATRIX`
   */
  constructor(matrix: RealMatrix, tolerance = 1e-13) {
    const n = matrix.length;
    checkSquare(
      n,
      matrix.map((r) => r.length),
    );
    this.n = n;
    this.lu = matrix.map((row) => Float64Array.from(row));
    this.perm = Int32Array.from({ length: n }, (_, i) => i);
    let scale = 0;
    for (const row of this.lu) for (const v of row) scale = Math.max(scale, Math.abs(v));
    const limit = tolerance * scale;

    for (let k = 0; k < n; k++) {
      let p = k;
      let best = Math.abs((this.lu[k] as Float64Array)[k] as number);
      for (let i = k + 1; i < n; i++) {
        const v = Math.abs((this.lu[i] as Float64Array)[k] as number);
        if (v > best) {
          best = v;
          p = i;
        }
      }
      if (best <= limit || best === 0) {
        throw new ElecMapError("SINGULAR_MATRIX", "Matrix is singular", { column: k, size: n });
      }
      if (p !== k) {
        [this.lu[k], this.lu[p]] = [this.lu[p] as Float64Array, this.lu[k] as Float64Array];
        [this.perm[k], this.perm[p]] = [this.perm[p] as number, this.perm[k] as number];
      }
      const rowK = this.lu[k] as Float64Array;
      const pivot = rowK[k] as number;
      for (let i = k + 1; i < n; i++) {
        const rowI = this.lu[i] as Float64Array;
        const f = (rowI[k] as number) / pivot;
        rowI[k] = f;
        if (f === 0) continue;
        for (let j = k + 1; j < n; j++) rowI[j] = (rowI[j] as number) - f * (rowK[j] as number);
      }
    }
  }

  /** Solves `A·x = b`. */
  solve(b: readonly number[]): number[] {
    const n = this.n;
    if (b.length !== n) {
      throw new ElecMapError("DIMENSION_MISMATCH", `Right-hand side must have ${n} entries`);
    }
    const x = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const row = this.lu[i] as Float64Array;
      let s = b[this.perm[i] as number] as number;
      for (let j = 0; j < i; j++) s -= (row[j] as number) * (x[j] as number);
      x[i] = s;
    }
    for (let i = n - 1; i >= 0; i--) {
      const row = this.lu[i] as Float64Array;
      let s = x[i] as number;
      for (let j = i + 1; j < n; j++) s -= (row[j] as number) * (x[j] as number);
      x[i] = s / (row[i] as number);
    }
    return x;
  }
}

/** LU factorisation of a dense complex matrix with partial pivoting. See {@link RealLU}. */
export class ComplexLU {
  private readonly lu: Complex[][];
  private readonly perm: number[];
  private sign = 1;
  /** Size of the system. */
  readonly n: number;

  /** @throws {@link ElecMapError} `SINGULAR_MATRIX` */
  constructor(matrix: ComplexMatrix, tolerance = 1e-13) {
    const n = matrix.length;
    checkSquare(
      n,
      matrix.map((r) => r.length),
    );
    this.n = n;
    this.lu = matrix.map((row) => [...row]);
    this.perm = Array.from({ length: n }, (_, i) => i);
    let scale = 0;
    for (const row of this.lu) for (const v of row) scale = Math.max(scale, v.abs());
    const limit = tolerance * scale;

    for (let k = 0; k < n; k++) {
      let p = k;
      let best = (this.lu[k] as Complex[])[k]?.abs() ?? 0;
      for (let i = k + 1; i < n; i++) {
        const v = (this.lu[i] as Complex[])[k]?.abs() ?? 0;
        if (v > best) {
          best = v;
          p = i;
        }
      }
      if (best <= limit || best === 0) {
        throw new ElecMapError("SINGULAR_MATRIX", "Matrix is singular", { column: k, size: n });
      }
      if (p !== k) {
        [this.lu[k], this.lu[p]] = [this.lu[p] as Complex[], this.lu[k] as Complex[]];
        [this.perm[k], this.perm[p]] = [this.perm[p] as number, this.perm[k] as number];
        this.sign = -this.sign;
      }
      const rowK = this.lu[k] as Complex[];
      const pivot = rowK[k] as Complex;
      for (let i = k + 1; i < n; i++) {
        const rowI = this.lu[i] as Complex[];
        const f = (rowI[k] as Complex).div(pivot);
        rowI[k] = f;
        if (f.isZero()) continue;
        for (let j = k + 1; j < n; j++)
          rowI[j] = (rowI[j] as Complex).sub(f.mul(rowK[j] as Complex));
      }
    }
  }

  /** Determinant of the factorised matrix. */
  determinant(): Complex {
    let det = new Complex(this.sign);
    for (let i = 0; i < this.n; i++) det = det.mul((this.lu[i] as Complex[])[i] as Complex);
    return det;
  }

  /** Solves `A·x = b`. */
  solve(b: readonly (Complex | number)[]): Complex[] {
    const n = this.n;
    if (b.length !== n) {
      throw new ElecMapError("DIMENSION_MISMATCH", `Right-hand side must have ${n} entries`);
    }
    const x = new Array<Complex>(n);
    for (let i = 0; i < n; i++) {
      const row = this.lu[i] as Complex[];
      let s = Complex.from(b[this.perm[i] as number] as Complex | number);
      for (let j = 0; j < i; j++) s = s.sub((row[j] as Complex).mul(x[j] as Complex));
      x[i] = s;
    }
    for (let i = n - 1; i >= 0; i--) {
      const row = this.lu[i] as Complex[];
      let s = x[i] as Complex;
      for (let j = i + 1; j < n; j++) s = s.sub((row[j] as Complex).mul(x[j] as Complex));
      x[i] = s.div(row[i] as Complex);
    }
    return x;
  }
}

/** Solves the real system `A·x = b` (one-shot convenience around {@link RealLU}). */
export function solveReal(matrix: RealMatrix, b: readonly number[]): number[] {
  return new RealLU(matrix).solve(b);
}

/** Solves the complex system `A·x = b` (one-shot convenience around {@link ComplexLU}). */
export function solveComplex(matrix: ComplexMatrix, b: readonly (Complex | number)[]): Complex[] {
  return new ComplexLU(matrix).solve(b);
}

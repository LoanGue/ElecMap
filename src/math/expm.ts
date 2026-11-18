import { RealLU } from "./linear";

/** Dense real matrix, row-major. */
export type Matrix = number[][];

/** Identity matrix of size `n`. */
export function identity(n: number): Matrix {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
}

/** Matrix product `A·B`. */
export function matMul(
  a: readonly (readonly number[])[],
  b: readonly (readonly number[])[],
): Matrix {
  const n = a.length;
  const m = (b[0] ?? []).length;
  const k = b.length;
  const out: Matrix = Array.from({ length: n }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < n; i++) {
    const ai = a[i] as readonly number[];
    const oi = out[i] as number[];
    for (let p = 0; p < k; p++) {
      const v = ai[p] as number;
      if (v === 0) continue;
      const bp = b[p] as readonly number[];
      for (let j = 0; j < m; j++) oi[j] = (oi[j] as number) + v * (bp[j] as number);
    }
  }
  return out;
}

/** Matrix-vector product `A·x`. */
export function matVec(a: readonly (readonly number[])[], x: readonly number[]): number[] {
  return a.map((row) => row.reduce((acc, v, j) => acc + v * (x[j] as number), 0));
}

const add = (a: Matrix, b: Matrix, beta = 1): Matrix =>
  a.map((row, i) => row.map((v, j) => v + beta * ((b[i] as number[])[j] as number)));
const scale = (a: Matrix, f: number): Matrix => a.map((row) => row.map((v) => v * f));

/** Padé(13) coefficients (Higham 2005). */
const PADE13 = [
  64764752532480000, 32382376266240000, 7771770303897600, 1187353796428800, 129060195264000,
  10559470521600, 670442572800, 33522128640, 1323241920, 40840800, 960960, 16380, 182, 1,
];

/**
 * Matrix exponential `e^A` by scaling and squaring with a degree-13 Padé
 * approximant (Higham's method). Accurate to machine precision for well-scaled matrices.
 */
export function expm(a: readonly (readonly number[])[]): Matrix {
  const n = a.length;
  if (n === 0) return [];
  const norm1 = Math.max(
    ...Array.from({ length: n }, (_, j) =>
      a.reduce((acc, row) => acc + Math.abs(row[j] as number), 0),
    ),
  );
  const theta13 = 5.371920351148152;
  const s = norm1 > theta13 ? Math.max(0, Math.ceil(Math.log2(norm1 / theta13))) : 0;
  const A = scale(
    a.map((r) => [...r]),
    1 / 2 ** s,
  );
  const I = identity(n);
  const A2 = matMul(A, A);
  const A4 = matMul(A2, A2);
  const A6 = matMul(A4, A2);
  const b = PADE13;
  const at = (k: number) => b[k] as number;

  const u1 = add(add(scale(A6, at(13)), scale(A4, at(11))), scale(A2, at(9)));
  const u2 = add(add(add(scale(A6, at(7)), scale(A4, at(5))), scale(A2, at(3))), scale(I, at(1)));
  const U = matMul(A, add(matMul(A6, u1), u2));
  const v1 = add(add(scale(A6, at(12)), scale(A4, at(10))), scale(A2, at(8)));
  const v2 = add(add(add(scale(A6, at(6)), scale(A4, at(4))), scale(A2, at(2))), scale(I, at(0)));
  const V = add(matMul(A6, v1), v2);

  // Solve (V − U)·R = (V + U).
  const lu = new RealLU(add(V, U, -1), 0);
  const P = add(V, U);
  const cols = Array.from({ length: n }, (_, j) => lu.solve(P.map((row) => row[j] as number)));
  let R: Matrix = Array.from({ length: n }, (_, i) => cols.map((c) => c[i] as number));
  for (let k = 0; k < s; k++) R = matMul(R, R);
  return R;
}

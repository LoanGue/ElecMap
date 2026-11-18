import { describe, expect, it } from "vitest";
import { Complex } from "../../src/math/complex";
import { ComplexLU, RealLU, solveComplex, solveReal } from "../../src/math/linear";
import { ElecMapError } from "../../src/core/errors";

describe("linear solvers", () => {
  it("solves a real system that requires pivoting", () => {
    const x = solveReal(
      [
        [0, 2, 1],
        [1, 1, 1],
        [2, 1, 3],
      ],
      [7, 6, 13],
    );
    expect(x[0]).toBeCloseTo(1);
    expect(x[1]).toBeCloseTo(2);
    expect(x[2]).toBeCloseTo(3);
  });

  it("reuses a factorisation for several right-hand sides", () => {
    const lu = new RealLU([
      [4, 1],
      [2, 3],
    ]);
    expect(lu.solve([5, 5]).map((v) => +v.toFixed(12))).toEqual([1, 1]);
    expect(lu.solve([1, 0]).map((v) => +v.toFixed(12))).toEqual([0.3, -0.2]);
  });

  it("detects singular matrices", () => {
    let error: unknown;
    try {
      solveReal(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ElecMapError);
    expect((error as ElecMapError).code).toBe("SINGULAR_MATRIX");
  });

  it("rejects non-square matrices and wrong rhs sizes", () => {
    expect(() => new RealLU([[1, 2]])).toThrow(/square/);
    expect(() => new RealLU([[1]]).solve([1, 2])).toThrow(/entries/);
  });

  it("solves a complex system (RC divider at ω = 1/RC)", () => {
    // (1/R + jωC)·V = Vin/R with R = C = ω = 1  →  V = 1 / (1 + j)
    const v = solveComplex([[new Complex(1, 1)]], [1]);
    expect((v[0] as Complex).equals(new Complex(0.5, -0.5))).toBe(true);
  });

  it("solves a larger complex system", () => {
    const A = [
      [new Complex(2, 1), new Complex(0, -1)],
      [new Complex(1), new Complex(3, 2)],
    ];
    const expected = [new Complex(1, -1), new Complex(2, 0.5)];
    const b = A.map((row) =>
      row.reduce((acc, a, j) => acc.add(a.mul(expected[j] as Complex)), Complex.ZERO),
    );
    const x = new ComplexLU(A).solve(b);
    x.forEach((xi, i) => expect(xi.equals(expected[i] as Complex, 1e-12)).toBe(true));
  });

  it("detects singular complex matrices", () => {
    expect(() => new ComplexLU([[Complex.ZERO]])).toThrow(/singular/);
  });
});

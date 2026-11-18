import { describe, expect, it } from "vitest";
import { Complex } from "../../src/math/complex";
import { Polynomial } from "../../src/math/polynomial";
import { polynomialRoots } from "../../src/math/roots";

const close = (a: Complex, b: Complex, tol: number) => a.sub(b).abs() <= tol * Math.max(1, b.abs());

function expectRoots(p: Polynomial, expected: Complex[], tol = 1e-9) {
  const roots = polynomialRoots(p);
  expect(roots).toHaveLength(expected.length);
  for (const e of expected) {
    expect(roots.some((r) => close(r, e, tol))).toBe(true);
  }
}

describe("polynomialRoots", () => {
  it("handles constants and linear polynomials", () => {
    expect(polynomialRoots(new Polynomial([3]))).toEqual([]);
    expectRoots(new Polynomial([2, 1]), [new Complex(-2)]);
  });

  it("solves quadratics with real and complex roots", () => {
    expectRoots(new Polynomial([6, -5, 1]), [new Complex(2), new Complex(3)]);
    expectRoots(new Polynomial([5, 2, 1]), [new Complex(-1, 2), new Complex(-1, -2)]);
  });

  it("extracts roots at the origin", () => {
    expectRoots(new Polynomial([0, 0, 1, 1]), [Complex.ZERO, Complex.ZERO, new Complex(-1)]);
  });

  it("finds roots of higher-degree polynomials", () => {
    const expected = [
      new Complex(-1),
      new Complex(-2),
      new Complex(-0.5, 3),
      new Complex(-0.5, -3),
      new Complex(4),
    ];
    expectRoots(Polynomial.fromRoots(expected), expected);
  });

  it("handles badly scaled circuit polynomials (3rd-order Butterworth, ωc = 1e4)", () => {
    const wc = 1e4;
    const p = new Polynomial([1, 2 / wc, 2 / wc ** 2, 1 / wc ** 3]);
    expectRoots(p, [
      new Complex(-wc),
      Complex.fromPolar(wc, (2 * Math.PI) / 3),
      Complex.fromPolar(wc, (-2 * Math.PI) / 3),
    ]);
  });

  it("returns exactly real roots for real factors", () => {
    polynomialRoots(Polynomial.fromRoots([-1, -10, -100])).forEach((r) => expect(r.im).toBe(0));
  });

  it("sorts roots by magnitude", () => {
    const roots = polynomialRoots(Polynomial.fromRoots([-100, -1, -10]));
    expect(roots.map((r) => Math.round(r.re))).toEqual([-1, -10, -100]);
  });

  it("rejects the zero polynomial", () => {
    expect(() => polynomialRoots(Polynomial.zero())).toThrow();
  });
});

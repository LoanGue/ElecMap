import { describe, expect, it } from "vitest";
import { Complex } from "../../src/math/complex";
import { Polynomial } from "../../src/math/polynomial";
import { Rational } from "../../src/math/rational";

describe("Rational", () => {
  const s = Rational.variable();
  // RC low-pass: 1 / (1 + RC·s) with RC = 1e-3
  const H = Rational.constant(1).div(s.mul(1e-3).add(1));

  it("evaluates a first-order low-pass at its cutoff", () => {
    const v = H.evaluate(new Complex(0, 1 / 1e-3));
    expect(v.abs()).toBeCloseTo(Math.SQRT1_2, 12);
    expect(v.arg()).toBeCloseTo(-Math.PI / 4, 12);
  });

  it("supports arithmetic", () => {
    expect(H.add(H).evaluate(0).equals(2)).toBe(true);
    expect(H.mul(H.inv()).evaluate(new Complex(0, 3)).equals(1, 1e-12)).toBe(true);
    expect(H.sub(H).isZero()).toBe(true);
  });

  it("normalises the denominator", () => {
    const r = new Rational(Polynomial.constant(2), new Polynomial([4, 2]));
    expect(r.normalize("constant").den.coeffs).toEqual([1, 0.5]);
    expect(r.normalize("monic").den.coeffs).toEqual([2, 1]);
  });

  it("rejects zero denominators", () => {
    expect(() => new Rational(Polynomial.constant(1), Polynomial.zero())).toThrow();
    expect(() => H.div(Rational.constant(0))).toThrow();
  });
});

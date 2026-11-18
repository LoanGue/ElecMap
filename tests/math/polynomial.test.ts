import { describe, expect, it } from "vitest";
import { Complex } from "../../src/math/complex";
import { Polynomial } from "../../src/math/polynomial";

const P = (...c: number[]) => new Polynomial(c);

describe("Polynomial", () => {
  it("normalises trailing zeros and reports degree", () => {
    expect(P(1, 2, 0, 0).degree).toBe(1);
    expect(P(0, 0).isZero()).toBe(true);
    expect(Polynomial.zero().degree).toBe(-1);
  });

  it("adds, subtracts and multiplies", () => {
    const a = P(1, 1);
    const b = P(-1, 1);
    expect(a.mul(b).equals(P(-1, 0, 1))).toBe(true);
    expect(a.add(b).equals(P(0, 2))).toBe(true);
    expect(a.sub(a).isZero()).toBe(true);
  });

  it("flushes cancellation noise to exactly zero", () => {
    expect(
      P(0.1 + 0.2, 1)
        .sub(P(0.3, 1))
        .isZero(),
    ).toBe(true);
  });

  it("keeps legitimately tiny coefficients (e.g. LC = 1e-12)", () => {
    const p = P(1, 1e-4, 1e-12);
    expect(p.add(P(0, 0, 0)).coeff(2)).toBe(1e-12);
    expect(p.mul(P(1)).degree).toBe(2);
  });

  it("performs long division", () => {
    const { quotient, remainder } = P(-1, 0, 1).divmod(P(1, 1));
    expect(quotient.equals(P(-1, 1))).toBe(true);
    expect(remainder.isZero()).toBe(true);
    const r = P(1, 0, 1).divmod(P(1, 1));
    expect(r.quotient.equals(P(-1, 1))).toBe(true);
    expect(r.remainder.equals(P(2))).toBe(true);
  });

  it("throws on division by zero", () => {
    expect(() => P(1).divmod(Polynomial.zero())).toThrowError(/zero polynomial/);
  });

  it("evaluates at real and complex points", () => {
    const p = P(1, 2, 3);
    expect(p.evaluate(2)).toBe(17);
    expect(p.evaluateComplex(Complex.J).equals(new Complex(-2, 2))).toBe(true);
  });

  it("differentiates and scales its variable", () => {
    expect(P(1, 2, 3).derivative().equals(P(2, 6))).toBe(true);
    expect(
      P(1, 1, 1)
        .scaleVariable(2)
        .equals(P(1, 2, 4)),
    ).toBe(true);
  });

  it("builds from roots", () => {
    const p = Polynomial.fromRoots([new Complex(-1, 2), new Complex(-1, -2)]);
    expect(p.equals(P(5, 2, 1))).toBe(true);
  });

  it("builds monomials", () => {
    expect(Polynomial.monomial(2, 3).equals(P(0, 0, 3))).toBe(true);
    expect(() => Polynomial.monomial(-1)).toThrow();
  });

  it("formats", () => {
    expect(P(1, -2, 3).toString()).toBe("1 - 2·s + 3·s^2");
    expect(Polynomial.zero().toString()).toBe("0");
  });
});

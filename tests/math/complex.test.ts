import { describe, expect, it } from "vitest";
import { Complex } from "../../src/math/complex";

describe("Complex", () => {
  it("does basic arithmetic", () => {
    const a = new Complex(1, 2);
    const b = new Complex(3, -1);
    expect(a.add(b).equals(new Complex(4, 1))).toBe(true);
    expect(a.sub(b).equals(new Complex(-2, 3))).toBe(true);
    expect(a.mul(b).equals(new Complex(5, 5))).toBe(true);
    expect(a.div(b).mul(b).equals(a)).toBe(true);
    expect(a.mul(2).equals(new Complex(2, 4))).toBe(true);
  });

  it("handles j² = -1", () => {
    expect(Complex.J.mul(Complex.J).equals(-1)).toBe(true);
  });

  it("computes magnitude, phase and polar form", () => {
    const z = new Complex(1, 1);
    expect(z.abs()).toBeCloseTo(Math.SQRT2);
    expect(z.arg()).toBeCloseTo(Math.PI / 4);
    expect(Complex.fromPolar(2, Math.PI / 2).equals(new Complex(0, 2), 1e-12)).toBe(true);
  });

  it("divides without overflow (Smith)", () => {
    const big = new Complex(1e300, 1e300);
    expect(big.div(big).equals(1, 1e-12)).toBe(true);
  });

  it("computes the principal square root", () => {
    expect(new Complex(-4).sqrt().equals(new Complex(0, 2))).toBe(true);
    const z = new Complex(3, -4);
    expect(z.sqrt().mul(z.sqrt()).equals(z, 1e-12)).toBe(true);
  });

  it("returns NaN when dividing by zero", () => {
    expect(Complex.ONE.div(Complex.ZERO).isFinite()).toBe(false);
  });

  it("formats with j notation", () => {
    expect(new Complex(1, -2).toString()).toBe("1 - 2j");
    expect(new Complex(3).toString()).toBe("3");
  });
});

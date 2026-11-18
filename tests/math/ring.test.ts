import { describe, expect, it } from "vitest";
import { Polynomial } from "../../src/math/polynomial";
import { bareissDeterminant, NumberRing, PolynomialRing } from "../../src/math/ring";

const P = (...c: number[]) => new Polynomial(c);

describe("bareissDeterminant", () => {
  it("computes numeric determinants (with pivoting)", () => {
    expect(bareissDeterminant(NumberRing, [])).toBe(1);
    expect(
      bareissDeterminant(NumberRing, [
        [0, 1],
        [1, 0],
      ]),
    ).toBe(-1);
    expect(
      bareissDeterminant(NumberRing, [
        [2, -3, 1],
        [2, 0, -1],
        [1, 4, 5],
      ]),
    ).toBeCloseTo(49);
    expect(
      bareissDeterminant(NumberRing, [
        [1, 2],
        [2, 4],
      ]),
    ).toBe(0);
  });

  it("computes polynomial determinants exactly", () => {
    // det [[1+s, 1], [1, 1+s]] = s² + 2s
    const det = bareissDeterminant(PolynomialRing, [
      [P(1, 1), P(1)],
      [P(1), P(1, 1)],
    ]);
    expect(det.equals(P(0, 2, 1))).toBe(true);
  });

  it("handles a 3x3 polynomial matrix (RC ladder nodal matrix)", () => {
    const det = bareissDeterminant(PolynomialRing, [
      [P(2, 1), P(-1), P()],
      [P(-1), P(1, 1), P()],
      [P(), P(), P(1)],
    ]);
    // (2+s)(1+s) − 1 = s² + 3s + 1
    expect(det.equals(P(1, 3, 1))).toBe(true);
  });

  it("handles realistic component magnitudes (R = 1k, C = 100n)", () => {
    const G = 1e-3;
    const C = 1e-7;
    const det = bareissDeterminant(PolynomialRing, [
      [P(2 * G, C), P(-G)],
      [P(-G), P(G, C)],
    ]);
    // (2G + Cs)(G + Cs) − G² = G² + 3GC·s + C²·s²
    expect(det.equals(P(G * G, 3 * G * C, C * C), 1e-12)).toBe(true);
  });
});

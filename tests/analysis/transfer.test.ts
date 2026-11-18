import { describe, expect, it } from "vitest";
import type { Complex } from "../../src";
import {
  ElecMap,
  ElecMapError,
  TransferFunction,
  latexNumber,
  Polynomial,
  polynomialToLatex,
} from "../../src";

const close = (a: number, b: number, rel = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b)));

describe("transfer functions from circuits", () => {
  it("RC low-pass: H = 1 / (1 + RCs)", () => {
    const c = new ElecMap("V1 in 0 AC 1\nR1 in out 1k\nC1 out 0 100n");
    const H = c.transferFunction("out");
    expect(H.order).toBe(1);
    expect(H.numerator.coeffs).toHaveLength(1);
    close(H.numerator.coeff(0), 1);
    close(H.denominator.coeff(1), 1e-4);
    expect(H.filterType()).toBe("lowpass");
    close(H.cutoffFrequency() as number, 1 / (2 * Math.PI * 1e-4), 1e-9);
    close(H.dcGain(), 1);
    expect(H.highFrequencyGain()).toBe(0);
    const [p] = H.poles();
    close((p as Complex).re, -1e4);
    expect(H.timeConstants()[0]).toBeCloseTo(1e-4, 15);
    expect(H.isStable()).toBe(true);
    expect(H.toLatex()).toBe("\\frac{1}{1 + 10^{-4}\\,s}");
    expect(H.toLatex({ name: "H(s)", normalize: "monic" })).toBe(
      "H(s) = \\frac{10^{4}}{s + 10^{4}}",
    );
    expect(H.meta).toEqual({ input: "V1", output: "V(out)" });
  });

  it("matches the AC analysis at every frequency", () => {
    const c = new ElecMap(`
      V1 in 0 AC 1
      R1 in a 1k
      C1 a 0 10n
      R2 a b 22k
      C2 b 0 4.7n
      L1 b out 10m
      R3 out 0 1k
    `);
    const H = c.transferFunction("out");
    expect(H.order).toBe(3);
    for (const f of [1, 100, 1e3, 1e4, 1e5, 1e6]) {
      const ref = c.voltage("out", { freq: f });
      expect(H.evaluate(f).equals(ref, 1e-9 * Math.max(ref.abs(), 1e-12))).toBe(true);
    }
  });

  it("series RLC band-pass: f0, Q and bandwidth", () => {
    const R = 100;
    const L = 10e-3;
    const C = 1e-6;
    const c = new ElecMap(`V1 in 0 AC 1\nL1 in a ${L}\nC1 a b ${C}\nR1 b 0 ${R}`);
    const H = c.transferFunction("b");
    const f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));
    const q = Math.sqrt(L / C) / R;
    expect(H.filterType()).toBe("bandpass");
    close(H.naturalFrequency() as number, f0, 1e-9);
    close(H.qFactor() as number, q, 1e-9);
    close(H.dampingRatio() as number, 1 / (2 * q), 1e-9);
    close(H.peakFrequency(), f0, 1e-6);
    close(H.peakGain(), 1, 1e-9);
    close(H.bandwidth() as number, f0 / q, 1e-6);
    expect(H.zeros()).toHaveLength(1);
    expect((H.zeros()[0] as Complex).abs()).toBeLessThan(1e-9);
  });

  it("classifies high-pass and band-stop responses", () => {
    const hp = new ElecMap("V1 in 0 AC 1\nC1 in out 1u\nR1 out 0 1k").transferFunction("out");
    expect(hp.filterType()).toBe("highpass");
    close(hp.cutoffFrequency() as number, 1 / (2 * Math.PI * 1e-3), 1e-9);
    close(hp.highFrequencyGain(), 1);

    // Notch: R in series, then L + C in series to ground.
    const notch = new ElecMap(
      "V1 in 0 AC 1\nR1 in out 1k\nL1 out m 10m\nC1 m 0 1u",
    ).transferFunction("out");
    expect(notch.filterType()).toBe("bandstop");
    expect(notch.cutoffFrequencies()).toHaveLength(2);
  });

  it("handles op-amp circuits (ideal integrator → pole at 0)", () => {
    const c = new ElecMap(`
      V1 in 0 AC 1
      R1 in m 1k
      C1 m out 1u
      X1 0 m out OPAMP
    `);
    const H = c.transferFunction("out");
    expect(H.order).toBe(1);
    expect(H.dcGain()).toBe(-Infinity);
    expect(H.evaluate(1000 / (2 * Math.PI)).abs()).toBeCloseTo(1, 9);
    expect(H.filterType()).toBe("other");
  });

  it("supports Sallen-Key (2nd-order with feedback)", () => {
    const R = 10e3;
    const C = 10e-9;
    const c = new ElecMap(`
      V1 in 0 AC 1
      R1 in a ${R}
      R2 a b ${R}
      C1 a out ${2 * C}
      C2 b 0 ${C / 2}
      X1 b out out OPAMP
    `);
    const H = c.transferFunction("out");
    expect(H.order).toBe(2);
    close(H.naturalFrequency() as number, 1 / (2 * Math.PI * R * C), 1e-9);
    close(H.qFactor() as number, 1, 1e-9);
    close(H.dcGain(), 1, 1e-12);
  });

  it("cancels unobservable modes", () => {
    // The RC branch in parallel with the ideal source does not affect V(out).
    const c = new ElecMap("V1 in 0 AC 1\nR1 in out 1k\nR2 out 0 1k\nR3 in x 1k\nC1 x 0 1u");
    const H = c.transferFunction("out");
    expect(H.order).toBe(0);
    expect(H.filterType()).toBe("flat");
    close(H.dcGain(), 0.5);
    expect(H.toLatex()).toBe("0.5");
  });

  it("uses currents, node pairs and current-source inputs", () => {
    const c = new ElecMap("I1 0 a AC 1\nR1 a b 1k\nC1 b 0 1u\nV2 x 0 0\nR2 x 0 1");
    expect(c.transferFunction("a").meta.input).toBe("I1"); // the only AC source
    const Z = c.transferFunction({ input: "I1", output: "a" }); // input impedance R + 1/(sC)
    close(Z.evaluate(1000).re, 1000, 1e-9);
    close(Z.evaluate(1000).im, -1 / (2 * Math.PI * 1000 * 1e-6), 1e-9);
    const Hi = c.transferFunction({ input: "I1", output: { current: "C1" } });
    close(Hi.evaluate(123).abs(), 1, 1e-9);
    const Hab = c.transferFunction({ input: "I1", output: ["a", "b"] });
    close(Hab.evaluate(50).re, 1000, 1e-9);
    expect(() => c.transferFunction({ input: "R1", output: "a" })).toThrow(ElecMapError);
    const two = new ElecMap(["V1 a 0 1", "V2 b 0 1", "R1 a b 1k"].join("\n"));
    expect(() => two.transferFunction({ current: "R1" })).toThrow(ElecMapError);
  });

  it("returns 0 for an output that is not driven", () => {
    const c = new ElecMap("V1 in 0 AC 1\nR1 in 0 1k\nV2 x 0 1\nR2 x y 1k\nR3 y 0 1k");
    const H = c.transferFunction({ input: "V1", output: "y" });
    expect(H.numerator.isZero()).toBe(true);
    expect(H.dcGain()).toBe(0);
  });

  it("is accurate with values spanning many decades", () => {
    const c = new ElecMap(`
      V1 in 0 AC 1
      R1 in a 1
      C1 a 0 1m
      R2 a b 1meg
      C2 b 0 1p
    `);
    const H = c.transferFunction("b");
    const poles = H.poles()
      .map((p) => -p.re)
      .sort((x, y) => x - y);
    expect(poles).toHaveLength(2);
    for (const f of [0.01, 10, 1e4, 1e7]) {
      const ref = c.voltage("b", { freq: f });
      expect(H.evaluate(f).sub(ref).abs()).toBeLessThan(1e-8 * ref.abs() + 1e-15);
    }
  });
});

describe("TransferFunction", () => {
  const H = TransferFunction.fromCoefficients([1], [1, 1e-3]); // fc = 159.15 Hz

  it("applies sinusoidal inputs", () => {
    const fc = 1000 / (2 * Math.PI);
    const out = H.apply({ amplitude: 2, freq: fc, phase: 10 });
    expect(out.components[0]?.amplitude).toBeCloseTo(Math.SQRT2, 12);
    expect(out.components[0]?.phase).toBeCloseTo(-35, 9);
    const multi = H.apply({ offset: 1, components: [{ amplitude: 1, freq: fc }] });
    expect(multi.offset).toBe(1);
    expect(multi.at(0)).toBeCloseTo(1 + Math.SQRT1_2 * Math.sin(-Math.PI / 4), 12);
    expect(H.apply(3).offset).toBe(3);
    expect(
      H.apply([
        { amplitude: 1, freq: 1 },
        { amplitude: 1, freq: 1e6 },
      ]).components,
    ).toHaveLength(2);
    expect(multi.sample([0, 1e-3])).toHaveLength(2);
  });

  it("produces an unwrapped Bode diagram", () => {
    const H3 = TransferFunction.fromCoefficients([1], [1, 3, 3, 1]); // (1 + s)^3
    const bode = H3.bode({ fStart: 1e-3, fStop: 1e3, points: 20 });
    expect(bode.freq).toHaveLength(121);
    expect(bode.phase[bode.phase.length - 1]).toBeCloseTo(-270, 0);
    expect(bode.magnitudeDb[0]).toBeCloseTo(0, 2);
    for (let i = 1; i < bode.phase.length; i++) {
      expect(Math.abs((bode.phase[i] as number) - (bode.phase[i - 1] as number))).toBeLessThan(90);
    }
  });

  it("reports magnitude and phase", () => {
    const fc = 1000 / (2 * Math.PI);
    expect(H.magnitudeDb(fc)).toBeCloseTo(-3.0103, 4);
    expect(H.phase(fc)).toBeCloseTo(-45, 9);
    expect(H.relativeDegree).toBe(1);
    expect(H.toString()).toContain("0.001");
  });
});

describe("LaTeX formatting", () => {
  it("formats numbers", () => {
    expect(latexNumber(0)).toBe("0");
    expect(latexNumber(1.5)).toBe("1.5");
    expect(latexNumber(-1000)).toBe("-1000");
    expect(latexNumber(1e-4)).toBe("10^{-4}");
    expect(latexNumber(4.7e-9)).toBe("4.7 \\times 10^{-9}");
    expect(latexNumber(123456)).toBe("1.235 \\times 10^{5}");
    expect(latexNumber(Infinity)).toBe("\\infty");
  });

  it("formats polynomials", () => {
    const p = new Polynomial([1, -2e-3, 4.7e-9]);
    expect(polynomialToLatex(p)).toBe("1 - 0.002\\,s + \\left(4.7 \\times 10^{-9}\\right) s^{2}");
    expect(polynomialToLatex(p, { order: "descending", variable: "p" })).toBe(
      "\\left(4.7 \\times 10^{-9}\\right) p^{2} - 0.002\\,p + 1",
    );
    expect(polynomialToLatex(new Polynomial([0, -1]))).toBe("-s");
    expect(polynomialToLatex(Polynomial.zero())).toBe("0");
  });
});

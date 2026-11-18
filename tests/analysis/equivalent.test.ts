import { describe, expect, it } from "vitest";
import { Complex, ElecMap, ElecMapError } from "../../src";

const close = (a: number, b: number, rel = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b)));

describe("equivalent impedances", () => {
  it("combines resistors in series and parallel", () => {
    const c = new ElecMap(`
      R1 a b 1k
      R2 b 0 2k
      R3 b 0 2k
      R4 a c 330
      R5 c 0 470
    `);
    // (1k + 2k‖2k) ‖ (330 + 470) = 2k ‖ 800
    close(c.equivalentResistance("a"), (2000 * 800) / 2800);
    close(c.equivalentResistance("b", "a"), 1 / (1 / 1000 + 1 / (1000 + 800)));
  });

  it("turns sources off (V shorted, I opened)", () => {
    const c = new ElecMap(`
      V1 in 0 10
      R1 in out 1k
      R2 out 0 1k
      I1 out 0 1m
    `);
    close(c.equivalentResistance("out"), 500);
  });

  it("combines capacitors and inductors", () => {
    const caps = new ElecMap("C1 a b 1u\nC2 b 0 2u\nC3 a 0 500n\nR9 a 0 1meg");
    expect(() => caps.equivalentCapacitance("a")).toThrow(ElecMapError);
    const pure = new ElecMap("C1 a b 1u\nC2 b 0 2u\nC3 a 0 500n");
    close(pure.equivalentCapacitance("a"), 1e-6 * (2 / 3) + 0.5e-6, 1e-9);

    const coils = new ElecMap("L1 a b 1m\nL2 b 0 2m\nL3 b 0 2m");
    close(coils.equivalentInductance("a"), 2e-3, 1e-9);
    try {
      coils.equivalentResistance("a");
      expect.unreachable();
    } catch (e) {
      expect((e as ElecMapError).code).toBe("NOT_HOMOGENEOUS");
    }
    close(coils.equivalentResistance("a", undefined, { mode: "dc" }), 0);
  });

  it("gives the coupled-inductor equivalent", () => {
    // Series-aiding coupled inductors: L1 + L2 + 2M.
    const c = new ElecMap("L1 a m 1m\nL2 m 0 4m\nK1 L1 L2 0.5");
    close(c.equivalentInductance("a"), 1e-3 + 4e-3 + 2 * 0.5 * 2e-3, 1e-9);
  });

  it("returns frequency-dependent values", () => {
    const c = new ElecMap("R1 a b 100\nC1 b 0 1u");
    const f = 1e3;
    const z = c.equivalentImpedance("a", undefined, f);
    close(z.re, 100);
    close(z.im, -1 / (2 * Math.PI * f * 1e-6));
    close(c.equivalentCapacitance("a", undefined, { mode: "freq", freq: f }), 1e-6, 1e-9);
    close(c.equivalentResistance("a", undefined, { mode: "freq", freq: f }), 100);
    expect(c.equivalentResistance("a", undefined, { mode: "dc" })).toBe(Infinity);
    expect(c.impedance("a").toLatex()).toBe("\\frac{10^{6} + 100\\,s}{s}");
    expect(() => c.equivalentResistance("a", undefined, { mode: "freq" })).toThrow(ElecMapError);
    expect(() => c.impedance("a", "a")).toThrow(ElecMapError);
  });

  it("computes input and output impedances", () => {
    const c = new ElecMap(`
      V1 in 0 AC 1
      R1 in a 1k
      R2 a 0 1k
      R3 a out 500
      R4 out 0 1k
    `);
    close(c.inputImpedance().dcGain(), 1000 + 1 / (1 / 1000 + 1 / 1500));
    close(c.outputImpedance("out").dcGain(), 1 / (1 / 1000 + 1 / 1000));
    const ci = new ElecMap("I1 0 a 1\nR1 a 0 50");
    close(ci.inputImpedance("I1").dcGain(), 50);
    // An ideal voltage follower has zero output impedance.
    const follower = new ElecMap("V1 in 0 AC 1\nR1 in p 1k\nX1 p out out OPAMP\nRL out 0 1k");
    expect(Math.abs(follower.outputImpedance("out").dcGain())).toBeLessThan(1e-9);
  });
});

describe("Thévenin / Norton", () => {
  const c = new ElecMap(`
    V1 in 0 DC 12 AC 1
    R1 in out 4k
    R2 out 0 12k
  `);

  it("computes the DC equivalent", () => {
    const th = c.thevenin("out");
    close(th.voltage, 9);
    close(th.resistance, 3000);
    close(th.current, 3e-3);
    close(th.maxPower, (9 * 9) / 12000);
    expect(c.norton("out")).toEqual(th);
  });

  it("computes the AC equivalent", () => {
    const rc = new ElecMap("V1 in 0 AC 1\nR1 in out 1k\nC1 out 0 1u");
    const f = 159.155;
    const th = rc.thevenin("out", undefined, { freq: f });
    const zc = new Complex(0, -1 / (2 * Math.PI * f * 1e-6));
    const zth = zc.mul(1000).div(zc.add(1000));
    expect(th.impedance.equals(zth, 1e-9)).toBe(true);
    expect(th.voltage.equals(rc.voltage("out", { freq: f }), 1e-12)).toBe(true);
    expect(th.optimalLoad.equals(zth.conj(), 1e-12)).toBe(true);
  });
});

describe("AC power", () => {
  it("balances complex power and splits P / Q", () => {
    const c = new ElecMap("V1 in 0 AC 10\nR1 in a 100\nL1 a 0 10m\nC1 a 0 1u");
    const p = c.power({ freq: 1e3 });
    const total = Object.values(p).reduce((acc, s) => acc.add(s), Complex.ZERO);
    expect(total.abs()).toBeLessThan(1e-12);
    expect(p.R1?.im).toBeCloseTo(0, 12);
    expect(p.R1?.re).toBeGreaterThan(0);
    expect(p.L1?.re).toBeCloseTo(0, 12);
    expect(p.L1?.im).toBeGreaterThan(0); // inductors absorb reactive power
    expect(p.C1?.im).toBeLessThan(0);
    // P_R = ½·|I|²·R
    const i = c.current("R1", { freq: 1e3 }).abs();
    close(p.R1?.re as number, 0.5 * i * i * 100, 1e-12);
  });
});

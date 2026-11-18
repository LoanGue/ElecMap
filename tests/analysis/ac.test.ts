import { describe, expect, it } from "vitest";
import { Complex, ElecMap, ElecMapError, MnaSystem, compile, sweepFrequencies } from "../../src";

const db = (z: Complex) => 20 * Math.log10(z.abs());
const deg = (z: Complex) => (z.arg() * 180) / Math.PI;

describe("AC analysis", () => {
  const rc = new ElecMap(`
    V1 in 0 AC 1
    R1 in out 1k
    C1 out 0 100n
  `);
  const fc = 1 / (2 * Math.PI * 1e3 * 100e-9);

  it("gives −3 dB and −45° at the RC cutoff", () => {
    const v = rc.voltage("out", { freq: fc });
    expect(db(v)).toBeCloseTo(-3.0103, 3);
    expect(deg(v)).toBeCloseTo(-45, 9);
    expect(rc.voltage("out", { freq: 0 }).abs()).toBeCloseTo(1, 12);
  });

  it("computes branch currents as phasors", () => {
    const i = rc.current("C1", { freq: fc });
    const v = rc.voltage("out", { freq: fc });
    // I = jωC·V
    const expected = new Complex(0, 2 * Math.PI * fc * 100e-9).mul(v);
    expect(i.equals(expected, 1e-15)).toBe(true);
    expect(rc.current("R1", { freq: fc }).equals(i, 1e-15)).toBe(true);
  });

  it("finds the series RLC resonance", () => {
    const c = new ElecMap(`
      V1 in 0 AC 1
      R1 in a 10
      L1 a b 10m
      C1 b 0 1u
    `);
    const f0 = 1 / (2 * Math.PI * Math.sqrt(10e-3 * 1e-6));
    const i = c.current("R1", { freq: f0 });
    expect(i.abs()).toBeCloseTo(0.1, 10);
    expect(Math.abs(deg(i))).toBeLessThan(1e-6);
    const q = (1 / 10) * Math.sqrt(10e-3 / 1e-6);
    expect(c.voltage("b", { freq: f0 }).abs()).toBeCloseTo(q, 7);
  });

  it("drives a chosen input with a chosen amplitude", () => {
    const c = new ElecMap("V1 in 0 DC 5\nR1 in out 1k\nR2 out 0 1k");
    expect(() => c.ac(100)).toThrow(ElecMapError);
    const v = c.voltage("out", { freq: 100, input: "V1", amplitude: Complex.fromPolar(2, 0.5) });
    expect(v.abs()).toBeCloseTo(1, 12);
    expect(v.arg()).toBeCloseTo(0.5, 12);
    expect(() => c.ac(100, { input: "R1" })).toThrow(ElecMapError);
  });

  it("uses source phases in degrees", () => {
    const c = new ElecMap("V1 a 0 AC 2 90\nR1 a 0 1k");
    const v = c.voltage("a", { freq: 50 });
    expect(v.re).toBeCloseTo(0, 12);
    expect(v.im).toBeCloseTo(2, 12);
  });

  it("models an ideal transformer with k = 1", () => {
    const c = new ElecMap(`
      V1 in 0 AC 1
      Rs in p 1
      L1 p 0 1m
      L2 s 0 4m
      K1 L1 L2 1
      RL s 0 100
    `);
    const at = { freq: 10e3 };
    const ratio = c.voltage("s", at).div(c.voltage("p", at));
    expect(ratio.equals(new Complex(2), 1e-9)).toBe(true);
  });

  it("models a single-pole op-amp (GBW)", () => {
    const gbw = 1e6;
    const c = new ElecMap(`
      V1 in 0 AC 1
      X1 in out out OPAMP GAIN=1e5 GBW=${gbw}
    `);
    // Voltage follower: closed-loop bandwidth ≈ GBW.
    expect(db(c.voltage("out", { freq: 10 }))).toBeCloseTo(0, 3);
    expect(db(c.voltage("out", { freq: gbw }))).toBeCloseTo(-3.01, 1);
  });

  it("sweeps frequencies", () => {
    const sweep = rc.acSweep({ fStart: 10, fStop: 100e3, points: 10 });
    expect(sweep.freqs.length).toBe(41);
    expect(sweep.freqs[0]).toBeCloseTo(10, 12);
    expect(sweep.freqs[sweep.freqs.length - 1]).toBeCloseTo(100e3, 6);
    const gains = sweep.voltage("out").map((v) => v.abs());
    for (let i = 1; i < gains.length; i++) expect(gains[i]).toBeLessThan(gains[i - 1] as number);

    expect(sweepFrequencies({ fStart: 0, fStop: 10, points: 11, scale: "linear" })).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(() => sweepFrequencies({ fStart: 0, fStop: 10 })).toThrow(ElecMapError);
  });
});

describe("MnaSystem", () => {
  it("names its unknowns", () => {
    const sys = new MnaSystem(compile("V1 in 0 1\nR1 in out 1k\nL1 out 0 1m"));
    expect(sys.unknowns).toEqual(["V(in)", "V(out)", "I(V1)", "I(L1)"]);
    expect(sys.size).toBe(4);
    expect(sys.hasBranch("R1")).toBe(false);
    expect(() => sys.branch("R1")).toThrow(ElecMapError);
    const p = sys.polynomialMatrix();
    expect(p[3]?.[3]?.coeff(1)).toBeCloseTo(-1e-3, 15);
  });
});

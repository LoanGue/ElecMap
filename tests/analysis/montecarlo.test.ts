import { describe, expect, it } from "vitest";
import type { ElecMapError } from "../../src";
import { ElecMap, seededRandom } from "../../src";

const rc = () => new ElecMap("V1 in 0 DC 5 AC 1\nR1 in out 1k\nC1 out 0 100n");

describe("monteCarlo", () => {
  it("draws every toleranced value within its tolerance (uniform)", () => {
    const mc = rc().monteCarlo({ tolerances: { R1: 0.05, C1: 0.1 }, runs: 500 });
    expect(mc.length).toBe(500);
    const r = mc.samples.map((s) => s.values.R1 as number);
    const cap = mc.samples.map((s) => s.values.C1 as number);
    expect(Math.min(...r)).toBeGreaterThanOrEqual(950);
    expect(Math.max(...r)).toBeLessThanOrEqual(1050);
    expect(Math.min(...r)).toBeLessThan(955); // the whole interval is covered
    expect(Math.max(...r)).toBeGreaterThan(1045);
    expect(Math.min(...cap)).toBeGreaterThanOrEqual(90e-9);
    expect(Math.max(...cap)).toBeLessThanOrEqual(110e-9);
  });

  it("is reproducible with a seed and leaves the circuit unchanged", () => {
    const c = rc();
    const a = c.monteCarlo({ tolerances: { R1: 0.05 }, runs: 10, seed: 7 });
    const b = c.monteCarlo({ tolerances: { R1: 0.05 }, runs: 10, seed: 7 });
    const other = c.monteCarlo({ tolerances: { R1: 0.05 }, runs: 10, seed: 8 });
    expect(a.samples).toEqual(b.samples);
    expect(a.samples).not.toEqual(other.samples);
    expect(
      a
        .circuit(3)
        .components()
        .find((x) => x.id === "R1"),
    ).toMatchObject({
      value: a.samples[3]?.values.R1,
    });
    expect(c.components().find((x) => x.id === "R1")).toMatchObject({ value: 1000 });
    expect(a.nominal).toBe(c);
  });

  it("computes statistics of any quantity", () => {
    const mc = rc().monteCarlo({ tolerances: { R1: 0.05, C1: 0.1 }, runs: 200 });
    const fc = mc.statistics((x) => x.transferFunction("out").cutoffFrequency());
    expect(fc.nominal).toBeCloseTo(1591.549, 2);
    expect(fc.values).toHaveLength(200);
    // fc = 1/(2πRC): the extremes are reached at R, C both low or both high.
    expect(fc.min).toBeGreaterThan(1 / (2 * Math.PI * 1050 * 110e-9));
    expect(fc.max).toBeLessThan(1 / (2 * Math.PI * 950 * 90e-9));
    expect(fc.mean).toBeGreaterThan(fc.min);
    expect(fc.percentile(0)).toBe(fc.min);
    expect(fc.percentile(1)).toBe(fc.max);
    expect(fc.percentile(0.5)).toBeGreaterThan(fc.percentile(0.05));
  });

  it("gaussian: σ = tolerance / 3", () => {
    const mc = rc().monteCarlo({
      tolerances: { R1: 0.03 },
      runs: 4000,
      distribution: "gaussian",
    });
    const r = mc.statistics(
      (x) => (x.components().find((y) => y.id === "R1") as { value: number }).value,
    );
    expect(r.mean).toBeCloseTo(1000, -1);
    expect(r.std / 1000).toBeCloseTo(0.01, 3);
  });

  it("varies another field with id.field, and per-component distributions", () => {
    const bias = new ElecMap(`
VCC vcc 0 12
RB1 vcc b 47k
RB2 b 0 10k
RC vcc c 2.2k
RE e 0 470
Q1 c b e QN
.model QN NPN(BF=200 IS=1e-14)
`);
    const mc = bias.monteCarlo({
      tolerances: { "Q1.bf": 0.5, RE: { tolerance: 0.01, distribution: "gaussian" } },
      runs: 30,
    });
    const bf = mc.samples.map((s) => s.values["Q1.bf"] as number);
    expect(Math.min(...bf)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...bf)).toBeLessThanOrEqual(300);
    const ic = mc.statistics((x) => x.current("RC"));
    // A well-biased stage: β ±50 % moves Ic by a few percent only.
    expect((ic.max - ic.min) / ic.nominal).toBeLessThan(0.1);
  });

  it("builds a Bode envelope around the nominal curve", () => {
    const mc = rc().monteCarlo({ tolerances: { R1: 0.05, C1: 0.1 }, runs: 100 });
    const b = mc.bode("out", { fStart: 100, fStop: 100e3, points: 10 });
    expect(b.freq).toHaveLength(31);
    expect(b.runs).toHaveLength(100);
    b.freq.forEach((_, i) => {
      expect(b.magnitudeDb.min[i]).toBeLessThanOrEqual(b.nominal.magnitudeDb[i] as number);
      expect(b.magnitudeDb.max[i]).toBeGreaterThanOrEqual(b.nominal.magnitudeDb[i] as number);
      expect(b.phase.min[i]).toBeLessThanOrEqual(b.phase.max[i] as number);
    });
    // Far above fc, |H| ≈ 1/(ωRC): ±15 % on RC → about ±1.3 dB.
    const last = b.freq.length - 1;
    expect((b.magnitudeDb.max[last] as number) - (b.magnitudeDb.min[last] as number)).toBeLessThan(
      2.6,
    );
    expect(b.runs[0]?.freq).toEqual(b.freq);
  });

  it("rejects unknown components, fields and bad options", () => {
    const c = rc();
    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as ElecMapError).code;
      }
      return "none";
    };
    expect(code(() => c.monteCarlo({ tolerances: { R9: 0.1 } }))).toBe("NOT_FOUND");
    expect(code(() => c.monteCarlo({ tolerances: { "R1.foo": 0.1 } }))).toBe("INVALID_ARGUMENT");
    expect(code(() => c.monteCarlo({ tolerances: { R1: -0.1 } }))).toBe("INVALID_ARGUMENT");
    expect(code(() => c.monteCarlo({ tolerances: { R1: 0.1 }, runs: 0 }))).toBe("INVALID_ARGUMENT");
    expect(() => c.monteCarlo({ tolerances: { R1: 0.1 }, runs: 2 }).circuit(5)).toThrow(RangeError);
  });

  it("seededRandom is uniform in [0, 1)", () => {
    const r = seededRandom(42);
    const xs = Array.from({ length: 10000 }, r);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(xs.reduce((s, x) => s + x, 0) / xs.length).toBeCloseTo(0.5, 1);
  });
});

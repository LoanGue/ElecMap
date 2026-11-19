import { describe, expect, it } from "vitest";
import { ElecMap } from "../../src/ElecMap";
import type { ElecMapError } from "../../src/core/errors";

const divider = () => new ElecMap("V1 in 0 10\nR1 in out 1k\nR2 out 0 3k");
const rc = () => new ElecMap("V1 in 0 DC 5 AC 1\nR1 in out 1k\nC1 out 0 100n");

describe("sensitivity", () => {
  it("matches the analytic derivatives of a divider", () => {
    // V(out) = V·R2/(R1+R2): ∂/∂R1 = -V·R2/(R1+R2)², ∂/∂R2 = V·R1/(R1+R2)²
    const s1 = divider().sensitivity("out", "R1");
    expect(s1).toMatchObject({ id: "R1", field: "value", value: 1000 });
    expect(s1.output).toBeCloseTo(7.5, 12);
    expect(s1.derivative).toBeCloseTo((-10 * 3000) / 4000 ** 2, 12);
    expect(s1.normalized).toBeCloseTo(-0.25, 9);
    expect(divider().sensitivity("out", "R2").normalized).toBeCloseTo(0.25, 9);
    expect(divider().sensitivity("out", "V1")).toMatchObject({ field: "dc" });
    expect(divider().sensitivity("out", "V1").normalized).toBeCloseTo(1, 9);
  });

  it("supports voltage pairs, currents and custom fields", () => {
    const d = divider();
    expect(d.sensitivity(["in", "out"], "R1").normalized).toBeCloseTo(0.75, 9);
    // I = V/(R1+R2): ∂I/∂R2 = -V/(R1+R2)²
    expect(d.sensitivity({ current: "R2" }, "R2").derivative).toBeCloseTo(-10 / 4000 ** 2, 15);
    const e = new ElecMap("V1 in 0 1\nR1 in 0 1k\nE1 out 0 in 0 4\nR2 out 0 1k");
    expect(e.sensitivity("out", "E1", { field: "gain" }).derivative).toBeCloseTo(1, 9);
  });

  it("measures the amplitude at a frequency", () => {
    // |H| = 1/√(1+(ωRC)²): normalised sensitivity to C = -(ωRC)²/(1+(ωRC)²)
    const x = (2 * Math.PI * 1000 * 1e3 * 100e-9) ** 2;
    const s = rc().sensitivity("out", "C1", { at: { freq: 1000 } });
    expect(s.output).toBeCloseTo(1 / Math.sqrt(1 + x), 10);
    expect(s.normalized).toBeCloseTo(-x / (1 + x), 8);
    expect(rc().sensitivity("out", "C1").derivative).toBeCloseTo(0, 6); // DC: open
  });

  it("differentiates any function of the circuit", () => {
    const fc = (c: ElecMap) => c.transferFunction("out").cutoffFrequency() as number;
    expect(rc().sensitivity(fc, "R1").normalized).toBeCloseTo(-1, 6);
    expect(rc().sensitivity(fc, "C1").normalized).toBeCloseTo(-1, 6);
  });

  it("works on non-linear circuits", () => {
    // Diode forward voltage: V = n·Vt·ln(I/IS + 1) → ∂V/∂ln(IS) ≈ -n·Vt
    const c = new ElecMap("I1 0 a 1m\nD1 a 0 DMOD\n.model DMOD D(IS=1e-14)");
    const s = c.sensitivity("a", "D1");
    expect(s.field).toBe("is");
    expect(s.derivative * s.value).toBeCloseTo(-0.025852, 4);
    // Unset device parameters use their SPICE default.
    const d = new ElecMap("I1 0 a 1m\nD1 a 0");
    expect(d.sensitivity("a", "D1").value).toBe(1e-14);
  });

  it("does not modify the circuit", () => {
    const d = divider();
    d.sensitivity("out", "R1");
    expect(d.voltage("out")).toBe(7.5);
    expect(d.components()[1]).toMatchObject({ value: 1000 });
  });

  it("reports errors", () => {
    const err = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e as ElecMapError;
      }
      throw new Error("expected an error");
    };
    expect(err(() => divider().sensitivity("out", "R9")).code).toBe("NOT_FOUND");
    expect(err(() => divider().sensitivity("out", "R1", { field: "foo" })).code).toBe(
      "INVALID_ARGUMENT",
    );
    const amp = new ElecMap("V1 in 0 1\nX1 in out out OPAMP\nR1 out 0 1k");
    expect(err(() => amp.sensitivity("out", "X1")).message).toMatch(/no value for "gain"/);
  });
});

describe("sensitivities", () => {
  it("ranks every component by normalised sensitivity", () => {
    // Loaded divider: Rp = R2 ∥ R3 = 2k, S(R1) = -R1/(R1+Rp), S(R2) = -S(R1)·Rp/R2…
    const c = new ElecMap("V1 in 0 10\nR1 in out 1k\nR2 out 0 3k\nR3 out 0 6k");
    const ranked = c.sensitivities("out");
    expect(ranked.map((s) => s.id)).toEqual(["V1", "R1", "R2", "R3"]);
    expect(ranked.map((s) => s.normalized)).toEqual([
      expect.closeTo(1, 9),
      expect.closeTo(-1 / 3, 9),
      expect.closeTo(2 / 9, 9),
      expect.closeTo(1 / 9, 9),
    ]);
  });

  it("skips ideal op-amps and puts undefined ratios last", () => {
    const c = new ElecMap("V1 in 0 1\nX1 in out out OPAMP\nR1 out 0 1k\nI1 x 0 0\nR2 x 0 1k");
    const ids = c.sensitivities("out").map((s) => s.id);
    expect(ids).not.toContain("X1");
    expect(ids[0]).toBe("V1");
    expect(c.sensitivities("x").every((s) => Number.isNaN(s.normalized))).toBe(true);
  });
});

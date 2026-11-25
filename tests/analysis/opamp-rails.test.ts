import { describe, expect, it } from "vitest";
import { ElecMap, ElecMapError, parseSpice } from "../../src";
import { limiter, limiterInverse } from "../../src/mna/opamp";

/** Inverting Schmitt trigger: thresholds ±Vsat·R1/(R1+R2) = ±7.5 V. */
const schmitt = (source: string, opamp = "VSAT=15") => `V1 n1 0 ${source}
R3 in n1 1k
X1 n2 in out OPAMP ${opamp}
R2 n2 out 1k
R1 n2 0 1k`;

/** Non-inverting amplifier of gain 2. */
const amplifier = (vin: number, opamp: string) => `V1 p 0 ${vin}
X1 p m out OPAMP ${opamp}
R2 m out 1k
R1 m 0 1k`;

/** The op-amp parsed from an `X1 a b c OPAMP …` line (after another element). */
const opamp = (params: string) =>
  parseSpice(`R9 a 0 1
X1 a b c OPAMP ${params}`).circuit.components[1];

describe("op-amp rails: parsing and export", () => {
  it("parses VSAT as symmetric rails and VPOS / VNEG as given", () => {
    expect(opamp("VSAT=12")).toMatchObject({ type: "opamp", vpos: 12, vneg: -12 });
    expect(opamp("GAIN=1e5 VPOS=5 VNEG=0")).toMatchObject({ gain: 1e5, vpos: 5, vneg: 0 });
    expect(opamp("")).not.toHaveProperty("vpos");
  });

  it("rejects inconsistent rails", () => {
    expect(() => opamp("VSAT=1 VPOS=2 VNEG=0")).toThrow(/VSAT excludes/);
    expect(() => opamp("VPOS=2")).toThrow(/go together/);
    expect(() => new ElecMap("V1 a 0 1\nR1 a b 1k\nX1 0 b c OPAMP VPOS=0 VNEG=5")).toThrow(
      ElecMapError,
    );
  });

  it("keeps the rails through SPICE, .cir and .asc exports", () => {
    const c = new ElecMap(schmitt("5", "VPOS=12 VNEG=-3 GBW=1Meg"));
    expect(c.toSpice()).toMatch(/X1 n2 in out OPAMP GBW=1meg VPOS=12 VNEG=-3/);
    expect(new ElecMap(c.toSpice()).toJSON()).toEqual(c.toJSON());
    expect(new ElecMap(schmitt("5")).toSpice()).toMatch(/OPAMP VSAT=15$/m);
    const cir = c.toCir();
    expect(cir).toMatch(/B1 y 0 V=4\.5\+7\.5\*tanh\(133\.3\d*k\*\(V\(inp\)-V\(inn\)\)\)/);
    expect(cir).toMatch(/^X1 n2 in out OPAMP_X1$/m);
    const asc = c.toAsc();
    expect(asc).toMatch(/SYMATTR Value OPAMP_X1/);
    expect(asc).toMatch(/\.subckt OPAMP_X1/);
    expect(asc).not.toMatch(/opamp\.sub/);
  });
});

describe("op-amp rails: analyses", () => {
  it("inverts the limiter everywhere, past the knee too", () => {
    for (const z of [-40, -3, -0.2, 0, 0.5, 5, 30]) {
      expect(limiterInverse(limiter(z)).z).toBeCloseTo(z, 3);
    }
  });

  it("leaves an op-amp without rails linear", () => {
    const c = new ElecMap(amplifier(1, "GAIN=1e5"));
    expect(c.system.nonlinear).toEqual([]);
    expect(c.system.unknowns).not.toContain("I(X1:sat)");
    expect(c.operatingPoint().voltage("out")).toBeCloseTo(2 / (1 + 2 / 1e5), 9);
  });

  it("clamps the DC output smoothly at the rails", () => {
    const out = (vin: number, opamp: string) =>
      new ElecMap(amplifier(vin, opamp)).operatingPoint().voltage("out");
    expect(out(1, "VSAT=15")).toBeCloseTo(2, 4);
    expect(out(5, "GAIN=1e5 VSAT=15")).toBeCloseTo(10 / (1 + 2 / 1e5), 4);
    expect(out(10, "VSAT=15")).toBeCloseTo(15, 3);
    expect(out(-10, "GAIN=1e5 GBW=1Meg VSAT=15")).toBeCloseTo(-15, 3);
    expect(out(10, "VPOS=5 VNEG=0")).toBeCloseTo(5, 3);
  });

  it("has an AC gain of about 0 when saturated, and the usual one otherwise", () => {
    const gain = (vin: number) =>
      new ElecMap(amplifier(vin, "GAIN=1e5 VSAT=15")).transferFunction("out").dcGain();
    expect(gain(1)).toBeCloseTo(2, 3);
    expect(Math.abs(gain(10))).toBeLessThan(1e-3);
  });

  it("settles a Schmitt trigger on the branch opposite to its input", () => {
    expect(new ElecMap(schmitt("5")).operatingPoint().voltage("out")).toBeCloseTo(-15, 3);
    expect(new ElecMap(schmitt("-5")).operatingPoint().voltage("out")).toBeCloseTo(15, 3);
  });

  it("switches a Schmitt trigger with hysteresis at ±7.5 V", () => {
    const c = new ElecMap(schmitt("SIN(0 10 1)"));
    const r = c.transient({ tStop: 2, tStep: 1e-3 });
    const vin = r.voltage("n1");
    const out = r.voltage("out");
    const switches: { vin: number; to: number }[] = [];
    for (let i = 2; i < out.length; i++) {
      if (Math.sign(out[i] as number) !== Math.sign(out[i - 1] as number)) {
        switches.push({ vin: vin[i] as number, to: Math.sign(out[i] as number) });
      }
    }
    // The first switch leaves the unstable 0 V start; then −7.5 V (up) and +7.5 V (down).
    expect(switches.map((s) => s.to)).toEqual([1, -1, 1]);
    for (const s of switches) expect(s.vin).toBeCloseTo(-7.5 * s.to, 2);
    expect(Math.max(...out)).toBeCloseTo(15, 3);
  });
});

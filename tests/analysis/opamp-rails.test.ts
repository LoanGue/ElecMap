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
    const json = (rails: object) => ({
      components: [
        { id: "V1", type: "vsource", nodes: ["a", "0"], dc: 1 },
        { id: "X1", type: "opamp", nodes: ["a", "out", "out"], ...rails },
      ],
    });
    expect(() => new ElecMap(json({ vpos: 5 }) as never)).toThrow(/go together/);
    expect(
      new ElecMap(json({ vpos: 5, vneg: 0 }) as never).operatingPoint().voltage("out"),
    ).toBeCloseTo(1, 4);
  });

  it("keeps the rails through a SPICE round trip", () => {
    const c = new ElecMap(schmitt("5", "VPOS=12 VNEG=-3 GBW=1Meg"));
    expect(c.toSpice()).toMatch(/X1 n2 in out OPAMP GBW=1meg VPOS=12 VNEG=-3/);
    expect(new ElecMap(c.toSpice()).toJSON()).toEqual(c.toJSON());
    expect(new ElecMap(schmitt("5")).toSpice()).toMatch(/OPAMP VSAT=15$/m);
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

  it("does not stop on small Newton steps near a rail (residual check)", () => {
    // Exact output of the x2 amplifier near the knee: out = 2·(vin − (15/A)·atanh(out/15)).
    const exact = (vin: number, a: number) => {
      let [lo, hi] = [0, 15];
      for (let k = 0; k < 200; k++) {
        const m = (lo + hi) / 2;
        if (m < 2 * (vin - (15 / a) * Math.atanh(m / 15))) lo = m;
        else hi = m;
      }
      return lo;
    };
    const out = (vin: number, a: number) =>
      new ElecMap(amplifier(vin, `GAIN=${a} VSAT=15`)).operatingPoint().voltage("out");
    // Without the check: 14.181 (above 2·vin) and 15.000.
    expect(out(7, 1e5)).toBeCloseTo(exact(7, 1e5), 4);
    expect(out(7, 1e3)).toBeCloseTo(exact(7, 1e3), 4);
  });

  it("follows the input inside the rails in a transient, and clips at them", () => {
    const c = new ElecMap(`V1 p 0 SIN(0 10 50)
X1 p m out OPAMP GAIN=1e5 VSAT=15
R2 m out 1k
R1 m 0 1k`);
    const r = c.transient({ tStop: 0.02, tStep: 2e-5 });
    const vin = r.voltage("p");
    r.voltage("out").forEach((v, i) => {
      const ideal = 2 * (vin[i] as number);
      if (Math.abs(ideal) < 14) expect(v).toBeCloseTo(ideal, 2);
      if (Math.abs(ideal) > 16) expect(Math.abs(v)).toBeCloseTo(15, 3);
    });
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
    // From i = 2: the jump away from the unstable 0 V start (i = 1) is not counted.
    // Up at −7.5 V, down at +7.5 V, then up again.
    expect(switches.map((s) => s.to)).toEqual([1, -1, 1]);
    // Detected at the first sample past the threshold: within one step of the input.
    const step = 10 * 2 * Math.PI * 1e-3;
    for (const s of switches) {
      expect(-s.to * s.vin).toBeGreaterThanOrEqual(7.5);
      expect(-s.to * s.vin).toBeLessThan(7.5 + step);
    }
    expect(Math.max(...out)).toBeCloseTo(15, 3);
  });
});

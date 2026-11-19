import { describe, expect, it } from "vitest";
import { ElecMap, ElecMapError, MnaSystem, compile, parseSpice, toSpice } from "../../src";
import { THERMAL_VOLTAGE, diodeCurrent, diodeParams, limitJunction } from "../../src/mna/devices";

const VT = THERMAL_VOLTAGE;

/** Shockley current with series resistance, solved for the junction voltage. */
function shockley(i: number, is = 1e-14, n = 1, rs = 0): number {
  return n * VT * Math.log(i / is + 1) + rs * i;
}

describe("diode physics", () => {
  it("applies SPICE defaults", () => {
    const p = diodeParams({ id: "D1", type: "diode", nodes: ["a", "0"] });
    expect(p.is).toBe(1e-14);
    expect(p.n).toBe(1);
    expect(p.rs).toBe(0);
    expect(p.bv).toBeUndefined();
    expect(p.vcrit).toBeCloseTo(VT * Math.log(VT / (Math.SQRT2 * 1e-14)), 12);
  });

  it("has a consistent derivative, breakdown included", () => {
    const p = diodeParams({ id: "D", type: "diode", nodes: ["a", "0"], bv: 5, n: 1.5 });
    for (const v of [-6, -5, -2, 0, 0.3, 0.7]) {
      const h = 1e-7;
      const num = (diodeCurrent(v + h, p).i - diodeCurrent(v - h, p).i) / (2 * h);
      expect(Math.abs(diodeCurrent(v, p).g - num)).toBeLessThan(1e-6 * Math.abs(num) + 1e-12);
    }
    expect(diodeCurrent(-5, p).i).toBeCloseTo(-1e-3, 6);
  });

  it("does not overflow far beyond the critical voltage", () => {
    const p = diodeParams({ id: "D", type: "diode", nodes: ["a", "0"] });
    const { i, g } = diodeCurrent(100, p);
    expect(Number.isFinite(i) && Number.isFinite(g)).toBe(true);
  });

  it("limits junction steps like SPICE pnjlim", () => {
    expect(limitJunction(0.5, 0.4, VT, 0.6)).toEqual({ v: 0.5, limited: false });
    const r = limitJunction(5, 0.6, VT, 0.6);
    expect(r.limited).toBe(true);
    expect(r.v).toBeCloseTo(0.6 + VT * Math.log(1 + 4.4 / VT), 12);
    expect(limitJunction(5, -1, VT, 0.6).v).toBeCloseTo(VT * Math.log(5 / VT), 12);
  });
});

describe("DC operating point with diodes", () => {
  it("solves a forward-biased diode", () => {
    const c = new ElecMap("V1 in 0 5\nR1 in a 1k\nD1 a 0");
    const op = c.operatingPoint();
    const i = op.current("D1");
    expect(op.voltage("a")).toBeCloseTo(shockley(i), 9);
    expect(i).toBeCloseTo((5 - op.voltage("a")) / 1000, 12);
    expect(op.iterations).toBeGreaterThan(1);
    expect(op.gminUsed).toBe(false);
  });

  it("accounts for the series resistance and the emission coefficient", () => {
    const c = new ElecMap(
      "V1 in 0 5\nR1 in a 1k\nD1 a 0 D1N4148\n.model D1N4148 D(IS=2.52n N=1.752 RS=0.568)",
    );
    const op = c.operatingPoint();
    const i = op.current("D1");
    expect(op.voltage("a")).toBeCloseTo(shockley(i, 2.52e-9, 1.752, 0.568), 9);
    expect(op.voltage("a")).toBeCloseTo(0.65323, 4);
  });

  it("blocks in reverse", () => {
    const op = new ElecMap("V1 in 0 5\nR1 in a 1k\nD1 0 a").operatingPoint();
    expect(op.current("D1")).toBeCloseTo(-1e-14 - 5e-12, 15);
    expect(op.voltage("a")).toBeCloseTo(5, 6);
  });

  it("regulates with a zener", () => {
    const c = new ElecMap("V1 in 0 12\nR1 in k 470\nDZ 0 k DZ51\n.model DZ51 D(BV=5.1 IBV=5m)");
    const vz = c.voltage("k") as number;
    const iz = -(c.current("DZ") as number);
    expect(iz).toBeCloseTo((12 - vz) / 470, 12);
    expect(iz / (5e-3 * Math.exp((vz - 5.1) / VT))).toBeCloseTo(1, 6);
    // Doubling the supply barely moves the zener voltage.
    expect(c.setValue("V1", 24).voltage("k") as number).toBeLessThan(vz + 0.05);
  });

  it("converges on hard circuits", () => {
    const cases = [
      // 1 kV across a diode and a small resistor.
      "V1 a 0 1000\nR1 a b 1\nD1 b 0",
      // A string of ten diodes.
      [
        "V1 n0 0 10",
        "R1 n0 n1 100",
        ...Array.from({ length: 10 }, (_, k) => `D${k} n${k + 1} n${k + 2}`),
        "R2 n11 0 10",
      ].join("\n"),
      // Bridge rectifier at DC.
      "V1 a b 10\nRg b 0 1meg\nD1 a p\nD2 b p\nD3 m a\nD4 m b\nRL p m 1k",
      // Diode clamp driven by a current source.
      "I1 0 a 1\nD1 a 0\nD2 0 a\nR1 a 0 1k",
      // Op-amp half-wave precision rectifier.
      "V1 in 0 -1\nR1 in m 10k\nX1 0 m o OPAMP GAIN=1e5\nD1 o n\nD2 m o\nR2 n m 10k\nRL n 0 10k",
    ];
    for (const net of cases) {
      const op = new ElecMap(net).operatingPoint();
      expect(op.x.every(Number.isFinite)).toBe(true);
    }
    const bridge = new ElecMap(cases[2] as string).operatingPoint();
    expect(bridge.voltage("p", "m")).toBeCloseTo(10 - 2 * shockley(bridge.current("RL")), 6);
  });

  it("reports NO_CONVERGENCE with the device list", () => {
    const c = new ElecMap("V1 a 0 1\nD1 a 0");
    try {
      c.operatingPoint({ maxIterations: 2 });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ElecMapError);
      expect((e as ElecMapError).code).toBe("NO_CONVERGENCE");
      expect((e as ElecMapError).details).toEqual({ devices: ["D1"] });
    }
  });
});

describe("small-signal analyses", () => {
  const net = "V1 in 0 DC 5 AC 1\nR1 in a 1k\nD1 a 0 DMOD\n.model DMOD D(IS=1e-14 RS=2 CJO=10p)";

  it("linearises the diode at its operating point", () => {
    const c = new ElecMap(net);
    const i = c.operatingPoint().current("D1");
    const rd = VT / i + 2;
    expect(c.impedance("a").dcGain()).toBeCloseTo((1000 * rd) / (1000 + rd), 6);
    expect(c.equivalentResistance("a", undefined, { mode: "dc" })).toBeCloseTo(
      (1000 * rd) / (1000 + rd),
      6,
    );
    expect(c.ac(0).voltage("a").re).toBeCloseTo(rd / (1000 + rd), 9);
    // The junction capacitance makes the response roll off.
    expect(c.ac(1e9).voltage("a").abs()).toBeLessThan(c.ac(1).voltage("a").abs());
    expect(c.transferFunction({ input: "V1", output: "a" }).dcGain()).toBeCloseTo(
      rd / (1000 + rd),
      9,
    );
  });

  it("gives the DC Thévenin voltage from Newton and the incremental resistance", () => {
    const c = new ElecMap(net);
    const th = c.thevenin("a");
    expect(th.voltage).toBeCloseTo(c.voltage("a") as number, 12);
    expect(th.resistance).toBeCloseTo(c.impedance("a").dcGain(), 9);
  });

  it("keeps linear circuits on the plain system", () => {
    const c = new ElecMap("V1 a 0 1\nR1 a 0 1k");
    expect(c.smallSignal).toBe(c.system);
  });

  it("refuses unlinearised and symbolic analyses", () => {
    const c = new ElecMap(net);
    expect(() => c.system.polynomialMatrix()).toThrow(/smallSignal/);
    expect(() => c.symbolicTransferFunction({ input: "V1", output: "a" })).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED" }),
    );
    expect(c.smallSignal.linear).toBe(true);
    expect(() => new MnaSystem(c.circuit, [1])).toThrow(
      expect.objectContaining({ code: "DIMENSION_MISMATCH" }),
    );
  });
});

describe("transient with diodes", () => {
  const rectifier =
    "V1 in 0 SIN(0 10 50)\nD1 in out DMOD\nR1 out 0 1k\nC1 out 0 100u\n.model DMOD D(IS=1e-14)";

  it("charges a half-wave rectifier to the peak minus one diode drop", () => {
    for (const method of ["gear2", "trap", "euler"] as const) {
      const tr = new ElecMap(rectifier).transient({ tStop: 40e-3, tStep: 20e-6, method });
      const v = tr.voltage("out");
      const peak = Math.max(...v);
      expect(peak).toBeGreaterThan(9.1);
      expect(peak).toBeLessThan(9.4);
      // Diode current never negative beyond leakage.
      expect(Math.min(...tr.current("D1"))).toBeGreaterThan(-1e-9);
    }
  });

  it("matches the DC operating point when nothing moves", () => {
    const c = new ElecMap("V1 in 0 5\nR1 in a 1k\nD1 a 0\nC1 a 0 1u");
    const tr = c.transient({ tStop: 1e-3 });
    expect(tr.voltage("a").slice(-1)[0]).toBeCloseTo(c.voltage("a") as number, 9);
    const ic = c.transient({ tStop: 20e-3, initial: "ic" });
    expect(ic.voltage("a")[0]).toBeCloseTo(0, 6);
    expect(ic.voltage("a").slice(-1)[0]).toBeCloseTo(c.voltage("a") as number, 6);
  });

  it("clips a sine with back-to-back zeners", () => {
    const c = new ElecMap(
      "V1 in 0 SIN(0 10 1k)\nR1 in o 1k\nDZ1 o m DZ\nDZ2 0 m DZ\n.model DZ D(BV=3.3)",
    );
    const v = c.transient({ tStop: 1e-3, tStep: 1e-6 }).voltage("o");
    expect(Math.max(...v)).toBeGreaterThan(3.3 + 0.5);
    expect(Math.max(...v)).toBeLessThan(3.3 + 0.9);
    expect(Math.min(...v)).toBeLessThan(-(3.3 + 0.5));
  });
});

describe("diode netlists", () => {
  it("parses models anywhere, case-insensitively, with overrides and area", () => {
    const { circuit, warnings } = parseSpice(
      "* rectifier\nD1 a 0 dmod 2 RS=1\nV1 a 0 1\n.MODEL DMOD D (IS=1n N=2 RS=4 BV=10 TT=5n XTI=3)\n.end",
    );
    expect(circuit.components[0]).toEqual({
      id: "D1",
      type: "diode",
      nodes: ["a", "0"],
      model: "DMOD",
      is: 2e-9,
      n: 2,
      rs: 0.5,
      bv: 10,
      ibv: 2e-3,
      tt: 5e-9,
    });
    expect(warnings).toEqual(["Line 4: model DMOD: parameter XTI ignored"]);
  });

  it("accepts model-less diodes, with inline parameters", () => {
    const { circuit } = parseSpice("D1 a 0 IS=1f\nV1 a 0 1");
    expect(circuit.components[0]).toEqual({
      id: "D1",
      type: "diode",
      nodes: ["a", "0"],
      is: 1e-15,
    });
  });

  it("rejects unknown models, parameters and model types", () => {
    expect(() => parseSpice("V1 a 0 1\nD1 a 0 NOPE")).toThrow(/unknown model "NOPE"/);
    expect(() => parseSpice("V1 a 0 1\nD1 a 0 FOO=1")).toThrow(/unknown diode parameter/);
    expect(() => parseSpice(".model J1 NJF(BETA=1m)\nV1 a 0 1")).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED" }),
    );
    expect(() => parseSpice(".model M D\n.model m D\nV1 a 0 1")).toThrow(/duplicate model/);
  });

  it("round-trips through SPICE with .model cards", () => {
    const net =
      "V1 a 0 1\nD1 a b DMOD\nD2 b 0 DMOD RS=3\nD3 b 0 BV=5.1\n.model DMOD D(IS=2.52n N=1.752 RS=0.568)";
    const circuit = parseSpice(net).circuit;
    const text = toSpice(circuit);
    expect(text).toContain("D1 a b DMOD\n");
    expect(text).toContain("D2 b 0 DMOD RS=3\n");
    expect(text).toContain("D3 b 0 BV=5.1\n");
    expect(text).toContain(".model DMOD D(IS=2.52n N=1.752 RS=568m)\n.end");
    expect(parseSpice(text).circuit.components).toEqual(circuit.components);
  });

  it("validates diode parameters", () => {
    expect(() =>
      compile({
        version: 1,
        components: [
          { id: "V1", type: "vsource", nodes: ["a", "0"], dc: 1 },
          { id: "D1", type: "diode", nodes: ["a", "0"], is: -1 },
        ],
      }),
    ).toThrow(/"is" must be > 0/);
  });

  it("draws diode and zener symbols", () => {
    const svg = new ElecMap("V1 a 0 1\nR1 a b 1k\nD1 b 0\nDZ b 0 BV=5").toSVG();
    expect(svg).toContain("M30 -10L50 0L30 10Z");
    expect(svg).toContain("M44 -13L50 -10V10L56 13");
    expect(svg).toContain("BV 5 V");
  });

  it("sets diode parameters with setValue", () => {
    const c = new ElecMap("V1 in 0 5\nR1 in a 1k\nD1 a 0");
    const v = c.voltage("a") as number;
    expect(c.setValue("D1", 1e-12).voltage("a") as number).toBeLessThan(v);
    expect(c.setValue("D1", 2, "n").voltage("a") as number).toBeGreaterThan(v);
  });
});

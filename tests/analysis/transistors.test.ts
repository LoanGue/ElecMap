import { describe, expect, it } from "vitest";
import { ElecMap, MnaSystem, compile, parseSpice, toSpice, validateCircuit } from "../../src";
import {
  THERMAL_VOLTAGE,
  bjtCurrents,
  bjtParams,
  limitDrain,
  limitGate,
  mosfetCurrent,
  mosfetParams,
  mosfetThreshold,
} from "../../src/mna/devices";
import type { BjtJSON, MosfetJSON } from "../../src";

const VT = THERMAL_VOLTAGE;
const bjt = (extra: Partial<BjtJSON> = {}): BjtJSON => ({
  id: "Q",
  type: "bjt",
  nodes: ["c", "b", "e"],
  polarity: "npn",
  ...extra,
});
const mos = (extra: Partial<MosfetJSON> = {}): MosfetJSON => ({
  id: "M",
  type: "mosfet",
  nodes: ["d", "g", "s", "s"],
  polarity: "nmos",
  ...extra,
});
const close = (a: number, b: number, rel = 1e-6, abs = 1e-12) =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.abs(b) + abs);

describe("bipolar transistor physics", () => {
  it("applies SPICE defaults", () => {
    const p = bjtParams(bjt());
    expect([p.is, p.bf, p.br, p.ivaf, p.ivar, p.sign]).toEqual([1e-16, 100, 1, 0, 0, 1]);
    expect(bjtParams(bjt({ polarity: "pnp" })).sign).toBe(-1);
  });

  it("follows the transport model in forward-active mode", () => {
    const p = bjtParams(bjt({ vaf: 50 }));
    const d = bjtCurrents(0.65, -5, p);
    const ibe = 1e-16 * (Math.exp(0.65 / VT) - 1);
    const ibc = 1e-16 * (Math.exp(-5 / VT) - 1);
    close(d.ic, (ibe - ibc) * (1 + 5 / 50) - ibc);
    close(d.ib, ibe / 100 + ibc);
  });

  it("has consistent partial derivatives in every region", () => {
    const p = bjtParams(bjt({ vaf: 60, var: 20, bf: 80, br: 3, nf: 1.1 }));
    for (const [vbe, vbc] of [
      [0.7, -3],
      [0.75, 0.6],
      [-1, 0.7],
      [-2, -2],
    ] as const) {
      const h = 1e-7;
      const d = bjtCurrents(vbe, vbc, p, 1e-12);
      const dBe = (f: "ic" | "ib") =>
        (bjtCurrents(vbe + h, vbc, p, 1e-12)[f] - bjtCurrents(vbe - h, vbc, p, 1e-12)[f]) / (2 * h);
      const dBc = (f: "ic" | "ib") =>
        (bjtCurrents(vbe, vbc + h, p, 1e-12)[f] - bjtCurrents(vbe, vbc - h, p, 1e-12)[f]) / (2 * h);
      close(d.dicBe, dBe("ic"), 1e-5, 1e-10);
      close(d.dicBc, dBc("ic"), 1e-5, 1e-10);
      close(d.dibBe, dBe("ib"), 1e-5, 1e-10);
      close(d.dibBc, dBc("ib"), 1e-5, 1e-10);
    }
  });
});

describe("MOSFET physics", () => {
  const p = mosfetParams(mos({ vto: 1, kp: 2e-5, w: 1e-3, l: 1e-4, lambda: 0.02 }));

  it("applies SPICE defaults", () => {
    const d = mosfetParams(mos());
    expect([d.vto, d.beta, d.lambda, d.gamma, d.phi]).toEqual([0, 2e-5, 0, 0, 0.6]);
    expect(mosfetParams(mos({ polarity: "pmos", vto: -0.7 })).vto).toBe(0.7);
  });

  it("covers cut-off, linear and saturation", () => {
    expect(mosfetCurrent(0.5, 3, 0, p)).toMatchObject({ id: 0, region: "cutoff" });
    const lin = mosfetCurrent(3, 0.5, 0, p);
    expect(lin.region).toBe("linear");
    close(lin.id, 2e-4 * (2 - 0.25) * 0.5 * 1.01);
    const sat = mosfetCurrent(3, 5, 0, p);
    expect(sat.region).toBe("saturation");
    close(sat.id, 1e-4 * 4 * 1.1);
  });

  it("swaps drain and source for a negative Vds", () => {
    // Vgs = 3, Vds = −1: the source acts as the drain, Vgd = 4 > Vth.
    const r = mosfetCurrent(3, -1, 0, p);
    const f = mosfetCurrent(4, 1, 1, p);
    close(r.id, -f.id);
  });

  it("raises the threshold with the body effect", () => {
    const b = mosfetParams(mos({ vto: 1, gamma: 0.5, phi: 0.6 }));
    close(mosfetThreshold(-2, b).vth, 1 + 0.5 * (Math.sqrt(2.6) - Math.sqrt(0.6)));
    expect(mosfetThreshold(0, b).vth).toBe(1);
  });

  it("has consistent partial derivatives in every region and direction", () => {
    const b = mosfetParams(mos({ vto: 0.8, kp: 1e-4, lambda: 0.05, gamma: 0.4 }));
    for (const [vgs, vds, vbs] of [
      [2, 3, -1],
      [2, 0.3, -0.5],
      [2, -0.4, -1],
      [2.5, -3, 0],
    ] as const) {
      const h = 1e-7;
      const m = mosfetCurrent(vgs, vds, vbs, b);
      const g = (dg: number, dd: number, db: number) =>
        (mosfetCurrent(vgs + dg, vds + dd, vbs + db, b).id -
          mosfetCurrent(vgs - dg, vds - dd, vbs - db, b).id) /
        (2 * h);
      close(m.gm, g(h, 0, 0), 1e-5, 1e-10);
      close(m.gds, g(0, h, 0), 1e-5, 1e-10);
      close(m.gmbs, g(0, 0, h), 1e-5, 1e-10);
    }
  });

  it("limits gate and drain steps like SPICE fetlim / limvds", () => {
    expect(limitGate(1.2, 1.1, 1)).toBe(1.2);
    expect(limitGate(20, 0, 1)).toBe(1.5); // off → just above the threshold
    expect(limitGate(30, 6, 1)).toBe(18); // on: at most 2·|vold − vto| + 2
    expect(limitDrain(10, 1)).toBe(4);
    expect(limitDrain(30, 5)).toBe(17);
    expect(limitDrain(-5, 1)).toBe(-0.5);
  });
});

describe("transistor circuits", () => {
  const ce = `V1 vcc 0 10
RB vcc b 1Meg
RC vcc c 4.7k
Q1 c b 0 NPN`;

  it("biases a common-emitter stage (Ic = β·Ib)", () => {
    const op = new ElecMap(ce).operatingPoint();
    const ib = op.current("Q1:b");
    close(ib, (10 - op.voltage("b")) / 1e6, 1e-9);
    close(op.current("Q1") / ib, 100, 1e-4);
    close(op.voltage("c"), 10 - 4700 * op.current("Q1"), 1e-9);
    close(op.voltage("b"), VT * Math.log(op.current("Q1") / 1e-16 + 1), 1e-5);
  });

  it("names terminal currents, which sum to zero", () => {
    const c = new ElecMap(ce);
    const op = c.operatingPoint();
    close(op.current("Q1:c") + op.current("Q1:b") + op.current("Q1:e"), 0, 0, 1e-15);
    expect(op.current("Q1:collector")).toBe(op.current("Q1"));
    expect(op.current("Q1:BASE")).toBe(op.current("Q1:b"));
    expect(new MnaSystem(compile(ce)).unknowns).toContain("I(Q1:b)");
    expect(() => op.current("Q1:x")).toThrow(/no terminal "x"/);
    expect(() => op.current("RB:a")).toThrow(/no terminal currents/);
    expect(() => op.current("Q9:b")).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });

  it("computes the power of a transistor over its terminals", () => {
    const op = new ElecMap(ce).operatingPoint();
    close(
      op.power("Q1"),
      op.voltage("c") * op.current("Q1") + op.voltage("b") * op.current("Q1:b"),
    );
    const total = Object.values(new ElecMap(ce).power()).reduce((a, b) => a + b, 0);
    close(total, 0, 0, 1e-12);
  });

  it("mirrors an NPN with a PNP", () => {
    const n = new ElecMap(ce).operatingPoint();
    const p = new ElecMap(`V1 0 vee 10
RB vee b 1Meg
RC vee c 4.7k
Q1 c b 0 PNP`).operatingPoint();
    close(p.voltage("c"), -n.voltage("c"), 1e-9);
    close(p.current("Q1"), -n.current("Q1"), 1e-9);
  });

  it("includes the Early effect", () => {
    const vbe = 0.65;
    const c = new ElecMap(`VB b 0 ${vbe}
VC c 0 5
Q1 c b 0 NPN VAF=50`);
    const ibe = 1e-16 * (Math.exp(vbe / VT) - 1);
    const ibc = 1e-16 * (Math.exp((vbe - 5) / VT) - 1);
    close(c.operatingPoint().current("Q1"), (ibe - ibc) * (1 + (5 - vbe) / 50) - ibc, 1e-6);
  });

  it("gives the small-signal gain −gm·RC", () => {
    const c = new ElecMap(`${ce}
VS in 0 AC 1
CIN in b 1m`);
    const ic = c.operatingPoint().current("Q1");
    const h = c.transferFunction({ input: "VS", output: "c" });
    close(h.evaluate(1000).re, -(ic / VT) * 4700, 1e-4);
  });

  it("solves a MOSFET common-source stage in saturation and its gain", () => {
    const c = new ElecMap(`VDD vdd 0 5
VG g 0 DC 2 AC 1
RD vdd d 10k
M1 d g 0 0 NMOD W=1m L=100u
.model NMOD NMOS(VTO=1 KP=20u LAMBDA=0.01)`);
    const op = c.operatingPoint();
    const vd = op.voltage("d");
    close(op.current("M1"), 1e-4 * (1 + 0.01 * vd), 1e-7);
    close(op.current("M1:g"), 0);
    const gm = 2e-4 * (1 + 0.01 * vd);
    const gds = 1e-4 * 0.01;
    close(c.voltage("d", { freq: 1 }).re, -gm / (gds + 1e-4), 1e-6);
  });

  it("switches a CMOS inverter", () => {
    const net = (vin: number) => `VDD vdd 0 5
VIN in 0 ${vin}
MP out in vdd vdd PMOS VTO=-0.7 KP=50u W=20u L=1u
MN out in 0 0 NMOS VTO=0.7 KP=110u W=10u L=1u`;
    expect(new ElecMap(net(0)).voltage("out")).toBeCloseTo(5, 6);
    expect(new ElecMap(net(5)).voltage("out")).toBeCloseTo(0, 6);
    const mid = new ElecMap(net(2.5)).operatingPoint();
    close(mid.current("MP:d"), -mid.current("MN:d"), 0, 1e-12);
  });

  it("simulates the inverter in the time domain", () => {
    const tr = new ElecMap(`VDD vdd 0 5
VIN in 0 PULSE(0 5 1n 0.1n 0.1n 5n 10n)
MP out in vdd vdd PMOS VTO=-0.7 KP=50u W=20u L=1u
MN out in 0 0 NMOS VTO=0.7 KP=110u W=10u L=1u
CL out 0 100f`).transient({ tStop: 10e-9, tStep: 0.02e-9 });
    const v = tr.voltage("out");
    const at = (t: number) => v[Math.round(t / 0.02e-9)] as number;
    expect(at(0.5e-9)).toBeCloseTo(5, 3);
    expect(at(5e-9)).toBeLessThan(0.05);
    expect(at(9.5e-9)).toBeGreaterThan(4.95);
  });

  it("uses the substrate-free bulk and the body effect", () => {
    const base = `VDD vdd 0 5
VG g 0 2
RD vdd d 10k
`;
    const tied = new ElecMap(`${base}M1 d g 0 NMOS VTO=1 KP=20u GAMMA=0.5 W=1m L=100u`);
    const biased = new ElecMap(
      `${base}VB sub 0 -1\nM1 d g 0 sub NMOS VTO=1 KP=20u GAMMA=0.5 W=1m L=100u`,
    );
    const vth = 1 + 0.5 * (Math.sqrt(1.6) - Math.sqrt(0.6));
    close(tied.operatingPoint().current("M1"), 1e-4, 1e-7);
    close(biased.operatingPoint().current("M1"), 1e-4 * (2 - vth) ** 2, 1e-7);
  });

  it("refuses symbolic analysis", () => {
    expect(() => new ElecMap(ce).symbolicTransferFunction({ input: "V1", output: "c" })).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED" }),
    );
  });

  it("draws transistor symbols", () => {
    const svg = new ElecMap(`${ce}\nM1 c b 0 sub NMOS`).toSVG();
    expect(svg).toContain('data-type="bjt"');
    expect(svg).toContain('data-type="mosfet"');
  });
});

describe("transistor netlists", () => {
  it("reads Q and M lines with .model cards", () => {
    const { circuit, warnings } = parseSpice(`V1 a 0 1
Q1 c b e sub QM 2
M1 d g s b MM W=10u L=2u AD=1p
M2 d g s NMOS
.model QM PNP(IS=1f BF=50 VA=80 CJE=1p XTB=1.5)
.model MM PMOS(LEVEL=1 VT0=-0.8 KP=40u)`);
    const [, q, m1, m2] = circuit.components;
    expect(q).toEqual({
      id: "Q1",
      type: "bjt",
      nodes: ["c", "b", "e"],
      polarity: "pnp",
      model: "QM",
      is: 2e-15,
      bf: 50,
      vaf: 80,
      cje: 2e-12,
    });
    expect(m1).toEqual({
      id: "M1",
      type: "mosfet",
      nodes: ["d", "g", "s", "b"],
      polarity: "pmos",
      model: "MM",
      vto: -0.8,
      kp: 4e-5,
      w: 1e-5,
      l: 2e-6,
    });
    expect(m2).toEqual({ id: "M2", type: "mosfet", nodes: ["d", "g", "s", "s"], polarity: "nmos" });
    expect(warnings.join("\n")).toMatch(/XTB ignored/);
    expect(warnings.join("\n")).toMatch(/substrate node "sub" ignored/);
    expect(warnings.join("\n")).toMatch(/AD ignored/);
  });

  it("rejects wrong models", () => {
    expect(() => parseSpice("V1 a 0 1\nQ1 c b e NOPE")).toThrow(/unknown model "NOPE"/);
    expect(() => parseSpice("V1 a 0 1\nQ1 c b e DM\n.model DM D")).toThrow(/not a bipolar/);
    expect(() => parseSpice("V1 a 0 1\nM1 d g s NMOS FOO=1")).toThrow(/unknown MOSFET parameter/);
    expect(() => parseSpice("V1 a 0 1\n.model M2 NMOS(LEVEL=2)")).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED" }),
    );
  });

  it("round-trips through SPICE", () => {
    const net = `V1 a 0 1
Q1 c b e QM
Q2 c b e QM BF=20
Q3 c b e PNP IS=1f
M1 d g s b MM W=10u L=2u
M2 d g s s NMOS
.model QM NPN(IS=1f BF=200)
.model MM PMOS(VTO=-0.8 KP=40u)`;
    const circuit = parseSpice(net).circuit;
    const text = toSpice(circuit);
    expect(text).toContain("Q1 c b e QM\n");
    expect(text).toContain("Q2 c b e QM BF=20\n");
    expect(text).toContain("Q3 c b e PNP IS=1f\n");
    expect(text).toContain("M1 d g s b MM W=10u L=2u\n");
    expect(text).toContain(".model QM NPN(IS=1f BF=200)");
    expect(text).toContain(".model MM PMOS(VTO=-800m KP=40u)");
    expect(parseSpice(text).circuit.components).toEqual(circuit.components);
  });

  it("validates JSON transistors", () => {
    const issues = validateCircuit({
      version: 1,
      components: [
        { id: "V1", type: "vsource", nodes: ["a", "0"], dc: 1 },
        { id: "Q1", type: "bjt", nodes: ["a", "a", "0"], polarity: "nmos" },
        { id: "M1", type: "mosfet", nodes: ["a", "a", "0"], polarity: "nmos" },
      ],
    });
    expect(issues.map((i) => `${i.componentId}:${i.code}`)).toEqual([
      "Q1:MALFORMED",
      "M1:INVALID_NODES",
    ]);
  });

  it("builds two branch unknowns for a BJT", () => {
    const sys = new MnaSystem(compile("V1 b 0 0.7\nV2 c 0 5\nQ1 c b 0 NPN"));
    expect(sys.unknowns.slice(-2)).toEqual(["I(Q1)", "I(Q1:b)"]);
  });
});

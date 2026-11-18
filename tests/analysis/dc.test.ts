import { describe, expect, it } from "vitest";
import { ElecMap, ElecMapError } from "../../src";

describe("DC operating point", () => {
  it("solves a voltage divider", () => {
    const c = new ElecMap(`
      V1 in 0 10
      R1 in out 3k
      R2 out 0 1k
    `);
    expect(c.voltage("out")).toBeCloseTo(2.5, 12);
    expect(c.voltage("in", "out")).toBeCloseTo(7.5, 12);
    expect(c.current("R1")).toBeCloseTo(2.5e-3, 15);
    // SPICE convention: source current flows p → n inside the source, i.e. negative when delivering.
    expect(c.current("V1")).toBeCloseTo(-2.5e-3, 15);
  });

  it("solves a balanced and unbalanced Wheatstone bridge", () => {
    const net = (rx: string) => `
      V1 top 0 12
      R1 top a 1k
      R2 a 0 2k
      R3 top b 1k
      R4 b 0 ${rx}
      R5 a b 500
    `;
    expect(new ElecMap(net("2k")).current("R5")).toBeCloseTo(0, 15);
    const unbalanced = new ElecMap(net("1k"));
    expect(Math.abs(unbalanced.current("R5"))).toBeGreaterThan(1e-4);
    // KCL at node a
    const i1 = unbalanced.current("R1");
    expect(i1 - unbalanced.current("R2") - unbalanced.current("R5")).toBeCloseTo(0, 14);
  });

  it("injects current sources into their second node", () => {
    const c = new ElecMap(`
      I1 0 a 1m
      R1 a 0 1k
    `);
    expect(c.voltage("a")).toBeCloseTo(1, 12);
    expect(c.current("I1")).toBeCloseTo(1e-3, 15);
  });

  it("treats inductors as shorts and capacitors as opens", () => {
    const c = new ElecMap(`
      V1 in 0 5
      L1 in mid 10m
      R1 mid out 1k
      C1 out 0 1u
      R2 out 0 1k
    `);
    expect(c.voltage("in", "mid")).toBeCloseTo(0, 12);
    expect(c.current("L1")).toBeCloseTo(2.5e-3, 14);
    expect(c.current("C1")).toBe(0);
    expect(c.operatingPoint().gminUsed).toBe(false);
  });

  it("falls back to gmin for nodes behind a series capacitor", () => {
    const c = new ElecMap(`
      V1 in 0 5
      C1 in a 1u
      C2 a 0 1u
      R1 in 0 1k
    `);
    const op = c.operatingPoint();
    expect(op.gminUsed).toBe(true);
    expect(Number.isFinite(op.voltage("a"))).toBe(true);
  });

  it("models controlled sources", () => {
    const c = new ElecMap(`
      V1 in 0 1
      R1 in 0 1k
      E1 e 0 in 0 3
      Re e 0 1k
      G1 0 g in 0 2m
      Rg g 0 1k
      Vs in s 0
      Rs s 0 500
      F1 0 f Vs 4
      Rf f 0 100
      H1 h 0 Vs 1k
      Rh h 0 1k
    `);
    expect(c.voltage("e")).toBeCloseTo(3, 12);
    expect(c.voltage("g")).toBeCloseTo(2, 12); // 2 mS · 1 V into 1 kΩ
    expect(c.current("Vs")).toBeCloseTo(2e-3, 15);
    expect(c.voltage("f")).toBeCloseTo(0.8, 12); // 4 · 2 mA · 100 Ω
    expect(c.voltage("h")).toBeCloseTo(2, 12); // 1 kΩ · 2 mA
  });

  it("solves ideal and finite-gain op-amp amplifiers", () => {
    const inverting = new ElecMap(`
      V1 in 0 1
      R1 in m 1k
      R2 m out 10k
      X1 0 m out OPAMP
    `);
    expect(inverting.voltage("out")).toBeCloseTo(-10, 10);
    expect(inverting.voltage("m")).toBeCloseTo(0, 12);

    const a = 1e5;
    const nonInverting = new ElecMap(`
      V1 in 0 1
      X1 in m out OPAMP GAIN=${a}
      R1 m 0 1k
      R2 out m 9k
    `);
    const beta = 0.1;
    expect(nonInverting.voltage("out")).toBeCloseTo(a / (1 + a * beta), 9);
  });

  it("handles switches", () => {
    const net = (state: string) => `
      V1 in 0 10
      R1 in out 1k
      S1 out 0 ${state}
      R2 out 0 1k
    `;
    expect(new ElecMap(net("ON")).voltage("out")).toBeCloseTo(0, 12);
    expect(new ElecMap(net("OFF")).voltage("out")).toBeCloseTo(5, 12);
    expect(new ElecMap(net("ON RON=1k")).voltage("out")).toBeCloseTo(10 / 3, 12);
    expect(new ElecMap(net("OFF")).current("S1")).toBe(0);
  });

  it("balances power", () => {
    const c = new ElecMap(`
      V1 in 0 10
      R1 in out 3k
      R2 out 0 1k
      I1 0 out 1m
    `);
    const p = c.power();
    const total = Object.values(p).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(0, 14);
    expect(p.R1).toBeGreaterThan(0);
  });

  it("updates values with setValue", () => {
    const c = new ElecMap("V1 in 0 10\nR1 in out 1k\nR2 out 0 1k");
    expect(c.voltage("out")).toBeCloseTo(5, 12);
    c.setValue("R2", 3000).setValue("V1", 4);
    expect(c.voltage("out")).toBeCloseTo(3, 12);
    expect(() => c.setValue("R9", 1)).toThrow(ElecMapError);
  });

  it("exposes raw results", () => {
    const op = new ElecMap("V1 a 0 2\nR1 a 0 1k").operatingPoint();
    expect(op.nodeVoltages()).toEqual({ "0": 0, a: 2 });
    expect(Object.keys(op.currents())).toEqual(["V1", "R1"]);
  });
});

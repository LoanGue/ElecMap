import { describe, expect, it } from "vitest";
import { parseSpice } from "../../src/format/spice";
import { evaluate } from "../../src/format/expression";
import { ElecMap } from "../../src/ElecMap";
import type { ElecMapError } from "../../src/core/errors";

const fail = (m: string): never => {
  throw new Error(m);
};
const ev = (s: string, scope: Record<string, number> = {}) =>
  evaluate(s, new Map(Object.entries(scope)), fail);

describe("expressions", () => {
  it("evaluates arithmetic with precedence and SPICE suffixes", () => {
    expect(ev("1+2*3")).toBe(7);
    expect(ev("(1+2)*3")).toBe(9);
    expect(ev("2^3^2")).toBe(512);
    expect(ev("2**3")).toBe(8);
    expect(ev("-2^2")).toBe(-4);
    expect(ev("10k/2")).toBe(5000);
    expect(ev("100n*2")).toBeCloseTo(2e-7, 20);
    expect(ev("4k7")).toBe(4700);
  });

  it("uses parameters, constants and functions", () => {
    expect(ev("2*R", { R: 1000 })).toBe(2000);
    expect(ev("1/(2*pi*R*C)", { R: 1e3, C: 1e-6 })).toBeCloseTo(159.155, 3);
    expect(ev("sqrt(16) + max(1, 3, 2) + abs(-1)")).toBe(8);
    expect(ev("pow(2, 10)")).toBe(1024);
  });

  it("reports errors", () => {
    expect(() => ev("2*X")).toThrow(/unknown parameter "x"/);
    expect(() => ev("foo(1)")).toThrow(/unknown function "foo"/);
    expect(() => ev("(1+2")).toThrow(/expected "\)"/);
    expect(() => ev("1 2")).toThrow(/unexpected/);
    expect(() => ev("1/0")).toThrow(/finite/);
    expect(() => ev("1 # 2")).toThrow(/unexpected "# 2"/);
  });
});

describe(".param", () => {
  it("substitutes {expressions} in element lines", () => {
    const { circuit } = parseSpice(
      [
        "V1 in 0 1",
        ".param R=1k F=1k",
        ".param C={1/(2*pi*R*F)}",
        "R1 in out {R}",
        "C1 out 0 {C}",
      ].join("\n"),
    );
    expect(circuit.components[1]).toMatchObject({ id: "R1", value: 1000 });
    expect((circuit.components[2] as { value: number }).value).toBeCloseTo(1.5915e-7, 10);
  });

  it("accepts spaces inside braces", () => {
    const { circuit } = parseSpice("V1 a 0 1\n.param R=2k\nR1 a 0 { R / 2 }");
    expect(circuit.components[1]).toMatchObject({ value: 1000 });
  });
});

const DIVIDER = `
V1 in 0 10
.subckt DIV top out bot PARAMS: R1=1k R2=1k
Ra top out {R1}
Rb out bot {R2}
.ends DIV
X1 in mid 0 DIV
X2 in mid2 0 DIV R2=3k
.end`;

describe(".subckt", () => {
  it("flattens instances with prefixed ids and nodes", () => {
    const { circuit } = parseSpice(DIVIDER);
    expect(circuit.components).toEqual([
      expect.objectContaining({ id: "V1" }),
      { id: "X1.Ra", type: "resistor", nodes: ["in", "mid"], value: 1000 },
      { id: "X1.Rb", type: "resistor", nodes: ["mid", "0"], value: 1000 },
      { id: "X2.Ra", type: "resistor", nodes: ["in", "mid2"], value: 1000 },
      { id: "X2.Rb", type: "resistor", nodes: ["mid2", "0"], value: 3000 },
    ]);
  });

  it("solves like the flat circuit", () => {
    const c = new ElecMap(DIVIDER);
    expect(c.voltage("mid")).toBeCloseTo(5, 10);
    expect(c.voltage("mid2")).toBeCloseTo(7.5, 10);
    expect(c.current("X2.Rb")).toBeCloseTo(2.5e-3, 12);
  });

  it("prefixes internal nodes and keeps the ground global", () => {
    const { circuit } = parseSpice(`V1 in 0 1
.subckt RC a b
R1 a mid 1k
C1 mid b 1u
C2 mid 0 1n
.ends
X1 in out RC
X2 out 0 RC`);
    const nodes = Object.fromEntries(
      circuit.components.map((c) => [c.id, "nodes" in c ? c.nodes : []]),
    );
    expect(nodes["X1.R1"]).toEqual(["in", "X1.mid"]);
    expect(nodes["X1.C1"]).toEqual(["X1.mid", "out"]);
    expect(nodes["X1.C2"]).toEqual(["X1.mid", "0"]);
    expect(nodes["X2.C1"]).toEqual(["X2.mid", "0"]);
  });

  it("supports nested subcircuits, defined in any order", () => {
    const src = `V1 in 0 8
X1 in out 0 TWICE
.subckt TWICE a b g
XA a m g HALF
XB m b g HALF
.ends
.subckt HALF i o g PARAMS: R=1k
R1 i o {R}
R2 o g {R}
.ends`;
    const { circuit } = parseSpice(src);
    expect(circuit.components.map((c) => c.id)).toEqual([
      "V1",
      "X1.XA.R1",
      "X1.XA.R2",
      "X1.XB.R1",
      "X1.XB.R2",
    ]);
    expect(circuit.components[3]).toMatchObject({ nodes: ["X1.m", "out"] });
    // in → [1k] → m → [1k] → out, with 1k from m and out to ground.
    const c = new ElecMap(src);
    expect(c.voltage("X1.m")).toBeCloseTo(3.2, 10); // 8 V × (1k ∥ 2k) / (1k + 1k ∥ 2k)
    expect(c.voltage("out")).toBeCloseTo((c.voltage("X1.m") as number) / 2, 10);
  });

  it("passes parameters down, evaluated in the caller's scope", () => {
    const { circuit } = parseSpice(`V1 in 0 1
.param RBASE=2k
.subckt OUTER a PARAMS: K=1
XI a INNER R={K*RBASE}
.ends
.subckt INNER a PARAMS: R=1
R1 a 0 {R}
.ends
X1 in OUTER K=3`);
    expect(circuit.components[1]).toMatchObject({ id: "X1.XI.R1", value: 6000 });
  });

  it("renames controlling sources and coupled inductors", () => {
    const { circuit } = parseSpice(`V1 in 0 1
.subckt XFMR p s
L1 p 0 1m
L2 s 0 4m
K1 L1 L2 0.99
Vs s x 0
F1 x 0 Vs 2
H1 y 0 Vs 10
E1 z 0 p s 1
.ends
X1 in out XFMR
R1 out 0 1k`);
    const byId = Object.fromEntries(circuit.components.map((c) => [c.id, c]));
    expect(byId["X1.K1"]).toMatchObject({ inductors: ["X1.L1", "X1.L2"] });
    expect(byId["X1.F1"]).toMatchObject({ controlSource: "X1.Vs", nodes: ["X1.x", "0"] });
    expect(byId["X1.H1"]).toMatchObject({ controlSource: "X1.Vs" });
    expect(byId["X1.E1"]).toMatchObject({ control: ["in", "out"] });
    expect(() => new ElecMap(circuit)).not.toThrow();
  });

  it("uses global .model cards and op-amps inside subcircuits", () => {
    const src = `V1 in 0 0.5
.subckt AMP i o PARAMS: G=2
XU i fb o OPAMP
Rf o fb {(G-1)*1k}
Rg fb 0 1k
.ends
.subckt CLAMP a
D1 a 0 DMOD
.ends
.model DMOD D(IS=1e-14)
X1 in out AMP G=4
X2 out CLAMP
R1 out 0 1meg`;
    const { circuit } = parseSpice(src);
    expect(circuit.components.find((c) => c.id === "X1.XU")).toMatchObject({
      type: "opamp",
      nodes: ["in", "X1.fb", "out"],
    });
    expect(circuit.components.find((c) => c.id === "X2.D1")).toMatchObject({ type: "diode" });
    const amp = new ElecMap(src.replace("X2 out CLAMP", ""));
    expect(amp.voltage("out")).toBeCloseTo(2, 10);
  });

  it("reads a flattened netlist back (X1.R1 is a resistor)", () => {
    const flat = new ElecMap(DIVIDER).toSpice();
    expect(flat).toMatch(/^X1\.Ra in mid 1k$/m);
    const again = new ElecMap(flat);
    expect(again.voltage("mid2")).toBeCloseTo(7.5, 10);
  });

  it("detects the title line with subcircuits present", () => {
    const { circuit } = parseSpice(`My divider
${DIVIDER}`);
    expect(circuit.title).toBe("My divider");
    expect(circuit.components).toHaveLength(5);
    // An X line using a known subcircuit is not a title.
    const { circuit: c2 } = parseSpice(`X1 in mid 0 DIV
V1 in 0 1
.subckt DIV a b c
R1 a b 1k
R2 b c 1k
.ends`);
    expect(c2.title).toBeUndefined();
  });

  it("reports errors with line numbers", () => {
    const err = (src: string) => {
      try {
        parseSpice(src);
      } catch (e) {
        return e as ElecMapError;
      }
      throw new Error("expected an error");
    };
    const port = err("V1 a 0 1\n.subckt S a b\nR1 a b 1\n.ends\nX1 a S");
    expect(port.message).toMatch(/Line 5: X1: subcircuit S has 2 ports \(a b\), got 1 nodes/);
    expect(port.details).toEqual({ line: 5 });
    expect(err("V1 a 0 1\n.subckt S a\nX1 a S\n.ends\nX1 a S").message).toMatch(
      /recursive subcircuit S → S/,
    );
    expect(err("V1 a 0 1\n.subckt S a\nR1 a 0 1\n.ends\nX1 a S Q=1").message).toMatch(
      /no parameter Q/,
    );
    expect(err("V1 a 0 1\n.subckt S a\n.subckt T b\n.ends\n.ends").code).toBe("UNSUPPORTED");
    expect(err("V1 a 0 1\n.ends").message).toMatch(/Line 2: .ends without .subckt/);
    expect(err("V1 a 0 1\n.subckt S a\n.ends\n.subckt s b\n.ends").message).toMatch(
      /duplicate subcircuit/,
    );
    expect(err("V1 a 0 1\n.subckt S a a\n.ends").message).toMatch(/duplicate port/);
    expect(err("V1 a 0 1\nR1 a 0 {2*RX}").message).toMatch(
      /Line 2: in "2\*RX": unknown parameter "rx"/,
    );
    expect(err("V1 a 0 1\n.param 5").message).toMatch(/expected K=value/);
  });
});

import { describe, expect, it } from "vitest";
import { ElecMap, ElecMapError, parseSpice } from "../../src";
import {
  evaluate,
  formatExpression,
  parseExpression,
  resolveParameters,
} from "../../src/format/expression";
import { validateCircuit } from "../../src/format/validate";
import { compileExpression } from "../../src/mna/behavioral";

const fail = (m: string): never => {
  throw new Error(m);
};
const parse = (src: string) => parseExpression(src, fail, { probes: true });
const codes = (src: string) =>
  validateCircuit(parseSpice(src, { titleLine: false }).circuit).map((i) => i.code);

describe("expressions", () => {
  it("keeps the precedence of the parameter expressions", () => {
    const v = (s: string) => evaluate(s, new Map([["R", 2]]), fail);
    expect(v("-2^2")).toBe(-4);
    expect(v("2^3^2")).toBe(512);
    expect(v("1 + 2*R")).toBe(5);
    expect(v("2**-1")).toBe(0.5);
    expect(v("1k/R")).toBe(500);
  });

  it("evaluates comparisons, logic and the new functions", () => {
    const v = (s: string) => evaluate(s, new Map(), fail);
    expect(v("1 < 2")).toBe(1);
    expect(v("2 <= 1 || 3 == 3")).toBe(1);
    expect(v("!0 && 1 != 1")).toBe(0);
    expect(v("limit(5, -1, 2)")).toBe(2);
    expect(v("if(0, 1, 2)")).toBe(2);
    expect(v("u(-1) + u(1) + uramp(-3) + uramp(3)")).toBe(4);
    expect(v("atan2(1, 1)")).toBeCloseTo(Math.PI / 4, 12);
    expect(v("max(1, 5, 3) - min(4, 2)")).toBe(3);
    expect(v("tanh(0) + cosh(0) + sgn(-2)")).toBe(0);
  });

  it("reports errors with the expression", () => {
    expect(() => evaluate("foo(1)", new Map(), fail)).toThrow(
      'in "foo(1)": unknown function "foo"',
    );
    expect(() => evaluate("limit(1)", new Map(), fail)).toThrow("limit() takes 3 arguments");
    expect(() => evaluate("x + 1", new Map(), fail)).toThrow('unknown parameter "x"');
    expect(() => evaluate("V(a)", new Map(), fail)).toThrow('unknown function "v"');
  });

  it("parses probes and writes the expression back", () => {
    const e = parse("v( in , out )*I(Vs) - -2^time");
    expect(formatExpression(e)).toBe("V(in,out)*I(Vs) - -2^time");
    const again = parse(formatExpression(e));
    expect(formatExpression(again)).toBe(formatExpression(e));
    expect(formatExpression(parse("(a+b)*(c-d)/(e^f)^g"))).toBe("(a + b)*(c - d)/(e^f)^g");
    expect(formatExpression(parse("a - (b - c)"))).toBe("a - (b - c)");
    expect(formatExpression(parse("V(0)"))).toBe("V(0)");
  });

  it("replaces parameters and folds constants", () => {
    const ok = resolveParameters(parse("2*K*V(a) + sqrt(4) + time"), new Map([["K", 3]]), fail, [
      "TIME",
    ]);
    expect(formatExpression(ok)).toBe("6*V(a) + 2 + time");
    expect(() => resolveParameters(parse("K*V(a)"), new Map(), fail)).toThrow('"k"');
  });

  it("differentiates exactly", () => {
    const f = compileExpression(
      "B1",
      "V(a)^2*tanh(V(b)/2) + exp(V(a,b))/max(V(b), 0.5) + atan2(V(a), 3) - V(a)^V(b)",
      { node: (n) => ({ a: 0, b: 1 })[n] ?? -1, current: () => [] },
    );
    expect(f.probes).toEqual([
      [{ index: 0, coef: 1 }],
      [{ index: 1, coef: 1 }],
      [
        { index: 0, coef: 1 },
        { index: 1, coef: -1 },
      ],
    ]);
    const at = (a: number, b: number) => f.evaluate([a, b, a - b], 0);
    for (const [a, b] of [
      [1.2, 0.7],
      [2, 1.5],
      [0.4, 0.2],
    ] as const) {
      const { gradient } = at(a, b);
      const h = 1e-6;
      const da = (at(a + h, b).value - at(a - h, b).value) / (2 * h);
      const db = (at(a, b + h).value - at(a, b - h).value) / (2 * h);
      const g = gradient as [number, number, number];
      expect(g[0] + g[2]).toBeCloseTo(da, 6);
      expect(g[1] - g[2]).toBeCloseTo(db, 6);
    }
  });
});

describe("behavioural sources", () => {
  it("solves a voltage expression in DC and linearises it in AC", () => {
    const c = new ElecMap(`
V1 in 0 DC 3 AC 1
R1 in 0 1k
B1 out 0 V=V(in)^2/2
R2 out 0 1k
`);
    expect(c.voltage("out")).toBeCloseTo(4.5, 9);
    expect(c.current("B1")).toBeCloseTo(-4.5e-3, 12);
    // d(V²/2)/dV = V = 3.
    expect(c.transferFunction({ input: "V1", output: "out" }).dcGain()).toBeCloseTo(3, 9);
  });

  it("solves a current expression and a two-node probe", () => {
    const c = new ElecMap(`
V1 a 0 2
V2 b 0 0.5
B1 0 out I=1m*V(a,b)^2
R1 out 0 1k
`);
    expect(c.voltage("out")).toBeCloseTo(2.25, 9);
  });

  it("reads currents: sources, resistors, other B sources", () => {
    const c = new ElecMap(`
V1 in 0 5
R1 in 0 1k
B1 x 0 V=1k*I(R1) + 2*I(V1)*1k
R2 x 0 1k
B2 y 0 I=-I(B1)
R3 y 0 1
`);
    // I(R1) = 5 mA, I(V1) = −5 mA → V(x) = 5 − 10 = −5 V.
    expect(c.voltage("x")).toBeCloseTo(-5, 9);
    // R2 carries −5 mA from x to ground, so +5 mA enter B1 at x; B2 drives 5 mA into y.
    expect(c.current("B1")).toBeCloseTo(5e-3, 12);
    expect(c.voltage("y")).toBeCloseTo(5e-3, 12);
  });

  it("closes a non-linear feedback loop (logarithm by an op-amp)", () => {
    // The op-amp forces exp(V(out)) = V(in): V(out) = ln V(in).
    const c = new ElecMap(`
V1 in 0 2.25
R1 in m 10k
B1 fb 0 V=-exp(V(out))
R2 fb m 10k
X1 0 m out OPAMP
`);
    expect(c.voltage("out")).toBeCloseTo(Math.log(2.25), 9);
  });

  it("follows time in transient analysis", () => {
    const c = new ElecMap(`
V1 in 0 SIN(0 1 1k)
B1 out 0 V=if(V(in) > 0, V(in), 0) + time
R1 out 0 1k
`);
    const tr = c.transient({ tStop: 1e-3, tStep: 1e-5 });
    const out = tr.voltage("out");
    tr.time.forEach((t, i) => {
      const expected = Math.max(Math.sin(2 * Math.PI * 1000 * t), 0) + t;
      expect(out[i] as number).toBeCloseTo(expected, 6);
    });
  });

  it("drives a capacitor (soft limiter on an RC)", () => {
    const c = new ElecMap(`
V1 in 0 PULSE(0 5 0 1n 1n 1 2)
B1 0 out I=1m*tanh(V(in) - V(out))
C1 out 0 1u
`);
    const tr = c.transient({ tStop: 10e-3, tStep: 2e-5 });
    const out = tr.voltage("out");
    // Saturated: ≈ 1 mA into 1 µF → 1 V/ms at first, then it settles on 5 V.
    const at = (t: number) => out[tr.time.findIndex((x) => x >= t)] as number;
    expect(at(1e-3)).toBeCloseTo(1, 1);
    expect(at(10e-3)).toBeCloseTo(5, 2);
  });

  it("parses parameters, braces and subcircuits", () => {
    const { circuit } = parseSpice(`
.param K=2
.subckt SQ a y PARAMS: G=1
B1 y 0 V={G*V(a)^2}
R1 y 0 1k
.ends
V1 in 0 3
R1 in 0 1k
X1 in out SQ G={K}
B2 z 0 I=K*I(X1.B1)
R2 z 0 1
`);
    const b = circuit.components.filter((c) => c.type === "bsource");
    expect(b.map((c) => (c as { expression: string }).expression)).toEqual([
      "2*V(in)^2",
      "2*I(X1.B1)",
    ]);
    const c = new ElecMap(circuit);
    expect(c.voltage("out")).toBeCloseTo(18, 9);
    // I(X1.B1) = −18 mA (it feeds X1.R1), B2 draws −36 mA from z: V(z) = +36 mV.
    expect(c.voltage("z")).toBeCloseTo(0.036, 9);
    expect(new ElecMap(c.toSpice()).voltage("out")).toBeCloseTo(18, 9);
  });

  it("starts outside the domain of the expression (ln 0 at the first iterate)", () => {
    const c = new ElecMap(`
V1 a 0 1
B1 y 0 V=-26m*ln(V(a)/(10k*{10n}))
R1 y 0 1k
`);
    expect(c.voltage("y")).toBeCloseTo(-0.026 * Math.log(1e4), 9);
  });

  it("round-trips through JSON and SPICE", () => {
    const c = new ElecMap("V1 in 0 1\nR1 in 0 1k\nB1 out 0 I=-2m*V(in)\nR2 out 0 1k");
    expect(c.components()[2]).toEqual({
      id: "B1",
      type: "bsource",
      nodes: ["out", "0"],
      kind: "current",
      expression: "-0.002*V(in)",
    });
    expect(c.toSpice()).toContain("B1 out 0 I=-0.002*V(in)");
    expect(new ElecMap(c.toJSON()).voltage("out")).toBeCloseTo(2, 9);
    expect(c.toSVG()).toContain("I = -0.002*V(in)");
  });

  it("validates expressions and references", () => {
    const base = "V1 in 0 1\nR1 in 0 1k\nR2 out 0 1k\nC1 in 0 1n\n";
    expect(codes(base + "B1 out 0 V=V(in)*2")).toEqual([]);
    // A node driven by one terminal and read by a source is not dangling.
    expect(codes("V1 in 0 1\nB1 out 0 V=V(in)*2\nR1 out 0 1k")).toEqual([]);
    expect(codes("V1 in 0 1\nE1 out 0 in 0 2\nR1 out 0 1k")).toEqual([]);
    expect(codes("V1 in 0 1\nR1 in x 1k\nB1 out 0 V=2\nR2 out 0 1k")).toContain("DANGLING_NODE");
    expect(codes(base + "B1 out 0 V=V(nowhere)")).toContain("UNKNOWN_REFERENCE");
    expect(codes(base + "B1 out 0 V=I(R9)")).toContain("UNKNOWN_REFERENCE");
    expect(codes(base + "B1 out 0 V=I(C1)")).toContain("UNKNOWN_REFERENCE");
    expect(codes(base + "B1 in 0 V=1")).toContain("VOLTAGE_SOURCE_LOOP");
    const json = (extra: object) =>
      validateCircuit({
        components: [
          { id: "V1", type: "vsource", nodes: ["a", "0"], dc: 1 },
          { id: "B1", type: "bsource", nodes: ["b", "0"], ...extra },
        ],
      }).map((i) => i.code);
    expect(json({ kind: "power", expression: "1" })).toContain("MALFORMED");
    expect(json({ kind: "current", expression: "" })).toContain("MALFORMED");
    expect(json({ kind: "current", expression: "V(a) +" })).toContain("INVALID_VALUE");
    expect(json({ kind: "current", expression: "k*V(a)" })).toContain("INVALID_VALUE");
    expect(() => parseSpice("B1 out 0 W=1", { titleLine: false })).toThrow(ElecMapError);
    expect(() => parseSpice("B1 out 0 V=x*V(a)", { titleLine: false })).toThrow(
      'unknown parameter "x"',
    );
  });

  it("is not symbolic", () => {
    const c = new ElecMap("V1 in 0 AC 1\nB1 out 0 V=2*V(in)\nR1 out 0 1k");
    expect(() => c.symbolicTransferFunction("out")).toThrow(/non-linear/i);
    expect(c.transferFunction("out").dcGain()).toBeCloseTo(2, 12);
  });
});

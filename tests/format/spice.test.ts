import { describe, expect, it } from "vitest";
import { parseSpice, toSpice } from "../../src/format/spice";
import type { ElecMapError } from "../../src/core/errors";

const parse = (src: string) => parseSpice(src).circuit;

describe("parseSpice", () => {
  it("parses passive components", () => {
    const c = parse(`
R1 in out 1k
C1 out 0 100n IC=0.5
L1 out 0 10m
`);
    expect(c.components).toEqual([
      { id: "R1", type: "resistor", nodes: ["in", "out"], value: 1000 },
      { id: "C1", type: "capacitor", nodes: ["out", "0"], value: 100e-9, ic: 0.5 },
      { id: "L1", type: "inductor", nodes: ["out", "0"], value: 10e-3 },
    ]);
  });

  it("treats the first line as a title when it is not an element", () => {
    const c = parse("RC low-pass filter\nR1 a 0 1k\n");
    expect(c.title).toBe("RC low-pass filter");
    expect(c.components).toHaveLength(1);
  });

  it("does not eat the first element when there is no title", () => {
    const c = parse("R1 a 0 1k\nR2 a 0 2k");
    expect(c.title).toBeUndefined();
    expect(c.components).toHaveLength(2);
  });

  it("honours an explicit title option and .title", () => {
    expect(parseSpice("R1 a 0 1k\nR2 a 0 1k", { titleLine: true }).circuit.components).toHaveLength(
      1,
    );
    expect(parse(".title My circuit\nR1 a 0 1k").title).toBe("My circuit");
  });

  it("handles comments, continuation lines and .end", () => {
    const c = parse(`* comment
R1 a 0 ; inline comment
+ 1k
R2 a 0 2k $ another comment
.end
R3 a 0 3k`);
    expect(c.components.map((x) => x.id)).toEqual(["R1", "R2"]);
    expect(c.components[0]).toMatchObject({ value: 1000 });
  });

  it("parses voltage sources with DC, AC and waveforms", () => {
    const c = parse(`
V1 in 0 DC 5 AC 1 90 SIN(0 1 1k)
V2 a 0 3
V3 b 0 AC 2
V4 c 0 PULSE (0 5 1u 1n 1n 10u 20u)
V5 d 0 PWL(0 0, 1m 1, 2m 0)
I1 e 0 EXP(0 1 0 1m)
I2 f 0 AC(1 45)
`);
    expect(c.components).toEqual([
      {
        id: "V1",
        type: "vsource",
        nodes: ["in", "0"],
        dc: 5,
        ac: { mag: 1, phase: 90 },
        waveform: { kind: "sine", offset: 0, amplitude: 1, freq: 1000 },
      },
      { id: "V2", type: "vsource", nodes: ["a", "0"], dc: 3 },
      { id: "V3", type: "vsource", nodes: ["b", "0"], ac: { mag: 2 } },
      {
        id: "V4",
        type: "vsource",
        nodes: ["c", "0"],
        waveform: {
          kind: "pulse",
          v1: 0,
          v2: 5,
          delay: 1e-6,
          rise: 1e-9,
          fall: 1e-9,
          width: 10e-6,
          period: 20e-6,
        },
      },
      {
        id: "V5",
        type: "vsource",
        nodes: ["d", "0"],
        waveform: {
          kind: "pwl",
          points: [
            [0, 0],
            [1e-3, 1],
            [2e-3, 0],
          ],
        },
      },
      {
        id: "I1",
        type: "isource",
        nodes: ["e", "0"],
        waveform: { kind: "exp", v1: 0, v2: 1, td1: 0, tau1: 1e-3 },
      },
      { id: "I2", type: "isource", nodes: ["f", "0"], ac: { mag: 1, phase: 45 } },
    ]);
  });

  it("parses controlled sources, coupling, op-amps and switches", () => {
    const c = parse(`
E1 o 0 a b 10
G1 o 0 a b 1m
F1 o 0 Vs 2
H1 o 0 Vs 1k
K1 L1 L2 0.99
XU1 p n out OPAMP GAIN=1e5 GBW=1meg
X2 p n out opamp
S1 a b ON RON=0.1
S2 a b off
`);
    expect(c.components).toEqual([
      { id: "E1", type: "vcvs", nodes: ["o", "0"], control: ["a", "b"], gain: 10 },
      { id: "G1", type: "vccs", nodes: ["o", "0"], control: ["a", "b"], gain: 1e-3 },
      { id: "F1", type: "cccs", nodes: ["o", "0"], controlSource: "Vs", gain: 2 },
      { id: "H1", type: "ccvs", nodes: ["o", "0"], controlSource: "Vs", gain: 1000 },
      { id: "K1", type: "coupling", inductors: ["L1", "L2"], k: 0.99 },
      { id: "XU1", type: "opamp", nodes: ["p", "n", "out"], gain: 1e5, gbw: 1e6 },
      { id: "X2", type: "opamp", nodes: ["p", "n", "out"] },
      { id: "S1", type: "switch", nodes: ["a", "b"], closed: true, ron: 0.1 },
      { id: "S2", type: "switch", nodes: ["a", "b"], closed: false },
    ]);
  });

  it("warns about ignored directives", () => {
    const r = parseSpice("R1 a 0 1k\n.ac dec 10 1 1meg\n.op");
    expect(r.warnings).toHaveLength(2);
  });

  it("reports errors with line numbers", () => {
    const err = (src: string) => {
      try {
        parseSpice(src, { titleLine: false });
      } catch (e) {
        return e as ElecMapError;
      }
      throw new Error("expected an error");
    };
    expect(err("R1 a 0 1k\nR2 a 0 abc").details).toEqual({ line: 2 });
    expect(err("R1 a 0 1k\nR2 a 0 abc").code).toBe("PARSE_ERROR");
    expect(err("Q1 c b e 2n2222").message).toMatch(/unknown element/);
    expect(err("X1 a b c MYSUB").code).toBe("UNSUPPORTED");
    expect(err(".subckt foo a b").code).toBe("UNSUPPORTED");
    expect(err("V1 a 0 SIN(0 1").message).toMatch(/missing "\)"/);
    expect(err("S1 a b maybe").message).toMatch(/ON or OFF/);
    expect(err("+ 1k").message).toMatch(/continuation/);
  });
});

describe("toSpice", () => {
  it("round-trips through parseSpice", () => {
    const src = `.title Round trip
V1 in 0 DC 1 AC 1 SIN(0 1 1k)
V2 x 0 PULSE(0 5 1u)
V3 y 0 PWL(0 0 1m 1)
I1 z 0 EXP(0 1)
R1 in out 4.7k
C1 out 0 100n IC=1
L1 out x 1m
L2 y 0 2m
K1 L1 L2 0.5
E1 a 0 in 0 2
G1 a 0 in 0 1m
F1 b 0 V1 3
H1 c 0 V1 10
XU1 in out a OPAMP GAIN=100k
S1 a b ON RON=1
`;
    const c1 = parse(src);
    const c2 = parse(toSpice(c1));
    expect(c2).toEqual(c1);
  });

  it("emits a comment header without title", () => {
    expect(toSpice({ version: 1, components: [] })).toBe("* ElecMap circuit\n.end\n");
  });
});

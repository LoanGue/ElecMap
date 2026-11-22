import { describe, expect, it } from "vitest";
import { ElecMap } from "../../src";
import { ASC_SYMBOLS, ASC_TRANSFORMS } from "../../src/format/asc";
import type { Point } from "../../src/format/asc";
import { EXAMPLES } from "../../docs/playground/examples";

/**
 * Reads an `.asc` as LTspice does: wires join at their ends only, pins and
 * labels join what lies on their point, labels of the same name are one net.
 * Returns the nets of every symbol pin (by label), in the symbol's pin order.
 */
function readAsc(asc: string): Map<string, string[]> {
  const wires: [Point, Point][] = [];
  const flags: [Point, string][] = [];
  const symbols: { name: string; at: Point[] }[] = [];
  for (const line of asc.split("\n")) {
    const w = line.split(" ");
    if (w[0] === "WIRE") {
      const [x1, y1, x2, y2] = w.slice(1).map(Number) as [number, number, number, number];
      expect(x1 === x2 || y1 === y2, line).toBe(true);
      wires.push([
        [x1, y1],
        [x2, y2],
      ]);
    } else if (w[0] === "FLAG") flags.push([[Number(w[1]), Number(w[2])], w[3] as string]);
    else if (w[0] === "SYMBOL") {
      const symbol = Object.values(ASC_SYMBOLS).find((s) => s.name === w[1]);
      const t = ASC_TRANSFORMS.find(([r]) => r === w[4]);
      if (!symbol || !t) throw new Error(`unknown symbol: ${line}`);
      const o: Point = [Number(w[2]), Number(w[3])];
      symbols.push({
        name: "",
        at: symbol.pins.map(t[1]).map(([x, y]): Point => [x + o[0], y + o[1]]),
      });
    } else if (w[0] === "SYMATTR" && w[1] === "InstName") {
      const last = symbols[symbols.length - 1];
      if (last) last.name = w[2] as string;
    }
  }
  const k = ([x, y]: Point) => `${x},${y}`;
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    const up = parent.get(a);
    return up === undefined ? a : find(up);
  };
  const join = (a: string, b: string) => {
    if (find(a) !== find(b)) parent.set(find(a), find(b));
  };
  // Safe for every LTspice version: nothing touches a wire between its ends.
  const points = [...wires.flat(), ...flags.map((f) => f[0]), ...symbols.flatMap((s) => s.at)];
  for (const [a, b] of wires) {
    join(k(a), k(b));
    for (const p of points) {
      const inside = (i: 0 | 1) =>
        p[1 - i] === a[1 - i] &&
        a[1 - i] === b[1 - i] &&
        p[i] > Math.min(a[i], b[i]) &&
        p[i] < Math.max(a[i], b[i]);
      expect(inside(0) || inside(1), `${k(p)} inside a wire`).toBe(false);
    }
  }
  for (const [p, name] of flags) join(k(p), `net ${name}`);
  const nets = new Map<string, string[]>();
  for (const s of symbols)
    nets.set(
      s.name,
      s.at.map((p) => find(k(p))).map((r) => (r.startsWith("net ") ? r.slice(4) : `?${r}`)),
    );
  return nets;
}

/** The `.asc` has the elements and connections of the `.cir`. */
function sameAsCir(netlist: string): string {
  const c = new ElecMap(netlist);
  const asc = c.toAsc();
  const nets = readAsc(asc);
  for (const line of c.toCir().split("\n").slice(1)) {
    if (line.startsWith(".")) break; // models and subcircuits
    const w = line.split(" ");
    if (!/^[RCLVIDEGFHBQMX]/.test(line) || w[0] === undefined) continue;
    let name = w[0];
    let expected: string[];
    const isOpamp =
      /^(EX|X)/.test(name) &&
      nets.has(name.replace(/^EX/, "X")) &&
      (nets.get(name.replace(/^EX/, "X"))?.length ?? 0) === 3;
    if (isOpamp && name.startsWith("EX")) {
      name = name.replace(/^EX/, "X");
      expected = [w[3], w[4], w[1]] as string[];
    } else if (isOpamp) expected = w.slice(1, 4);
    else {
      const got = nets.get(name);
      if (!got) throw new Error(`${name} missing in\n${asc}`);
      expected = w.slice(1, 1 + got.length);
      if (name[0] === "M" && got.length === 3) expected = w.slice(1, 4);
    }
    expect(nets.get(name), `${name} in\n${asc}`).toEqual(expected);
  }
  return asc;
}

describe("toAsc", () => {
  it.each(EXAMPLES.map((e) => [e.id, e.netlist]))(
    "draws the %s example as LTspice reads it",
    (_, netlist) => {
      const asc = sameAsCir(netlist);
      expect(asc.startsWith("Version 4\nSHEET 1 ")).toBe(true);
    },
  );

  it("draws every kind of element", () => {
    const asc = sameAsCir(`
V1 a 0 DC 1 AC 1
I1 0 b 1m
R1 a b 1k
C1 b 0 1u
L1 b c 1m
L2 d 0 1m
K1 L1 L2 0.9
R2 d 0 1k
E1 e 0 b 0 2
R3 e 0 1k
G1 0 f a b 1m
R4 f 0 1k
Vs c g 0
R5 g 0 10
F1 0 h Vs 2
R6 h 0 1k
H1 i 0 Vs 100
R7 i 0 1k
B1 j 0 V=V(a)^2
R8 j 0 1k
B2 0 k I=V(a)*1m
R9 k 0 1k
D1 a l
R10 l 0 1k
Q1 m l 0 NPN
Q2 m l a PNP
R11 a m 1k
M1 n l 0 0 NMOS
M2 n l a b PMOS
R12 a n 1k
X1 0 o p OPAMP
R13 o p 10k
R14 a o 1k
X2 p q q OPAMP GBW=1meg
S1 q r ON RON=1
R15 r 0 1k
`);
    expect(asc).toContain("SYMBOL Opamps\\opamp");
    expect(asc).toContain("SYMATTR SpiceLine2 GBW=1meg");
    expect(asc).toMatch(/!.*\.lib opamp\.sub/);
    expect(asc).toContain("K1 L1 L2 900m");
    expect(asc).toContain("SYMATTR Value V=V(a)**2");
    for (const s of [
      "voltage",
      "current",
      "res",
      "cap",
      "ind",
      "e",
      "g",
      "f",
      "h",
      "bv",
      "bi",
      "diode",
      "npn",
      "pnp",
      "nmos",
      "pmos4",
    ])
      expect(asc, s).toContain(`SYMBOL ${s} `);
  });

  it("names every net and writes the analysis", () => {
    const asc = new ElecMap("V1 in 0 AC 1\nR1 in out 1k\nC1 out 0 100n").toAsc({
      analysis: [".ac dec 20 10 100k", ".meas AC fc WHEN mag(V(out))=0.7071"],
    });
    expect(asc).toMatch(/FLAG -?\d+ -?\d+ in\n/);
    expect(asc).toMatch(/FLAG -?\d+ -?\d+ out\n/);
    expect(asc).toContain("!.ac dec 20 10 100k\\n.meas AC fc WHEN mag(V(out))=0.7071\n");
  });
});

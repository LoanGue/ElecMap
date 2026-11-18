import { describe, expect, it } from "vitest";
import { ElecMap } from "../../src";
import type { PlacedPin, SchematicLayout } from "../../src";

const CIRCUITS: Record<string, string> = {
  rc: "V1 in 0 AC 1\nR1 in out 1k\nC1 out 0 100n",
  divider: "V1 in 0 DC 12\nR1 in out 4k\nR2 out 0 12k\nRL out 0 10k",
  ladder: "V1 in 0 AC 1\nR1 in a 1k\nC1 a 0 1u\nR2 a b 1k\nC2 b 0 1u\nR3 b out 1k\nC3 out 0 1u",
  wheatstone: "V1 in 0 DC 10\nR1 in a 1k\nR2 a 0 1k\nR3 in b 1k\nR4 b 0 1.2k\nR5 a b 100",
  inverting: "V1 in 0 AC 1\nR1 in n 1k\nRf n out 10k\nX1 0 n out OPAMP",
  noninverting: "V1 in 0 AC 1\nX1 in n out OPAMP\nR1 n 0 1k\nRf n out 9k\nRL out 0 10k",
  sallenKey: "V1 in 0 AC 1\nR1 in a 10k\nR2 a b 10k\nC1 a out 10n\nC2 b 0 10n\nX1 b out out OPAMP",
  transformer: "V1 in 0 AC 1\nR1 in p 10\nL1 p 0 10m\nL2 s 0 40m\nK1 L1 L2 0.99\nRL s 0 100",
  controlled: "V1 in 0 1\nR1 in c 1k\nE1 a 0 c 0 10\nR2 a out 1k\nF1 out 0 V1 2\nR3 out 0 1k",
  parallel: "V1 in 0 1\nR1 in out 1k\nR2 in out 2k\nC1 in out 1u\nR3 out 0 1k",
  floating: "V1 a b 5\nR1 a 0 1k\nR2 b 0 1k\nI1 a b 1m",
  twoIslands: "V1 a 0 1\nR1 a b 1k\nR2 b 0 1k\nV2 c 0 2\nR3 c d 1k\nC1 d 0 1u",
};

interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function unitEdges(s: Seg): [string, string, string][] {
  const out: [string, string, string][] = [];
  const dx = Math.sign(s.x2 - s.x1);
  const dy = Math.sign(s.y2 - s.y1);
  const n = Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);
  for (let k = 0; k < n; k++) {
    const a = `${s.x1 + dx * k},${s.y1 + dy * k}`;
    const b = `${s.x1 + dx * (k + 1)},${s.y1 + dy * (k + 1)}`;
    out.push([a < b ? `${a}|${b}` : `${b}|${a}`, a, b]);
  }
  return out;
}

/** Checks the electrical and geometric consistency of a layout. */
function validate(layout: SchematicLayout): string[] {
  const problems: string[] = [];
  const edgeOwner = new Map<string, string>();
  const vertexUse = new Map<string, Map<string, { h: boolean; v: boolean; deg: number }>>();
  const pins = new Map<string, string[]>();
  for (const c of layout.components) {
    for (const p of c.pins) {
      if (!p.ground) pins.set(`${p.x},${p.y}`, [...(pins.get(`${p.x},${p.y}`) ?? []), p.node]);
    }
  }
  for (const net of layout.nets) {
    const parent = new Map<string, string>();
    const find = (v: string): string => {
      const p = parent.get(v) ?? v;
      if (p === v) return v;
      const r = find(p);
      parent.set(v, r);
      return r;
    };
    for (const s of net.segments) {
      for (const [e, a, b] of unitEdges(s)) {
        const owner = edgeOwner.get(e);
        if (owner !== undefined && owner !== net.node) {
          problems.push(`edge ${e} shared by ${owner} and ${net.node}`);
        }
        edgeOwner.set(e, net.node);
        parent.set(find(a), find(b));
        for (const v of [a, b]) {
          const m = vertexUse.get(v) ?? new Map<string, { h: boolean; v: boolean; deg: number }>();
          const u = m.get(net.node) ?? { h: false, v: false, deg: 0 };
          if (s.y1 === s.y2) u.h = true;
          else u.v = true;
          u.deg++;
          m.set(net.node, u);
          vertexUse.set(v, m);
        }
      }
    }
    const netPins = layout.components.flatMap((c) =>
      c.pins.filter((p) => !p.ground && p.node === net.node),
    );
    const roots = new Set(netPins.map((p) => find(`${p.x},${p.y}`)));
    if (roots.size > 1) problems.push(`net ${net.node} is not connected (${roots.size} parts)`);
  }
  for (const [v, m] of vertexUse) {
    const nets = [...m.keys()];
    const pinNets = pins.get(v);
    if (pinNets && nets.some((n) => !pinNets.includes(n))) {
      problems.push(`wire of ${nets.join("/")} touches a pin at ${v}`);
    }
    if (nets.length > 1) {
      const straight = [...m.values()].every((u) => u.h !== u.v && u.deg === 2);
      if (!straight || nets.length > 2) problems.push(`nets ${nets.join("/")} touch at ${v}`);
    }
  }
  // Wires must not run through component bodies.
  for (const c of layout.components) {
    const body: string[] = [];
    if (c.type === "opamp") {
      const o = c.pins[2] as { x: number; y: number };
      for (let x = o.x - 3; x <= o.x - 1; x++) {
        for (let y = o.y - 1; y <= o.y + 1; y++) body.push(`${x},${y}`);
      }
    } else {
      const p = c.pins[0] as PlacedPin;
      const q = c.pins[1] as PlacedPin;
      for (let t = 1; t <= 3; t++) {
        body.push(`${p.x + ((q.x - p.x) * t) / 4},${p.y + ((q.y - p.y) * t) / 4}`);
      }
    }
    for (const v of body) if (vertexUse.has(v)) problems.push(`wire through ${c.id} at ${v}`);
  }
  return problems;
}

describe("schematic layout", () => {
  for (const [name, netlist] of Object.entries(CIRCUITS)) {
    it(`lays out "${name}" consistently`, () => {
      const c = new ElecMap(netlist);
      const layout = c.layout();
      expect(validate(layout)).toEqual([]);
      expect(layout.components.map((p) => p.id).sort()).toEqual(
        c
          .components()
          .filter((x) => x.type !== "coupling")
          .map((x) => x.id)
          .sort(),
      );
      const b = layout.bounds;
      for (const p of layout.components.flatMap((x) => x.pins)) {
        expect(p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY).toBe(true);
      }
    });
  }

  it("draws a simple RC like a textbook", () => {
    const layout = new ElecMap(CIRCUITS.rc as string).layout();
    const at = (id: string) => layout.components.find((c) => c.id === id);
    expect(at("V1")?.orientation).toBe("down");
    expect(at("C1")?.orientation).toBe("down");
    expect(at("R1")?.orientation).toBe("right");
    expect(layout.grounds).toHaveLength(2);
    for (const net of layout.nets) {
      expect(net.segments).toHaveLength(2);
      expect(net.junctions).toHaveLength(0);
    }
  });

  it("stays consistent on random circuits", () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let trial = 0; trial < 25; trial++) {
      const n = 2 + Math.floor(rand() * 6);
      const names = ["0", ...Array.from({ length: n }, (_, i) => `n${i}`)];
      const lines = ["V1 n0 0 1"];
      const count = n + Math.floor(rand() * n * 1.5);
      for (let k = 0; k < count; k++) {
        const a = names[Math.floor(rand() * names.length)] as string;
        let b = names[Math.floor(rand() * names.length)] as string;
        if (a === b) b = a === "0" ? "n0" : "0";
        const kind = ["R", "C", "L"][Math.floor(rand() * 3)] as string;
        lines.push(`${kind}${k + 1} ${a} ${b} 1k`);
      }
      if (rand() < 0.4 && n >= 4) lines.push("X1 n1 n2 n3 OPAMP");
      for (const name of names.slice(1)) lines.push(`Rz${name} ${name} 0 1meg`);
      const c = new ElecMap(lines.join("\n"));
      expect(validate(c.layout()), lines.join("\n")).toEqual([]);
    }
  });
});

describe("SVG output", () => {
  it("renders a standalone, well-formed document", () => {
    const svg = new ElecMap(CIRCUITS.sallenKey as string).toSVG();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg.match(/<g\b/g)?.length).toBe(svg.match(/<\/g>/g)?.length);
    for (const id of ["R1", "R2", "C1", "C2", "X1", "V1"]) expect(svg).toContain(`data-id="${id}"`);
    expect(svg).toContain('data-node="out"');
    expect(svg).toContain("prefers-color-scheme");
    expect(svg).toContain("10 kΩ");
  });

  it("honours the options", () => {
    const c = new ElecMap(CIRCUITS.rc as string);
    expect(c.toSVG()).toContain("<rect"); // IEC resistor
    expect(c.toSVG({ style: "ansi" })).toContain("L23.33 -8"); // ANSI zig-zag
    const bare = c.toSVG({ theme: "none", showValues: false, showIds: false, nodeLabels: false });
    expect(bare).not.toContain("<style>");
    expect(bare).not.toContain("<text");
    const hl = c.toSVG({ highlight: ["R1", "out"], theme: "dark", background: true, scale: 30 });
    expect(hl).toMatch(/class="c hl" data-id="R1"/);
    expect(hl).toMatch(/class="w hl" data-node="out"/);
    expect(hl).not.toContain("prefers-color-scheme");
    expect(hl).toContain('class="bg"');
    expect(c.toSVG({ title: "A & B" })).toContain("<title>A &amp; B</title>");
    const numeric = new ElecMap("V1 1 0 1\nR1 1 2 1k\nR2 2 0 1k");
    expect(numeric.toSVG()).not.toContain('class="node"');
    expect(numeric.toSVG({ nodeLabels: true })).toContain('class="node"');
  });
});

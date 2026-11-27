import { describe, expect, it } from "vitest";
import { ElecMap } from "../../../src";
import { layoutScene, partOf } from "../../../docs/playground/canvas/layout-scene";
import { CELL, SpriteCache } from "../../../docs/playground/canvas/sprites";
import { EXAMPLES } from "../../../docs/playground/examples";
import { pinsOf } from "../../../docs/playground/model";

const RC = `V1 in 0 AC 1
R1 in out 1k
C1 out 0 100n
`;

const opts = () => ({ style: "iec" as const, sprites: new SpriteCache() });

describe("canvas scene from an engine layout", () => {
  it.each(EXAMPLES.map((e) => [e.id, e.netlist]))(
    "%s: one symbol per component, one wire per segment, one dot per junction",
    (_, netlist) => {
      const layout = new ElecMap(netlist).layout();
      const s = layoutScene(layout, opts());
      expect(s.symbols.map((q) => q.id)).toEqual(layout.components.map((c) => c.id));
      expect(s.wires).toHaveLength(layout.nets.flatMap((n) => n.segments).length);
      expect(s.dots).toHaveLength(layout.nets.flatMap((n) => n.junctions).length);
      expect(s.grounds).toHaveLength(layout.grounds.length);
      expect(s.freePins).toEqual([]);
      expect(s.labels).toEqual([]);
    },
  );

  it.each(EXAMPLES.map((e) => [e.id, e.netlist]))(
    "%s: the editor part of each component has the engine's pins",
    (_, netlist) => {
      for (const c of new ElecMap(netlist).layout().components) {
        const pins = c.pins.slice(0, 3).map(({ x, y }) => ({ x, y }));
        expect(pinsOf(partOf(c))).toEqual(pins);
      }
    },
  );

  it("gives exact positions on an RC circuit", () => {
    const sprites = new SpriteCache();
    const layout = new ElecMap(RC).layout();
    const s = layoutScene(layout, { style: "iec", sprites });
    expect(s.wires).toEqual([
      { x1: 0, y1: 0, x2: 80, y2: 0, hl: false },
      { x1: 0, y1: 0, x2: 0, y2: 40, hl: false },
      { x1: 160, y1: 0, x2: 220, y2: 0, hl: false },
      { x1: 220, y1: 0, x2: 220, y2: 40, hl: false },
      { x1: 0, y1: 180, x2: 220, y2: 180, hl: false },
      { x1: 0, y1: 120, x2: 0, y2: 180, hl: false },
      { x1: 220, y1: 120, x2: 220, y2: 180, hl: false },
    ]);
    expect(s.grounds).toEqual([{ index: 0, x: 120, y: 180, hl: false }]);
    expect(s.symbols.map((q) => [q.id, q.key.kind, q.key.orientation])).toEqual([
      ["V1", "vsource", "down"],
      ["R1", "resistor", "right"],
      ["C1", "capacitor", "down"],
    ]);
    // The sprite anchor lands on the first pin of each two-terminal part.
    for (const [i, sym] of s.symbols.entries()) {
      const pin = layout.components[i]?.pins[0] ?? { x: NaN, y: NaN };
      const { anchor } = sprites.get(sym.key);
      expect(sym.translate).toEqual({ x: pin.x * CELL - anchor.x, y: pin.y * CELL - anchor.y });
    }
    expect(s.symbols[1]?.translate).toEqual({ x: 60, y: -20 });
  });

  it("keys transistors and op-amps by polarity, facing right", () => {
    const netlist = (id: string) => EXAMPLES.find((e) => e.id === id)?.netlist ?? "";
    const key = (netlist: string, id: string) =>
      layoutScene(new ElecMap(netlist).layout(), opts()).symbols.find((q) => q.id === id)?.key;
    expect(key(netlist("common-emitter"), "Q1")).toMatchObject({
      kind: "npn",
      orientation: "right",
    });
    expect(key(netlist("sallen-key"), "X1")).toMatchObject({ kind: "opamp", orientation: "right" });
    const pnp = "V1 e 0 5\nR1 c 0 1k\nR2 b 0 10k\nQ1 c b e QP\n.model QP PNP\n";
    expect(key(pnp, "Q1")).toMatchObject({ kind: "pnp", orientation: "right" });
  });

  it("highlights the nets, dots, grounds and parts asked for", () => {
    const layout = new ElecMap(RC).layout();
    const s = layoutScene(layout, {
      ...opts(),
      highlight: { nodes: new Set(["out", "0"]), parts: new Set(["C1"]) },
    });
    expect(s.wires.map((w) => w.hl)).toEqual([false, false, true, true, true, true, true]);
    expect(s.grounds.map((g) => g.hl)).toEqual([true]);
    expect(s.symbols.map((q) => q.hl)).toEqual([false, false, true]);
  });

  it("highlights a ground symbol under a grounded pin", () => {
    const layout = new ElecMap(RC).layout({ ground: "symbols" });
    const lit = layoutScene(layout, { ...opts(), highlight: { nodes: new Set(["0"]) } });
    expect(lit.grounds.map((g) => g.hl)).toEqual([true, true]);
    const off = layoutScene(layout, { ...opts(), highlight: { nodes: new Set(["in"]) } });
    expect(off.grounds.map((g) => g.hl)).toEqual([false, false]);
  });
});

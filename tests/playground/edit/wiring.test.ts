import { describe, expect, it } from "vitest";
import { liveNodes } from "../../../docs/playground/edit/fitting";
import { addWire, connectable, corner, strokeWires } from "../../../docs/playground/edit/wiring";
import { emptyDrawing, type Drawing, type Part } from "../../../docs/playground/model";
import { endsOf, key, simplify, type Pt, type Wire } from "../../../docs/playground/wires";

const pt = (x: number, y: number): Pt => ({ x, y });
const bar: Wire = { x1: 0, y1: 0, x2: 10, y2: 0 };
const withWires = (...wires: Wire[]): Drawing => ({ ...emptyDrawing(), wires });
const part = (p: Omit<Part, "id" | "value">): Drawing => ({
  ...emptyDrawing(),
  parts: [{ id: "P1", value: "", ...p }],
});
/** Wire ends left after simplify with the user nodes as anchors. */
const endsAfterSimplify = (d: Drawing): Set<string> =>
  new Set(simplify(d.wires, d.nodes).flatMap(endsOf).map(key));

describe("corner", () => {
  it("goes horizontal first from a free point", () => {
    expect(corner(emptyDrawing(), pt(0, 0), pt(3, 4))).toEqual(pt(3, 0));
  });

  it("leaves both pins of a vertical two-terminal part vertically", () => {
    const d = part({ kind: "resistor", x: 0, y: 0, dir: "down" });
    expect(corner(d, pt(0, 0), pt(3, -4))).toEqual(pt(0, -4));
    expect(corner(d, pt(0, 4), pt(3, 8))).toEqual(pt(0, 8));
  });

  it("leaves a horizontal two-terminal part sideways", () => {
    const d = part({ kind: "resistor", x: 0, y: 0, dir: "right" });
    expect(corner(d, pt(4, 0), pt(7, 3))).toEqual(pt(7, 0));
  });

  it("leaves a transistor's top and bottom pins vertically, its base sideways", () => {
    const d = part({ kind: "npn", x: 0, y: 0, dir: "right" });
    expect(corner(d, pt(0, 0), pt(3, -3))).toEqual(pt(0, -3));
    expect(corner(d, pt(0, 6), pt(3, 9))).toEqual(pt(0, 9));
    expect(corner(d, pt(-3, 3), pt(-6, 6))).toEqual(pt(-6, 3));
  });

  it("leaves every op-amp pin sideways", () => {
    const d = part({ kind: "opamp", x: 0, y: 0, dir: "right" });
    expect(corner(d, pt(0, 0), pt(3, 3))).toEqual(pt(3, 0));
    expect(corner(d, pt(-5, 1), pt(-8, 4))).toEqual(pt(-8, 1));
  });
});

describe("strokeWires", () => {
  it("draws an L, or a single wire when the stroke is straight", () => {
    expect(strokeWires(emptyDrawing(), pt(0, 0), pt(3, 4))).toEqual([
      { x1: 0, y1: 0, x2: 3, y2: 0 },
      { x1: 3, y1: 0, x2: 3, y2: 4 },
    ]);
    expect(strokeWires(emptyDrawing(), pt(0, 0), pt(0, 4))).toEqual([
      { x1: 0, y1: 0, x2: 0, y2: 4 },
    ]);
  });
});

describe("addWire", () => {
  it("adds the L-shaped wire and leaves the input drawing untouched", () => {
    const d = emptyDrawing();
    const out = addWire(d, pt(0, 0), pt(3, 4));
    expect(out.wires).toEqual(strokeWires(d, pt(0, 0), pt(3, 4)));
    expect(d.wires).toEqual([]);
  });

  it("ignores a stroke that does not move", () => {
    const d = withWires(bar);
    expect(addWire(d, pt(2, 2), pt(2, 2))).toBe(d);
  });

  it("does not add a wire already drawn, in either direction", () => {
    const d = withWires(bar);
    expect(addWire(d, pt(0, 0), pt(10, 0))).toBe(d);
    expect(addWire(d, pt(10, 0), pt(0, 0))).toBe(d);
  });

  it("adds only the missing piece of an L half drawn already", () => {
    const out = addWire(withWires(bar), pt(0, 0), pt(10, 5));
    expect(out.wires).toEqual([bar, { x1: 10, y1: 0, x2: 10, y2: 5 }]);
  });

  it("makes a node where a wire ends on the middle of another, kept by simplify", () => {
    const out = addWire(withWires(bar), pt(5, 5), pt(5, 0));
    expect(out.nodes).toEqual([pt(5, 0)]);
    expect(endsAfterSimplify(out).has("5,0")).toBe(true);
    expect(liveNodes(out.nodes, out.wires)).toEqual([pt(5, 0)]);
  });

  it("keeps the node even when simplify would merge the wires through it", () => {
    // The stroke runs back along the bar from outside: once merged, only the
    // node keeps a wire end at (5, 0).
    const out = addWire(withWires(bar), pt(15, 0), pt(5, 0));
    expect(out.nodes).toEqual([pt(5, 0)]);
    expect(endsAfterSimplify(out).has("5,0")).toBe(true);
    expect(endsAfterSimplify({ ...out, nodes: [] }).has("5,0")).toBe(false);
  });

  it("makes a node where the bend of the stroke lands on a bend of the wiring", () => {
    const bend = withWires({ x1: 5, y1: -5, x2: 5, y2: 0 }, { x1: 5, y1: 0, x2: 10, y2: 0 });
    const out = addWire(bend, pt(0, 0), pt(5, 3));
    expect(out.nodes).toEqual([pt(5, 0)]);
  });

  it("makes no node when the wire extends another one straight", () => {
    const out = addWire(withWires(bar), pt(10, 0), pt(15, 0));
    expect(out.nodes).toEqual([]);
    expect(simplify(out.wires, out.nodes)).toEqual([{ x1: 0, y1: 0, x2: 15, y2: 0 }]);
  });

  it("makes no node on a pin, even in the middle of a wire", () => {
    const d = { ...part({ kind: "resistor", x: 5, y: 0, dir: "down" }), wires: [bar] };
    expect(addWire(d, pt(5, 0), pt(5, -5)).nodes).toEqual([]);
  });

  it("adds a node only once", () => {
    const d = { ...withWires(bar), nodes: [pt(5, 0)] };
    expect(addWire(d, pt(5, 5), pt(5, 0)).nodes).toEqual([pt(5, 0)]);
  });
});

describe("connectable", () => {
  const d: Drawing = {
    ...part({ kind: "resistor", x: 20, y: 0, dir: "right" }),
    wires: [bar],
    grounds: [pt(0, 9)],
    labels: [{ ...pt(9, 9), name: "out" }],
    nodes: [pt(30, 30)],
  };

  it("accepts pins, grounds, labels, nodes and any point of a wire", () => {
    for (const p of [pt(20, 0), pt(24, 0), pt(0, 9), pt(9, 9), pt(30, 30), pt(0, 0), pt(7, 0)])
      expect(connectable(d, p)).toBe(true);
  });

  it("refuses an empty grid point", () => {
    expect(connectable(d, pt(7, 1))).toBe(false);
    expect(connectable(d, pt(22, 0))).toBe(false);
  });
});

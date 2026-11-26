import { describe, expect, it } from "vitest";
import {
  fit,
  insert,
  liveNodes,
  nodesMade,
  withNodes,
} from "../../../docs/playground/edit/fitting";
import type { Pt, Wire } from "../../../docs/playground/routing";

const bar: Wire = { x1: 0, y1: 0, x2: 10, y2: 0 };
const column: Wire = { x1: 5, y1: 0, x2: 5, y2: 10 };
const pt = (x: number, y: number): Pt => ({ x, y });

describe("fit", () => {
  const along = (start: Pt) => (dir: "right" | "down") =>
    dir === "right" ? [start, pt(start.x + 4, start.y)] : [start, pt(start.x, start.y + 4)];

  it("turns a part to lie along a horizontal or a vertical wire", () => {
    expect(fit([bar], ["down", "right"], along(pt(2, 0)))).toBe("right");
    expect(fit([column], ["right", "down"], along(pt(5, 2)))).toBe("down");
  });

  it("takes the first orientation that fits, in the order given", () => {
    const both = () => [pt(5, 0)];
    expect(fit([bar, column], ["down", "right"], both)).toBe("down");
  });

  it("needs every pin on one same wire, ends included", () => {
    expect(fit([bar], ["right"], along(pt(6, 0)))).toBe("right");
    expect(fit([bar], ["right"], along(pt(7, 0)))).toBeUndefined();
    const corner = () => [pt(3, 0), pt(5, 3)];
    expect(fit([bar, column], ["right"], corner)).toBeUndefined();
  });
});

describe("insert", () => {
  it("replaces the piece of wire between the pins, in any pin order", () => {
    expect(insert([bar, column], [pt(6, 0), pt(2, 0)])).toEqual([
      { x1: 0, y1: 0, x2: 2, y2: 0 },
      { x1: 6, y1: 0, x2: 10, y2: 0 },
      column,
    ]);
  });

  it("drops a half of zero length when a pin sits on a wire end", () => {
    expect(insert([bar], [pt(0, 0), pt(4, 0)])).toEqual([{ x1: 4, y1: 0, x2: 10, y2: 0 }]);
  });

  it("leaves the wiring alone off a wire or for other than two pins", () => {
    expect(insert([bar], [pt(2, 1), pt(6, 1)])).toEqual([bar]);
    expect(insert([bar], [pt(0, 0), pt(4, 0), pt(5, 0)])).toEqual([bar]);
  });
});

describe("nodesMade", () => {
  it("makes a node where a wire ends in the middle of another one", () => {
    expect(nodesMade([bar], [pt(4, 0), pt(4, 5)], [])).toEqual([pt(4, 0)]);
  });

  it("makes no node for a wire that merely extends a free wire end", () => {
    expect(nodesMade([bar], [pt(10, 0), pt(15, 0)], [])).toEqual([]);
  });

  it("expects the wiring before the new wire is added", () => {
    const extension: Wire = { x1: 10, y1: 0, x2: 15, y2: 0 };
    expect(nodesMade([bar, extension], [pt(10, 0)], [])).toEqual([pt(10, 0)]);
  });

  it("makes a node on a bend, never on a pin", () => {
    const bend = [
      { x1: 0, y1: 0, x2: 5, y2: 0 },
      { x1: 5, y1: 0, x2: 5, y2: 5 },
    ];
    expect(nodesMade(bend, [pt(5, 0)], [])).toEqual([pt(5, 0)]);
    expect(nodesMade([bar], [pt(4, 0)], [pt(4, 0)])).toEqual([]);
  });
});

describe("withNodes and liveNodes", () => {
  it("adds each new node once", () => {
    expect(withNodes([pt(1, 1)], [pt(1, 1), pt(2, 2), pt(2, 2)])).toEqual([pt(1, 1), pt(2, 2)]);
  });

  it("keeps a node only while it sits on a wire junction", () => {
    const nodes = [pt(4, 0), pt(10, 0), pt(50, 50)];
    expect(liveNodes(nodes, [bar])).toEqual([pt(4, 0)]);
    const halves = insert([bar], [pt(3, 0), pt(7, 0)]);
    expect(liveNodes([pt(4, 0)], halves)).toEqual([]);
  });
});

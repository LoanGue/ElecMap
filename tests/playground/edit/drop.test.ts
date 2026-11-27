import { describe, expect, it } from "vitest";
import { drop, landing } from "../../../docs/playground/edit/drop";
import { move } from "../../../docs/playground/edit/moves";
import { emptyDrawing } from "../../../docs/playground/model";
import type { Drawing, Part, Wire } from "../../../docs/playground/model";

const w = (x1: number, y1: number, x2: number, y2: number): Wire => ({ x1, y1, x2, y2 });
const r = (id: string, x: number, y: number, dir: Part["dir"] = "right"): Part => ({
  id,
  kind: "resistor",
  x,
  y,
  dir,
  value: "1k",
});
const drawing = (d: Partial<Drawing>): Drawing => ({ ...emptyDrawing(), ...d });

/** Wires as sorted strings, whatever their direction. */
function shape(wires: Wire[]): string[] {
  return wires
    .map((v) => {
      const first = v.x1 < v.x2 || (v.x1 === v.x2 && v.y1 <= v.y2);
      return first ? `${v.x1},${v.y1}-${v.x2},${v.y2}` : `${v.x2},${v.y2}-${v.x1},${v.y1}`;
    })
    .sort();
}
const placed = (d: Drawing, id: string) => {
  const p = d.parts.find((q) => q.id === id) as Part;
  return { x: p.x, y: p.y, dir: p.dir };
};

/** A free R1 below a horizontal and a vertical wire. */
const free = (): Drawing =>
  drawing({ parts: [r("R1", 0, 20)], wires: [w(0, 0, 10, 0), w(20, 0, 20, 10)] });

describe("playground drop", () => {
  it("inserts a part dropped on a wire in place of the piece between its pins", () => {
    const d = drop(free(), "R1", { x: 3, y: 0 });
    expect(placed(d, "R1")).toEqual({ x: 3, y: 0, dir: "right" });
    expect(shape(d.wires)).toEqual(["0,0-3,0", "20,0-20,10", "7,0-10,0"]);
  });

  it("turns a part dropped across a vertical wire around its centre, then inserts it", () => {
    // Centre of the horizontal part at (20, 5), on the vertical wire.
    const d = drop(free(), "R1", { x: 18, y: 5 });
    expect(placed(d, "R1")).toEqual({ x: 20, y: 3, dir: "down" });
    expect(shape(d.wires)).toEqual(["0,0-10,0", "20,0-20,3", "20,7-20,10"]);
  });

  it("previews the landing, turned or not, and none off the wires", () => {
    expect(landing(free(), "R1", { x: 18, y: 5 })).toEqual({ to: { x: 20, y: 3 }, dir: "down" });
    expect(landing(free(), "R1", { x: 3, y: 0 })).toEqual({ to: { x: 3, y: 0 }, dir: "right" });
    expect(landing(free(), "R1", { x: 30, y: 30 })).toBeUndefined();
    expect(landing(free(), "R9", { x: 3, y: 0 })).toBeUndefined();
  });

  it("does not turn or insert parts that do not rotate", () => {
    const amp: Part = { id: "X1", kind: "opamp", x: 30, y: 30, dir: "right", value: "" };
    // Inputs at (0, 1) and (0, -1) on the vertical wire x = 0.
    const d = drawing({ parts: [amp], wires: [w(0, -5, 0, 5)] });
    expect(landing(d, "X1", { x: 5, y: 0 })).toBeUndefined();
    expect(drop(d, "X1", { x: 5, y: 0 })).toEqual(
      move(d, { kind: "part", id: "X1", to: { x: 5, y: 0 } }),
    );
  });

  it("only re-routes a part dropped away from any wire", () => {
    const d = drawing({ parts: [r("R1", 0, 0), r("R2", 10, 0)], wires: [w(4, 0, 10, 0)] });
    const to = { x: 2, y: 6 };
    expect(drop(d, "R1", to)).toEqual(move(d, { kind: "part", id: "R1", to }));
  });

  it("slides a part along its own wire instead of cutting it", () => {
    // R1 pins at (0, 0) and (4, 0), its wire runs on to R2 at (12, 0).
    const d = drawing({ parts: [r("R1", 0, 0), r("R2", 12, 0)], wires: [w(4, 0, 12, 0)] });
    const to = { x: 5, y: 0 };
    const out = drop(d, "R1", to);
    expect(out).toEqual(move(d, { kind: "part", id: "R1", to }));
    expect(shape(out.wires)).toEqual(["9,0-12,0"]);
  });

  it("does not turn a part dropped across its own wire", () => {
    // R1 lies across the top of its own vertical wire down to R2.
    const d = drawing({ parts: [r("R1", 0, 0), r("R2", 4, 10, "down")], wires: [w(4, 0, 4, 10)] });
    const to = { x: 2, y: 5 };
    expect(landing(d, "R1", to)).toBeUndefined();
    expect(placed(drop(d, "R1", to), "R1")).toEqual({ x: 2, y: 5, dir: "right" });
  });

  it("cuts a bar under its pins even across a T, leaving the stem", () => {
    // A stem from (5, 0) down to R2 meets the bar under the dropped R1.
    const d = drawing({
      parts: [r("R1", 0, 20), r("R2", 5, 5, "down")],
      wires: [w(0, 0, 10, 0), w(5, 0, 5, 5)],
    });
    const out = drop(d, "R1", { x: 3, y: 0 });
    expect(shape(out.wires)).toEqual(["0,0-3,0", "5,0-5,5", "7,0-10,0"]);
  });

  it("brings the wires of a connected part along when it is inserted elsewhere", () => {
    const d = drawing({
      parts: [r("R1", 0, 0), r("R2", 12, 0)],
      wires: [w(4, 0, 12, 0), w(0, 10, 20, 10)],
    });
    const out = drop(d, "R1", { x: 6, y: 10 });
    expect(placed(out, "R1")).toEqual({ x: 6, y: 10, dir: "right" });
    const s = shape(out.wires);
    expect(s).toEqual(expect.arrayContaining(["0,10-6,10", "10,10-20,10"]));
    expect(s.some((v) => v.endsWith("12,0"))).toBe(true);
    expect(s).not.toContain("0,10-20,10");
  });

  it("leaves the given drawing untouched", () => {
    const d = free();
    const before = JSON.stringify(d);
    drop(d, "R1", { x: 18, y: 5 });
    expect(JSON.stringify(d)).toBe(before);
  });
});

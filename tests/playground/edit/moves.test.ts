import { describe, expect, it } from "vitest";
import { bodyCells, move } from "../../../docs/playground/edit/moves";
import { emptyDrawing } from "../../../docs/playground/model";
import type { Drawing, Part, Pt, Wire } from "../../../docs/playground/model";
import { points } from "../../../docs/playground/wires";

const w = (x1: number, y1: number, x2: number, y2: number): Wire => ({ x1, y1, x2, y2 });
const p = (x: number, y: number): Pt => ({ x, y });
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
const ends = (wires: Wire[]): string[] =>
  wires.flatMap((v) => [`${v.x1},${v.y1}`, `${v.x2},${v.y2}`]);

/** R1 and R2 on a bar from (0, 0) to (10, 0), R3 hanging from a stem at x = 4. */
const tee = (nodes: Pt[] = []): Drawing =>
  drawing({
    parts: [r("R1", -4, 0), r("R2", 10, 0), r("R3", 4, 5, "down")],
    wires: [w(0, 0, 10, 0), w(4, 0, 4, 5)],
    nodes,
  });

describe("playground moves", () => {
  it("slides the stem of a T along its bar", () => {
    const out = move(tee(), { kind: "part", id: "R3", to: p(7, 5) });
    expect(shape(out.wires)).toEqual(["0,0-7,0", "7,0-10,0", "7,0-7,5"]);
    expect(out.parts.find((q) => q.id === "R3")).toMatchObject({ x: 7, y: 5 });
  });

  it("keeps a user node in place", () => {
    const out = move(tee([p(4, 0)]), { kind: "part", id: "R3", to: p(7, 5) });
    expect(out.nodes).toEqual([p(4, 0)]);
    expect(shape(out.wires)).toContain("0,0-4,0");
    expect(shape(out.wires)).toContain("4,0-10,0");
    expect(ends(out.wires)).toContain("7,5");
  });

  it("picks the route with the fewest bends", () => {
    const d = drawing({ parts: [r("R1", -4, 0), r("R2", 5, 0)], wires: [w(0, 0, 5, 0)] });
    const out = move(d, { kind: "part", id: "R2", to: p(5, 3) });
    expect(shape(out.wires)).toEqual(["0,0-0,3", "0,3-5,3"]);
  });

  it("goes around the body of another part", () => {
    // Straight down from the ground to R3's new pin would cross R2.
    const d = drawing({
      parts: [r("R2", -2, 6), r("R3", 0, 4)],
      grounds: [p(0, 0)],
      wires: [w(0, 0, 0, 4)],
    });
    const out = move(d, { kind: "part", id: "R3", to: p(0, 8) });
    const body = bodyCells(out.parts);
    const crossed = out.wires.some((v) => points(v).some((k) => body.has(k)));
    expect(crossed).toBe(false);
    expect(ends(out.wires)).toContain("0,0");
    expect(ends(out.wires)).toContain("0,8");
  });

  it("moves a part with no wires without creating any", () => {
    const d = drawing({ parts: [r("R1", 0, 0), r("R2", 20, 20)], wires: [w(20, 20, 20, 25)] });
    const out = move(d, { kind: "part", id: "R1", to: p(3, 7) });
    expect(shape(out.wires)).toEqual(["20,20-20,25"]);
    expect(out.parts[0]).toMatchObject({ x: 3, y: 7 });
  });

  it("re-routes the pin a turned part moves", () => {
    const d = drawing({ parts: [r("R1", 0, 0)], grounds: [p(4, -3)], wires: [w(4, -3, 4, 0)] });
    const out = move(d, { kind: "part", id: "R1", to: p(0, 0), dir: "down" });
    expect(out.parts[0]?.dir).toBe("down");
    expect(out.wires.every((v) => v.x1 === v.x2 || v.y1 === v.y2)).toBe(true);
    expect(ends(out.wires)).toEqual(expect.arrayContaining(["4,-3", "0,4"]));
    expect(ends(out.wires)).not.toContain("4,0");
  });

  it("stretches the wire of a dragged ground", () => {
    const d = drawing({
      parts: [r("R1", 0, 0, "down")],
      grounds: [p(0, 6)],
      wires: [w(0, 4, 0, 6)],
    });
    const out = move(d, { kind: "ground", index: 0, to: p(0, 8) });
    expect(out.grounds).toEqual([p(0, 8)]);
    expect(shape(out.wires)).toEqual(["0,4-0,8"]);
  });

  it("moves a label and its wire", () => {
    const d = drawing({ labels: [{ x: 0, y: 0, name: "out" }], wires: [w(0, 0, 0, 3)] });
    const out = move(d, { kind: "label", index: 0, to: p(2, 0) });
    expect(out.labels).toEqual([{ x: 2, y: 0, name: "out" }]);
    expect(shape(out.wires)).toEqual(["2,0-2,3"]);
  });

  it("moves free wire ends together", () => {
    const d = drawing({ wires: [w(0, 0, 4, 0)] });
    const out = move(d, {
      kind: "ends",
      moves: [
        [p(0, 0), p(0, 2)],
        [p(4, 0), p(4, 2)],
      ],
    });
    expect(shape(out.wires)).toEqual(["0,2-4,2"]);
  });

  it("leaves the given drawing and unknown items alone", () => {
    const d = tee();
    const copy = JSON.parse(JSON.stringify(d)) as Drawing;
    move(d, { kind: "part", id: "R3", to: p(7, 5) });
    expect(d).toEqual(copy);
    expect(move(d, { kind: "part", id: "R9", to: p(1, 1) })).toBe(d);
    expect(move(d, { kind: "ground", index: 3, to: p(1, 1) })).toBe(d);
    expect(move(d, { kind: "part", id: "R3", to: p(4, 5) }).wires).toEqual(d.wires);
  });
});

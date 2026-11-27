import { describe, expect, it } from "vitest";
import { emptyDrawing, pinsOf } from "../../../docs/playground/model";
import type { Drawing, Wire } from "../../../docs/playground/model";
import {
  addGround,
  addLabel,
  clear,
  freeLabel,
  ghost,
  place,
  remove,
  renameLabel,
  rotate,
  setDirectives,
} from "../../../docs/playground/edit/operations";

const drawing = (over: Partial<Drawing> = {}): Drawing => ({ ...emptyDrawing(), ...over });
const wire = (x1: number, y1: number, x2: number, y2: number): Wire => ({ x1, y1, x2, y2 });

describe("place", () => {
  it("centres a new part on the point, with the next id and the default value", () => {
    const d = drawing({ parts: [ghost(emptyDrawing(), "resistor", { x: 0, y: 0 }, "right")] });
    const next = place(d, "resistor", { x: 10, y: 5 }, "right");
    expect(next.parts[1]).toEqual({
      id: "R2",
      kind: "resistor",
      x: 8,
      y: 5,
      dir: "right",
      value: "1k",
    });
    expect(d.parts).toHaveLength(1);
  });

  it("turns a resistor dropped on a vertical wire and cuts the wire at its pins", () => {
    const d = drawing({ wires: [wire(5, 0, 5, 10)] });
    const next = place(d, "resistor", { x: 5, y: 5 }, "right");
    expect(next.parts[0]).toMatchObject({ x: 5, y: 3, dir: "down" });
    expect(next.wires).toEqual([wire(5, 0, 5, 3), wire(5, 7, 5, 10)]);
    expect(d.wires).toEqual([wire(5, 0, 5, 10)]);
  });

  it("keeps the orientation given when it already lies along the wire", () => {
    const next = place(drawing({ wires: [wire(5, 0, 5, 10)] }), "resistor", { x: 5, y: 5 }, "up");
    expect(next.parts[0]).toMatchObject({ x: 5, y: 7, dir: "up" });
    expect(next.wires).toEqual([wire(5, 0, 5, 3), wire(5, 7, 5, 10)]);
  });

  it("leaves the wires alone off a wire, and for parts that do not turn", () => {
    const d = drawing({ wires: [wire(5, 0, 5, 10)] });
    expect(place(d, "resistor", { x: 9, y: 5 }, "right").wires).toBe(d.wires);
    const amp = place(d, "opamp", { x: 5, y: 5 }, "down");
    expect(amp.parts[0]).toMatchObject({ kind: "opamp", dir: "right", x: 7, y: 5 });
    expect(amp.wires).toBe(d.wires);
  });
});

describe("rotate", () => {
  const r = ghost(emptyDrawing(), "resistor", { x: 9, y: 5 }, "right");

  it("turns a quarter clockwise around the visual centre", () => {
    const next = rotate(drawing({ parts: [r] }), "R1");
    expect(next.parts[0]).toMatchObject({ x: 9, y: 3, dir: "down" });
    const back = [1, 2, 3, 4].reduce((d) => rotate(d, "R1"), drawing({ parts: [r] }));
    expect(back.parts[0]).toEqual(r);
  });

  it("re-routes the wires on its pins", () => {
    const d = drawing({ parts: [r], wires: [wire(3, 5, 7, 5)], grounds: [{ x: 3, y: 5 }] });
    const next = rotate(d, "R1");
    const [top] = pinsOf(next.parts[0]!);
    const ends = next.wires.flatMap((w) => [`${w.x1},${w.y1}`, `${w.x2},${w.y2}`]);
    expect(ends).toContain("3,5");
    expect(ends).toContain(`${top!.x},${top!.y}`);
  });

  it("returns the same drawing for an op-amp or an unknown id", () => {
    const d = drawing({ parts: [ghost(emptyDrawing(), "opamp", { x: 5, y: 5 }, "right")] });
    expect(rotate(d, "X1")).toBe(d);
    expect(rotate(d, "R9")).toBe(d);
  });
});

describe("remove", () => {
  const t = drawing({
    parts: [ghost(emptyDrawing(), "resistor", { x: 10, y: 5 }, "right")],
    wires: [wire(0, 0, 4, 0), wire(4, 0, 8, 0), wire(4, 0, 4, 4)],
    grounds: [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
    ],
    labels: [
      { x: 4, y: 4, name: "in" },
      { x: 0, y: 0, name: "out" },
    ],
    nodes: [{ x: 4, y: 0 }],
  });

  it("picks the wire nearest to the selection point", () => {
    const next = remove(t, { kind: "wire", at: { x: 4.2, y: 2.5 } });
    expect(next.wires).toEqual([wire(0, 0, 4, 0), wire(4, 0, 8, 0)]);
  });

  it("keeps only the user nodes still on a junction", () => {
    const one = remove(t, { kind: "wire", at: { x: 4, y: 3 } });
    expect(one.nodes).toEqual([{ x: 4, y: 0 }]);
    const two = remove(t, [
      { kind: "wire", at: { x: 4, y: 3 } },
      { kind: "wire", at: { x: 6, y: 0 } },
    ]);
    expect(two.wires).toEqual([wire(0, 0, 4, 0)]);
    expect(two.nodes).toEqual([]);
  });

  it("removes a selection of parts, grounds and labels by their original index", () => {
    const next = remove(t, [
      { kind: "part", id: "R1" },
      { kind: "ground", index: 0 },
      { kind: "label", index: 1 },
    ]);
    expect(next.parts).toEqual([]);
    expect(next.grounds).toEqual([{ x: 8, y: 0 }]);
    expect(next.labels).toEqual([{ x: 4, y: 4, name: "in" }]);
    expect(next.wires).toEqual(t.wires);
  });

  it("returns the same drawing when nothing is selected or found", () => {
    expect(remove(t, [])).toBe(t);
    expect(remove(t, { kind: "wire", at: { x: 20, y: 20 } })).toBe(t);
  });
});

describe("grounds, labels, clear and directives", () => {
  it("adds a ground once per point", () => {
    const d = addGround(emptyDrawing(), { x: 1, y: 2 });
    expect(d.grounds).toEqual([{ x: 1, y: 2 }]);
    expect(addGround(d, { x: 1, y: 2 })).toBe(d);
  });

  it("names new labels in, out, a… then the first free x<n>", () => {
    const d = addLabel(addLabel(emptyDrawing(), { x: 0, y: 0 }), { x: 1, y: 0 });
    expect(d.labels.map((l) => l.name)).toEqual(["in", "out"]);
    const names = ["in", "out", "a", "b", "c", "d", "x1"];
    expect(freeLabel(drawing({ labels: names.map((name) => ({ x: 0, y: 0, name })) }))).toBe("x2");
  });

  it("renames a label, trimmed, and refuses blank names or spaces", () => {
    const d = addLabel(emptyDrawing(), { x: 0, y: 0 });
    expect(renameLabel(d, 0, "  vout ").labels[0]?.name).toBe("vout");
    expect(renameLabel(d, 0, "v out")).toBe(d);
    expect(renameLabel(d, 0, "  ")).toBe(d);
    expect(renameLabel(d, 3, "x")).toBe(d);
  });

  it("clears everything and sets directives only when they change", () => {
    expect(clear()).toEqual(emptyDrawing());
    const d = setDirectives(emptyDrawing(), ".param R=1k");
    expect(d.directives).toBe(".param R=1k");
    expect(setDirectives(d, ".param R=1k")).toBe(d);
  });
});

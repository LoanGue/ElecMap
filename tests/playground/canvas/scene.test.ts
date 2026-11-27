import { describe, expect, it } from "vitest";
import { scene } from "../../../docs/playground/canvas/scene";
import type { SceneOptions } from "../../../docs/playground/canvas/scene";
import { CELL, SpriteCache } from "../../../docs/playground/canvas/sprites";
import { emptyDrawing } from "../../../docs/playground/model";
import type { Drawing, Part } from "../../../docs/playground/model";

const R1: Part = { id: "R1", kind: "resistor", x: 0, y: 0, dir: "right", value: "1k" };

/** R1 from (0,0) to (4,0), a wire on to (8,0) with a T at (6,0) and a bend node at (8,0). */
const small = (): Drawing => ({
  ...emptyDrawing(),
  parts: [R1],
  wires: [
    { x1: 4, y1: 0, x2: 8, y2: 0 },
    { x1: 6, y1: 0, x2: 6, y2: 4 },
    { x1: 8, y1: 0, x2: 8, y2: 4 },
  ],
  grounds: [{ x: 8, y: 4 }],
  labels: [{ x: 6, y: 4, name: "out" }],
  nodes: [
    { x: 8, y: 0 },
    { x: 20, y: 20 },
  ],
});

const pt = (x: number, y: number) => ({ x, y });

const opts = (more: Partial<SceneOptions> = {}): SceneOptions => ({
  style: "iec",
  sprites: new SpriteCache(),
  ...more,
});

describe("canvas scene", () => {
  it("gives the items of a small drawing in world pixels", () => {
    const s = scene(small(), opts());
    expect(s.wires).toEqual([
      { x1: 80, y1: 0, x2: 160, y2: 0, hl: false },
      { x1: 120, y1: 0, x2: 120, y2: 80, hl: false },
      { x1: 160, y1: 0, x2: 160, y2: 80, hl: false },
    ]);
    expect(s.grounds).toEqual([{ index: 0, x: 160, y: 80, hl: false }]);
    expect(s.labels).toEqual([{ index: 0, x: 120, y: 80, hl: false }]);
    expect(s.symbols.map((q) => [q.id, q.key.kind, q.key.orientation])).toEqual([
      ["R1", "resistor", "right"],
    ]);
    expect(s.outlines).toEqual([]);
    expect(s.ghost).toBeUndefined();
    expect(s.preview).toBeUndefined();
  });

  it("translates a symbol so the sprite anchor lands on the part", () => {
    const sprites = new SpriteCache();
    const p: Part = { ...R1, x: 3, y: 5 };
    const [sym] = scene({ ...emptyDrawing(), parts: [p] }, opts({ sprites })).symbols;
    const { anchor } = sprites.get(sym!.key);
    expect(sym!.translate).toEqual({ x: 3 * CELL - anchor.x, y: 5 * CELL - anchor.y });
  });

  it("puts dots where three arms meet and on live user nodes only", () => {
    expect(scene(small(), opts()).dots).toEqual([
      { x: 120, y: 0, user: false, hl: false },
      { x: 160, y: 0, user: true, hl: false },
    ]);
  });

  it("puts no dot on a bend, a straight joint or a crossing", () => {
    const d: Drawing = {
      ...emptyDrawing(),
      wires: [
        { x1: 0, y1: 0, x2: 4, y2: 0 },
        { x1: 4, y1: 0, x2: 4, y2: 4 },
        { x1: 4, y1: 4, x2: 8, y2: 4 },
        { x1: 6, y1: 2, x2: 6, y2: 6 },
      ],
    };
    expect(scene(d, opts()).dots).toEqual([]);
  });

  it("counts a pin as an arm: two wires leaving a pin make a dot", () => {
    const d: Drawing = {
      ...emptyDrawing(),
      parts: [R1],
      wires: [
        { x1: 4, y1: 0, x2: 8, y2: 0 },
        { x1: 4, y1: 0, x2: 4, y2: 4 },
      ],
    };
    expect(scene(d, opts()).dots).toEqual([{ x: 80, y: 0, user: false, hl: false }]);
  });

  it("marks exactly the pins touching nothing", () => {
    const R2: Part = { ...R1, id: "R2", x: 0, y: 2, dir: "down" };
    const R3: Part = { ...R1, id: "R3", x: 10, y: 0 };
    const R4: Part = { ...R1, id: "R4", x: 20, y: 0 };
    const d: Drawing = {
      ...emptyDrawing(),
      parts: [R1, R2, R3, R4],
      // A wire through R2's lower pin (0,6), mid-wire.
      wires: [{ x1: -2, y1: 6, x2: 2, y2: 6 }],
      // A ground on R1's right pin, a label on R3's left pin.
      grounds: [{ x: 4, y: 0 }],
      labels: [{ x: 10, y: 0, name: "a" }],
    };
    // R3 keeps its right pin free, R4 both.
    const free = scene(d, opts()).freePins.map((q) => `${q.part}:${q.pin}`);
    expect(free).toEqual(["R1:0", "R2:0", "R3:1", "R4:0", "R4:1"]);
  });

  it("does not mark two pins touching each other", () => {
    const R2: Part = { ...R1, id: "R2", x: 4, y: 0 };
    const free = scene({ ...emptyDrawing(), parts: [R1, R2] }, opts()).freePins;
    expect(free.map((q) => `${q.part}:${q.pin}`)).toEqual(["R1:0", "R2:1"]);
    expect(free[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("flags the highlighted nodes and parts", () => {
    const d = small();
    d.wires.push({ x1: 0, y1: 0, x2: 0, y2: -4 });
    const s = scene(d, opts({ highlight: { nodes: new Set(["0"]), parts: new Set(["R1"]) } }));
    // Everything right of R1 is on the ground net; the wire on R1's left pin is not.
    expect(s.wires.map((w) => w.hl)).toEqual([true, true, true, false]);
    expect(s.dots.every((q) => q.hl)).toBe(true);
    expect(s.grounds[0]?.hl).toBe(true);
    expect(s.labels[0]?.hl).toBe(true);
    expect(s.symbols[0]?.hl).toBe(true);
    expect(scene(d, opts()).symbols[0]?.hl).toBe(false);
  });

  it("outlines the selected part, wire, ground and label, and nothing for a stale selection", () => {
    const d = small();
    const of = (selection: SceneOptions["selection"]) =>
      scene(d, opts(selection ? { selection } : {})).outlines;
    expect(of({ kind: "part", id: "R1" })).toEqual([
      { kind: "rect", x: -22, y: -22, width: 124, height: 44 },
    ]);
    expect(of({ kind: "wire", at: { x: 7, y: 0 } })).toEqual([
      { kind: "wire", x1: 80, y1: 0, x2: 160, y2: 0 },
    ]);
    expect(of({ kind: "ground", index: 0 })).toEqual([
      { kind: "rect", x: 144, y: 74, width: 32, height: 38 },
    ]);
    expect(of({ kind: "label", index: 0 })).toEqual([
      { kind: "rect", x: 112, y: 72, width: 16, height: 16 },
    ]);
    expect(of({ kind: "part", id: "R9" })).toEqual([]);
    expect(of({ kind: "wire", at: { x: 30, y: 30 } })).toEqual([]);
    expect(of({ kind: "label", index: 4 })).toEqual([]);
  });

  it("gives the ghost part and the wire preview", () => {
    const sprites = new SpriteCache();
    const C: Part = { id: "", kind: "capacitor", x: 10, y: 10, dir: "down", value: "" };
    const s = scene(
      emptyDrawing(),
      opts({
        sprites,
        ghost: { kind: "part", part: C },
        preview: [pt(0, 0), pt(0, 0), pt(0, -3), pt(5, -3)],
      }),
    );
    const key = { kind: "capacitor", orientation: "down", style: "iec", variant: "" } as const;
    const { anchor } = sprites.get(key);
    expect(s.ghost).toEqual({
      kind: "part",
      key,
      translate: { x: 200 - anchor.x, y: 200 - anchor.y },
    });
    expect(s.preview?.map((q) => [q.x, q.y])).toEqual([
      [0, 0],
      [0, -60],
      [100, -60],
    ]);
    const g = scene(emptyDrawing(), opts({ ghost: { kind: "ground", at: { x: 2, y: 3 } } }));
    expect(g.ghost).toEqual({ kind: "ground", x: 40, y: 60 });
  });
});

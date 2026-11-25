import { describe, expect, it } from "vitest";
import {
  centerOffset,
  distance,
  emptyDrawing,
  onSegment,
  PALETTE,
  PREFIX,
  pinsOf,
  rotatable,
} from "../../docs/playground/model";
import type { Part } from "../../docs/playground/model";

const part = (kind: Part["kind"], dir: Part["dir"] = "right"): Part => ({
  id: "X1",
  kind,
  x: 10,
  y: 10,
  dir,
  value: "",
});

describe("playground drawing model", () => {
  it("starts empty", () => {
    expect(emptyDrawing()).toEqual({
      parts: [],
      wires: [],
      grounds: [],
      labels: [],
      directives: "",
    });
  });

  it("puts the second pin of a two-terminal part four steps along its direction", () => {
    expect(pinsOf(part("resistor", "right"))).toEqual([
      { x: 10, y: 10 },
      { x: 14, y: 10 },
    ]);
    expect(pinsOf(part("resistor", "down"))).toEqual([
      { x: 10, y: 10 },
      { x: 10, y: 14 },
    ]);
    expect(pinsOf(part("capacitor", "left"))).toEqual([
      { x: 10, y: 10 },
      { x: 6, y: 10 },
    ]);
    expect(pinsOf(part("vsource", "up"))).toEqual([
      { x: 10, y: 10 },
      { x: 10, y: 6 },
    ]);
  });

  it("orders op-amp and transistor pins as the netlist expects", () => {
    expect(pinsOf(part("opamp"))).toEqual([
      { x: 5, y: 11 },
      { x: 5, y: 9 },
      { x: 10, y: 10 },
    ]);
    // npn: collector (top), base, emitter (bottom); pnp: emitter at the bottom pin first.
    expect(pinsOf(part("npn"))).toEqual([
      { x: 10, y: 10 },
      { x: 7, y: 13 },
      { x: 10, y: 16 },
    ]);
    expect(pinsOf(part("pnp"))).toEqual([
      { x: 10, y: 16 },
      { x: 7, y: 13 },
      { x: 10, y: 10 },
    ]);
  });

  it("finds the visual centre, and only two-terminal parts rotate", () => {
    expect(centerOffset("resistor", "down")).toEqual({ x: 0, y: 2 });
    expect(centerOffset("opamp", "right")).toEqual({ x: -2, y: 0 });
    expect(rotatable("diode")).toBe(true);
    expect(rotatable("nmos")).toBe(false);
  });

  it("knows a prefix for every palette entry", () => {
    for (const kind of PALETTE) expect(PREFIX[kind]).toMatch(/^[A-Z]$/);
  });

  it("measures points against wires", () => {
    const w = { x1: 0, y1: 0, x2: 4, y2: 0 };
    expect(onSegment({ x: 2, y: 0 }, w)).toBe(true);
    expect(onSegment({ x: 5, y: 0 }, w)).toBe(false);
    expect(distance({ x: 2, y: 3 }, w)).toBe(3);
    expect(distance({ x: 7, y: 4 }, w)).toBe(5);
  });
});

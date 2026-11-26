import { describe, expect, it } from "vitest";
import {
  centerOffset,
  cleanName,
  distance,
  emptyDrawing,
  normalizeDrawing,
  onSegment,
  PALETTE,
  PREFIX,
  pinsOf,
  rotatable,
} from "../../docs/playground/model";
import type { Drawing, Part, Selection } from "../../docs/playground/model";

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
      nodes: [],
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

  it("upgrades an old drawing without user nodes or names", () => {
    // Shape of a share link or saved drawing written before `nodes` and `name`.
    const old = JSON.parse(
      '{"parts":[{"id":"R1","kind":"resistor","x":2,"y":2,"dir":"right","value":"1k"}],' +
        '"wires":[{"x1":6,"y1":2,"x2":8,"y2":2}],"grounds":[{"x":8,"y":2}],"labels":[],"directives":".param a=1"}',
    ) as unknown;
    const d = normalizeDrawing(old);
    expect(d.nodes).toEqual([]);
    expect(d.parts).toEqual([
      { id: "R1", kind: "resistor", x: 2, y: 2, dir: "right", value: "1k" },
    ]);
    expect(d.directives).toBe(".param a=1");
    expect(normalizeDrawing(null)).toEqual(emptyDrawing());
    expect(normalizeDrawing({ wires: "bad" }).wires).toEqual([]);
  });

  it("keeps names and user nodes through a JSON round trip", () => {
    const d: Drawing = {
      ...emptyDrawing(),
      parts: [{ ...part("resistor"), id: "R1", name: "R_load" }, part("capacitor")],
      nodes: [{ x: 4, y: 6 }],
    };
    expect(normalizeDrawing(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it("drops empty or non-string names instead of storing undefined", () => {
    const raw = {
      parts: [
        { ...part("resistor"), name: "" },
        { ...part("diode"), name: 3 },
      ],
    };
    for (const p of normalizeDrawing(raw).parts) expect(Object.keys(p)).not.toContain("name");
    // @ts-expect-error exactOptionalPropertyTypes: an absent name is not `undefined`.
    const bad: Part = { ...part("resistor"), name: undefined };
    expect(bad.name).toBeUndefined();
  });

  it("trims names and drops blank ones, like a rename", () => {
    const raw = {
      parts: [
        { ...part("resistor"), name: "  " },
        { ...part("capacitor"), name: " R_load " },
      ],
    };
    const [blank, padded] = normalizeDrawing(raw).parts;
    expect(Object.keys(blank ?? {})).not.toContain("name");
    expect(padded?.name).toBe("R_load");
    expect(cleanName("\t")).toBeUndefined();
    expect(cleanName(" Cin ")).toBe("Cin");
  });

  it("selects a wire by a point on it, not by its index", () => {
    const sel: Selection = { kind: "wire", at: { x: 2, y: 0 } };
    const w = { x1: 0, y1: 0, x2: 4, y2: 0 };
    expect(sel.kind === "wire" && onSegment(sel.at, w)).toBe(true);
  });
});

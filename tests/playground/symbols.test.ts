import { describe, expect, it } from "vitest";
import type { ComponentJSON, PlacedComponent } from "../../src";
import { icon, placed, stub, typeOf } from "../../docs/playground/symbols";
import { PALETTE } from "../../docs/playground/model";
import type { Kind, Part } from "../../docs/playground/model";

const part = (kind: Kind, dir: Part["dir"] = "right", value = ""): Part => ({
  id: "X1",
  kind,
  x: 10,
  y: 10,
  dir,
  value,
});

const NODES = ["a", "b", "c"];
const TWO: Kind[] = [
  "resistor",
  "capacitor",
  "inductor",
  "vsource",
  "isource",
  "diode",
  "switch",
  "bsource",
  "vcvs",
  "vccs",
  "cccs",
  "ccvs",
];

const pinsAt = (c: PlacedComponent) => c.pins.map((q) => [q.x, q.y, q.node]);

describe("typeOf", () => {
  it("maps transistor kinds to the engine families", () => {
    expect(typeOf("npn")).toBe("bjt");
    expect(typeOf("pnp")).toBe("bjt");
    expect(typeOf("nmos")).toBe("mosfet");
    expect(typeOf("pmos")).toBe("mosfet");
    expect(typeOf("resistor")).toBe("resistor");
  });
});

describe("stub", () => {
  it("fills the fields the renderer reads", () => {
    expect(stub(part("npn"), ["a", "b", "c"])).toMatchObject({ type: "bjt", polarity: "npn" });
    expect(stub(part("vsource"), ["a", "b"])).toMatchObject({ dc: 1 });
    expect(stub(part("switch", "right", "OFF"), ["a", "b"])).toMatchObject({ closed: false });
    expect(stub(part("bsource", "right", "I=1m"), ["a", "b"])).toMatchObject({ kind: "current" });
    expect(stub(part("nmos"), ["d", "g", "s"])).toMatchObject({ nodes: ["d", "g", "s", "s"] });
  });
});

describe("placed", () => {
  it.each(TWO)("%s: two pins, label in the middle", (kind) => {
    const c = placed(part(kind), NODES, undefined);
    expect(c.orientation).toBe("right");
    expect(pinsAt(c)).toEqual([
      [10, 10, "a"],
      [14, 10, "b"],
    ]);
    expect(c.labelAt).toEqual({ x: 12, y: 10, align: "middle" });
  });

  it("puts the label beside a vertical two-terminal part", () => {
    const c = placed(part("resistor", "down"), NODES, undefined);
    expect(c.orientation).toBe("down");
    expect(c.labelAt).toEqual({ x: 11.6, y: 12, align: "start" });
  });

  it("opamp: inputs on the left, output at the anchor", () => {
    const c = placed(part("opamp"), NODES, undefined);
    expect(c.orientation).toBe("right");
    expect(pinsAt(c)).toEqual([
      [5, 11, "a"],
      [5, 9, "b"],
      [10, 10, "c"],
    ]);
    expect(c.labelAt).toEqual({ x: 7.8, y: 12.6, align: "start" });
  });

  it.each([
    ["npn", "bjt", 11.9],
    ["pnp", "bjt", 11.9],
    ["nmos", "mosfet", 11.4],
    ["pmos", "mosfet", 11.4],
  ] as const)("%s: three pins, label on the right", (kind, type, x) => {
    const c = placed(part(kind), NODES, undefined);
    expect(c.type).toBe(type);
    expect(c.orientation).toBe("down");
    const top: [number, number] = [10, 10];
    const bottom: [number, number] = [10, 16];
    const [first, last] = kind === "npn" || kind === "nmos" ? [top, bottom] : [bottom, top];
    expect(pinsAt(c)).toEqual([
      [...first, "a"],
      [7, 13, "b"],
      [...last, "c"],
    ]);
    expect(c.labelAt).toEqual({ x, y: 13, align: "start" });
  });

  it("shows the formatted value of a compiled component", () => {
    const info: ComponentJSON = { id: "R1", type: "resistor", nodes: ["a", "b"], value: 1000 };
    expect(placed(part("resistor", "right", "1k"), NODES, info).label.value).toBe("1 kΩ");
  });
});

describe("icon", () => {
  it.each(PALETTE)("%s gives an SVG in both styles", (kind) => {
    for (const style of ["iec", "ansi"] as const) {
      const svg = icon(kind, style);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
    }
  });
});

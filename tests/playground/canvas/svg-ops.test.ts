import { describe, expect, it } from "vitest";
import { renderSvg } from "../../../src";
import type { ComponentJSON, Orientation, PlacedComponent } from "../../../src";
import { multiply, parseTransform, svgOps } from "../../../docs/playground/canvas/svg-ops";
import type { DrawOp, Matrix } from "../../../docs/playground/canvas/svg-ops";

/** SVG of a single part, the way the palette and the sprites render it. */
function symbol(
  comp: Record<string, unknown>,
  pins: [number, number][],
  orientation: Orientation = "right",
  style: "iec" | "ansi" = "iec",
): string {
  const component = {
    id: "X1",
    nodes: ["a", "b", "c"],
    value: 0,
    ...comp,
  } as unknown as ComponentJSON;
  const placed: PlacedComponent = {
    id: "X1",
    type: component.type,
    component,
    orientation,
    pins: pins.map(([x, y]) => ({ x, y, node: "a", ground: false })),
    label: { id: "X1", value: "1k" },
    labelAt: { x: 2, y: 0, align: "middle" },
  };
  const bounds = { minX: 0, minY: -2, maxX: 4, maxY: 2 };
  const layout = { components: [placed], nets: [], grounds: [], couplings: [], bounds };
  return renderSvg(layout, { theme: "auto", style, title: "<x>" });
}

const kinds = (ops: DrawOp[]) => ops.map((o) => o.op);
const at = (e: number, f: number): Matrix => [1, 0, 0, 1, e, f];

describe("playground canvas svg ops", () => {
  const horizontal: [number, number][] = [
    [0, 0],
    [4, 0],
  ];

  it("reads a resistor as a path and a rect under the group transform", () => {
    const ops = svgOps(symbol({ type: "resistor" }, horizontal));
    expect(ops).toEqual([
      {
        op: "path",
        d: "M0 0H22M58 0H80",
        transform: at(20, 60),
        stroke: "fg",
        fill: null,
        dashed: false,
      },
      {
        op: "rect",
        x: 22,
        y: -7,
        width: 36,
        height: 14,
        transform: at(20, 60),
        stroke: "fg",
        fill: null,
        dashed: false,
      },
    ]);
  });

  it.each([
    ["right", [1, 0, 0, 1, 20, 60]],
    ["down", [0, 1, -1, 0, 20, 60]],
    ["left", [-1, 0, 0, -1, 20, 60]],
    ["up", [0, -1, 1, 0, 20, 60]],
  ] as const)("flattens the %s orientation into an exact matrix", (dir, matrix) => {
    const ops = svgOps(symbol({ type: "capacitor" }, horizontal, dir));
    expect(ops).toHaveLength(1);
    expect(ops[0]?.transform).toEqual(matrix);
  });

  it.each([
    ["resistor", {}, "iec", ["path", "rect"]],
    ["resistor", {}, "ansi", ["path"]],
    ["capacitor", {}, "iec", ["path"]],
    ["inductor", {}, "iec", ["path"]],
    ["vsource", { dc: 1 }, "iec", ["path", "circle", "path"]],
    ["vsource", { ac: { magnitude: 1 } }, "ansi", ["path", "circle", "path", "path"]],
    ["isource", { dc: 1 }, "iec", ["path", "circle"]],
    ["vcvs", {}, "iec", ["path", "path"]],
    ["vccs", {}, "iec", ["path"]],
    ["switch", { closed: false }, "iec", ["path", "circle", "circle"]],
    ["diode", {}, "iec", ["path", "path"]],
  ] as const)("reads a %s (%o, %s) into %o", (type, extra, style, expected) => {
    const ops = svgOps(symbol({ type, ...extra }, horizontal, "right", style));
    expect(kinds(ops)).toEqual(expected);
  });

  it("fills the diode triangle and strokes its outline", () => {
    const [, triangle] = svgOps(symbol({ type: "diode" }, horizontal));
    expect(triangle).toMatchObject({ op: "path", d: "M30 -10L50 0L30 10Z" });
    expect(triangle).toMatchObject({ stroke: "fg", fill: "fg" });
  });

  it("keeps the polarity mark outside the group, untransformed", () => {
    const ops = svgOps(symbol({ type: "vsource", dc: 1 }, horizontal));
    expect(ops[2]).toMatchObject({ op: "path", transform: at(0, 0), stroke: "fg" });
  });

  it("reads an op-amp drawn in page coordinates", () => {
    const pins: [number, number][] = [
      [0, -1],
      [0, 1],
      [5, 0],
    ];
    const ops = svgOps(symbol({ type: "opamp" }, pins));
    expect(kinds(ops)).toEqual(["path"]);
    expect(ops[0]?.transform).toEqual(at(0, 0));
  });

  it.each([
    ["bjt", "npn", ["path", "circle", "path"]],
    ["bjt", "pnp", ["path", "circle", "path"]],
    ["mosfet", "nmos", ["path", "path"]],
    ["mosfet", "pmos", ["path", "path"]],
  ] as const)("reads a %s %s with a filled arrow head", (type, polarity, expected) => {
    const pins: [number, number][] = [
      [3, -3],
      [0, 0],
      [3, 3],
    ];
    const ops = svgOps(symbol({ type, polarity }, pins, "down"));
    expect(kinds(ops)).toEqual(expected);
    expect(ops[ops.length - 1]).toMatchObject({ stroke: null, fill: "fg" });
  });

  it("ignores text, title, style and the background", () => {
    const svg = symbol({ type: "capacitor" }, horizontal);
    expect(svg).toContain("<text");
    const withBg = svg.replace("</style>", '</style><rect class="bg" width="100%" height="100%"/>');
    expect(svgOps(withBg)).toEqual(svgOps(svg));
    expect(svgOps(svg)).toHaveLength(1);
  });

  it("composes nested groups and reads wire, junction and dash classes", () => {
    const svg =
      '<svg><g transform="translate(10 0)"><g transform="scale(2)">' +
      '<path class="w hl" d="M0 0H1"/><circle class="j" cx="1" cy="1" r="0.5"/></g>' +
      '<path class="s k" d="M0 0V1"/></g><path d="M9 9"/></svg>';
    expect(svgOps(svg)).toEqual([
      {
        op: "path",
        d: "M0 0H1",
        transform: [2, 0, 0, 2, 10, 0],
        stroke: "wire",
        fill: null,
        dashed: false,
      },
      {
        op: "circle",
        cx: 1,
        cy: 1,
        r: 0.5,
        transform: [2, 0, 0, 2, 10, 0],
        stroke: null,
        fill: "wire",
        dashed: false,
      },
      { op: "path", d: "M0 0V1", transform: at(10, 0), stroke: "fg", fill: null, dashed: true },
    ]);
  });

  it("parses rotate about a centre and matrix()", () => {
    expect(parseTransform("rotate(90 1 1)")).toEqual([0, 1, -1, 0, 2, 0]);
    expect(parseTransform("matrix(1,2,3,4,5,6)")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parseTransform("translate(3) scale(2 4)")).toEqual(
      multiply(at(3, 0), [2, 0, 0, 4, 0, 0]),
    );
  });
});

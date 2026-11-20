import { describe, expect, it } from "vitest";
import { connect, fromCircuit, toNetlist } from "../../docs/playground/editor";
import type { Drawing } from "../../docs/playground/editor";
import { EXAMPLES } from "../../docs/playground/examples";
import { ElecMap } from "../../src";

describe("playground block editor", () => {
  it.each(EXAMPLES.map((e) => [e.id, e.netlist] as const))(
    "%s survives netlist → drawing → netlist",
    (_id, netlist) => {
      const a = new ElecMap(netlist);
      const b = new ElecMap(toNetlist(fromCircuit(a)));
      expect(
        b
          .components()
          .map((c) => c.id)
          .sort(),
      ).toEqual(
        a
          .components()
          .map((c) => c.id)
          .sort(),
      );
      const opA = a.operatingPoint();
      const opB = b.operatingPoint();
      for (const n of a.nodes()) expect(opB.voltage(n)).toBeCloseTo(opA.voltage(n), 9);
    },
  );

  // V1 on the left, R1 on top, C1 on the right, ground on the bottom wire.
  const rc: Drawing = {
    parts: [
      { id: "V1", kind: "vsource", x: 2, y: 4, dir: "down", value: "AC 1" },
      { id: "R1", kind: "resistor", x: 2, y: 2, dir: "right", value: "1k" },
      { id: "C1", kind: "capacitor", x: 8, y: 4, dir: "down", value: "1u" },
    ],
    wires: [
      { x1: 2, y1: 2, x2: 2, y2: 4 },
      { x1: 6, y1: 2, x2: 8, y2: 2 },
      { x1: 8, y1: 2, x2: 8, y2: 4 },
      { x1: 2, y1: 8, x2: 8, y2: 8 },
    ],
    grounds: [{ x: 5, y: 8 }],
    labels: [{ x: 8, y: 2, name: "out" }],
    directives: "",
  };

  it("names nodes from grounds, labels and position", () => {
    expect(toNetlist(rc)).toBe(
      "* Drawn in the ElecMap playground\nV1 n1 0 AC 1\nR1 n1 out 1k\nC1 out 0 1u\n",
    );
    const h = new ElecMap(toNetlist(rc)).transferFunction({ input: "V1", output: "out" });
    expect(h.cutoffFrequency()).toBeCloseTo(1 / (2 * Math.PI * 1e-3), 3);
  });

  it("connects a wire end in the middle of another wire, not two crossing wires", () => {
    const t = connect({
      ...rc,
      wires: [
        { x1: 0, y1: 0, x2: 4, y2: 0 },
        { x1: 2, y1: 0, x2: 2, y2: 3 },
        { x1: 0, y1: 1, x2: 4, y2: 1 },
      ],
      parts: [],
      grounds: [],
      labels: [],
    });
    expect(t.wireNode[0]).toBe(t.wireNode[1]);
    expect(t.wireNode[2]).not.toBe(t.wireNode[0]);
    expect(t.degree.get("2,0")).toBe(3);
  });

  it("joins labels with the same name", () => {
    const t = connect({
      parts: [],
      wires: [
        { x1: 0, y1: 0, x2: 2, y2: 0 },
        { x1: 0, y1: 5, x2: 2, y2: 5 },
      ],
      grounds: [],
      labels: [
        { x: 0, y: 0, name: "a" },
        { x: 2, y: 5, name: "a" },
      ],
      directives: "",
    });
    expect(t.wireNode).toEqual(["a", "a"]);
  });
});

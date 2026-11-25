import { describe, expect, it } from "vitest";
import { reroute, simplify } from "../../docs/playground/routing";
import type { Pt, Wire } from "../../docs/playground/routing";

const w = (x1: number, y1: number, x2: number, y2: number): Wire => ({ x1, y1, x2, y2 });
const p = (x: number, y: number): Pt => ({ x, y });

/** Wires as sorted strings, whatever their direction. */
function shape(wires: Wire[]): string[] {
  return wires
    .map((v) => {
      const first = v.x1 < v.x2 || (v.x1 === v.x2 && v.y1 <= v.y2);
      const [a, b] = first
        ? [
            [v.x1, v.y1],
            [v.x2, v.y2],
          ]
        : [
            [v.x2, v.y2],
            [v.x1, v.y1],
          ];
      return `${a.join(",")}-${b.join(",")}`;
    })
    .sort();
}

const none = new Set<string>();

describe("playground wire routing", () => {
  it("merges wires in line at a free point, not at an anchor", () => {
    const wires = [w(0, 0, 2, 0), w(2, 0, 5, 0)];
    expect(shape(simplify(wires, []))).toEqual(["0,0-5,0"]);
    expect(shape(simplify(wires, [p(2, 0)]))).toEqual(["0,0-2,0", "2,0-5,0"]);
  });

  it("merges overlaps, drops empty wires and keeps bends and T joints", () => {
    const wires = [w(0, 0, 4, 0), w(2, 0, 6, 0), w(3, 3, 3, 3), w(6, 0, 6, 2), w(1, 0, 1, -2)];
    expect(shape(simplify(wires, []))).toEqual(["0,0-1,0", "1,-2-1,0", "1,0-6,0", "6,0-6,2"]);
  });

  it("keeps crossing wires apart", () => {
    const wires = [w(0, 0, 4, 0), w(2, -2, 2, 2)];
    expect(shape(simplify(wires, []))).toEqual(["0,0-4,0", "2,-2-2,2"]);
  });

  it("stretches a wire in line instead of adding bends", () => {
    const out = reroute([w(-5, 0, 0, 0)], [[p(0, 0), p(2, 0)]], {
      anchors: [p(-5, 0)],
      blocked: none,
    });
    expect(shape(out)).toEqual(["-5,0-2,0"]);
  });

  it("turns a bent chain into a straight wire when the pins line up", () => {
    const chain = [w(0, 0, 3, 0), w(3, 0, 3, 2), w(3, 2, 6, 2)];
    const out = reroute(chain, [[p(6, 2), p(6, 0)]], { anchors: [p(0, 0)], blocked: none });
    expect(shape(out)).toEqual(["0,0-6,0"]);
  });

  it("uses one bend and reaches the pin the way the wire did", () => {
    const out = reroute([w(-5, 0, 0, 0)], [[p(0, 0), p(0, 3)]], {
      anchors: [p(-5, 0)],
      blocked: none,
    });
    expect(shape(out)).toEqual(["-5,0--5,3", "-5,3-0,3"]);
  });

  it("goes around the pins of other nets", () => {
    const out = reroute([w(0, 0, 0, 5)], [[p(0, 5), p(5, 5)]], {
      anchors: [p(0, 0), p(2, 5)],
      blocked: none,
    });
    expect(shape(out)).toEqual(["0,0-5,0", "5,0-5,5"]);
  });

  it("goes around part bodies", () => {
    const out = reroute([w(0, 0, 0, 5)], [[p(0, 5), p(5, 5)]], {
      anchors: [p(0, 0)],
      blocked: new Set(["0,3"]),
    });
    expect(shape(out)).toEqual(["0,0-5,0", "5,0-5,5"]);
  });

  it("slides the stem of a T along its bar", () => {
    const wires = [w(0, 0, 10, 0), w(4, 0, 4, 5)];
    const out = reroute(wires, [[p(4, 5), p(7, 5)]], {
      anchors: [p(0, 0), p(10, 0)],
      blocked: none,
    });
    expect(shape(out)).toEqual(["0,0-7,0", "7,0-10,0", "7,0-7,5"]);
  });

  it("keeps a node made by the user in place", () => {
    const wires = [w(0, 0, 10, 0), w(4, 0, 4, 5)];
    const out = reroute(wires, [[p(4, 5), p(7, 5)]], {
      anchors: [p(0, 0), p(10, 0), p(4, 0)],
      blocked: none,
    });
    expect(shape(out)).toContain("0,0-4,0");
    expect(shape(out)).toContain("4,0-10,0");
    expect(shape(out).some((s) => s.includes("4,0-4,"))).toBe(true);
  });

  it("moves a wire that ends nowhere along with its pin", () => {
    const out = reroute([w(0, 0, 0, -3)], [[p(0, 0), p(2, 0)]], { anchors: [], blocked: none });
    expect(shape(out)).toEqual(["2,-3-2,0"]);
  });

  it("moves a wire between two moved pins as a whole", () => {
    const out = reroute(
      [w(0, 0, 0, 2), w(0, 2, 4, 2), w(4, 2, 4, 0)],
      [
        [p(0, 0), p(1, 1)],
        [p(4, 0), p(5, 1)],
      ],
      { anchors: [], blocked: none },
    );
    expect(shape(out)).toEqual(["1,1-1,3", "1,3-5,3", "5,1-5,3"]);
  });

  it("keeps a pin that sat on a ground connected to it", () => {
    const out = reroute([], [[p(0, 4), p(3, 4)]], { anchors: [p(0, 4)], blocked: none });
    expect(shape(out)).toEqual(["0,4-3,4"]);
  });
});

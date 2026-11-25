import { describe, expect, it } from "vitest";
import { looseEnds, prune, simplify, steps } from "../../docs/playground/wires";
import type { Pt, Wire } from "../../docs/playground/wires";

const w = (x1: number, y1: number, x2: number, y2: number): Wire => ({ x1, y1, x2, y2 });
const p = (x: number, y: number): Pt => ({ x, y });

/** Wires as sorted strings, whatever their direction. */
function shape(wires: Wire[]): string[] {
  return wires
    .map((v) => {
      const swap = v.x1 > v.x2 || (v.x1 === v.x2 && v.y1 > v.y2);
      return swap ? `${v.x2},${v.y2}-${v.x1},${v.y1}` : `${v.x1},${v.y1}-${v.x2},${v.y2}`;
    })
    .sort();
}

describe("playground wires", () => {
  it("lists the unit steps a wire covers", () => {
    expect(steps(w(3, 1, 0, 1))).toEqual(["0,1,h", "1,1,h", "2,1,h"]);
    expect(steps(w(2, 0, 2, 2))).toEqual(["2,0,v", "2,1,v"]);
  });

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

  it("finds the ends that touch nothing", () => {
    const wires = [w(0, 0, 4, 0), w(4, 0, 4, 3)];
    expect([...looseEnds(wires, [p(0, 0)])]).toEqual(["4,3"]);
    expect([...looseEnds(wires, [p(0, 0), p(4, 3)])]).toEqual([]);
  });

  it("prunes the wires left hanging, except the ends it is told to keep", () => {
    const wires = [w(0, 0, 4, 0), w(4, 0, 4, 3), w(4, 3, 6, 3)];
    expect(prune(wires, [p(0, 0)], new Set())).toEqual([]);
    expect(shape(prune(wires, [p(0, 0)], new Set(["6,3"])))).toEqual([
      "0,0-4,0",
      "4,0-4,3",
      "4,3-6,3",
    ]);
  });
});

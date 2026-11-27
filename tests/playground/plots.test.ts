import { describe, expect, it } from "vitest";
import {
  axisFraction,
  axisValue,
  figure,
  nearestIndex,
  plotRegistry,
} from "../../docs/playground/plots";

const LOG = { min: 1, max: 1000, log: true };
const LIN = { min: 0, max: 10, log: false };

describe("playground plots", () => {
  it("maps a cursor fraction to a value and back on both axes", () => {
    expect(axisValue(LIN, 0.25)).toBe(2.5);
    expect(axisValue(LOG, 0.5)).toBeCloseTo(Math.sqrt(1000));
    expect(axisFraction(LIN, 2.5)).toBe(0.25);
    expect(axisFraction(LOG, 100)).toBeCloseTo(2 / 3);
  });

  it("offsets both axes by their minimum", () => {
    const lin = { min: 2, max: 12, log: false };
    const log = { min: 10, max: 10000, log: true };
    expect(axisValue(lin, 0.25)).toBe(4.5);
    expect(axisFraction(lin, 4.5)).toBe(0.25);
    expect(axisValue(log, 1 / 3)).toBeCloseTo(100);
    expect(axisFraction(log, 1000)).toBeCloseTo(2 / 3);
  });

  it("finds the nearest sample on a linear axis", () => {
    const xs = [0, 2, 4, 6, 8, 10];
    expect(nearestIndex(LIN, xs, 0.29)).toBe(1);
    expect(nearestIndex(LIN, xs, 0.31)).toBe(2);
    expect(nearestIndex(LIN, [0, 2, 4], 0.3)).toBe(2);
    expect(nearestIndex(LIN, xs, -1)).toBe(0);
    expect(nearestIndex(LIN, xs, 2)).toBe(5);
    expect(nearestIndex(LIN, [], 0.5)).toBe(0);
  });

  it("finds the nearest sample on a log axis", () => {
    const xs = [1, 10, 100, 1000];
    // Halfway along three decades reads 31.6, closer to 10 than to 100.
    expect(nearestIndex(LOG, xs, 0.5)).toBe(1);
    expect(nearestIndex(LOG, xs, 0.66)).toBe(2);
    expect(nearestIndex(LOG, xs, 1)).toBe(3);
  });

  it("registers the data of each figure for its cursor", () => {
    const registry = plotRegistry();
    const series = { x: [0, 1e-3], y: [0, 1], label: "V(out)" };
    const html = figure(
      registry,
      { xLabel: "t", panels: [{ series: [series], yLabel: "V" }] },
      [["V", 3]],
      400,
    );
    expect(html).toContain(`data-plot="p1"`);
    expect(html).toContain(`class="pg-cursor"`);
    const data = registry.data.get("p1");
    expect(data?.panels).toEqual([{ series: [series], unit: "V", digits: 3 }]);
    expect(data?.xFormat(1000)).toBe("1 kHz");
    figure(
      registry,
      {
        xLabel: "f",
        panels: [
          { series: [series], yLabel: "V" },
          { series: [series], yLabel: "V" },
        ],
      },
      [["V", 3]],
      400,
    );
    expect([...registry.data.keys()]).toEqual(["p1", "p2"]);
    expect(registry.data.get("p2")?.panels[1]).toMatchObject({ unit: "", digits: 4 });
  });

  it("draws at the given width", () => {
    const options = { xLabel: "t", panels: [{ series: [{ x: [0, 1], y: [0, 1] }], yLabel: "V" }] };
    const narrow = figure(plotRegistry(), options, [], 320);
    const wide = figure(plotRegistry(), options, [], 900);
    expect(narrow).toContain(`viewBox="0 0 320`);
    expect(wide).toContain(`viewBox="0 0 900`);
  });
});

import { describe, expect, it } from "vitest";
import {
  backingSize,
  clampScale,
  deviceTransform,
  fit,
  IDENTITY_CAMERA,
  panBy,
  SCALE_LIMITS,
  toScreen,
  toWorld,
  visibleWorld,
  zoomAt,
} from "../../../docs/playground/canvas/camera";
import type { Camera, Pt } from "../../../docs/playground/canvas/camera";

const cam: Camera = { scale: 1.5, x: 30, y: -10 };
const near = (a: Pt, b: Pt) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe("playground canvas camera", () => {
  it("maps world to screen and back", () => {
    expect(toScreen(cam, { x: 10, y: 20 })).toEqual({ x: 45, y: 20 });
    expect(toWorld(cam, { x: 45, y: 20 })).toEqual({ x: 10, y: 20 });
    for (const p of [
      { x: 0, y: 0 },
      { x: 7.3, y: -4 },
      { x: -1234.5, y: 987.25 },
    ]) {
      near(toWorld(cam, toScreen(cam, p)), p);
      near(toScreen(cam, toWorld(cam, p)), p);
    }
  });

  it.each([2, 0.5, 1.1, 1 / 1.1, 1000, 1e-6])(
    "keeps the world point under the cursor still when zooming by %d",
    (factor) => {
      const cursor = { x: 200, y: 120 };
      const before = toWorld(cam, cursor);
      const after = zoomAt(cam, cursor, factor);
      near(toWorld(after, cursor), before);
      near(toScreen(after, before), cursor);
    },
  );

  it("clamps the scale to the limits", () => {
    expect(zoomAt(cam, { x: 0, y: 0 }, 1000).scale).toBe(SCALE_LIMITS.max);
    expect(zoomAt(cam, { x: 0, y: 0 }, 1e-6).scale).toBe(SCALE_LIMITS.min);
    expect(zoomAt(cam, { x: 0, y: 0 }, 10, { min: 1, max: 4 }).scale).toBe(4);
    expect(clampScale(2)).toBe(2);
    expect(clampScale(0.5, { min: 1, max: 3 })).toBe(1);
  });

  it("pans by a screen distance without changing the scale", () => {
    const moved = panBy(cam, 12, -5);
    expect(moved).toEqual({ scale: 1.5, x: 42, y: -15 });
    expect(toScreen(moved, { x: 1, y: 1 })).toEqual({ x: 43.5, y: -13.5 });
  });

  it("fits bounds centred inside the margin", () => {
    const f = fit({ minX: 0, minY: 0, maxX: 200, maxY: 100 }, { width: 800, height: 600 }, 20);
    expect(f.scale).toBeCloseTo(3.8, 12);
    near(toScreen(f, { x: 0, y: 0 }), { x: 20, y: 110 });
    near(toScreen(f, { x: 200, y: 100 }), { x: 780, y: 490 });
    near(toScreen(f, { x: 100, y: 50 }), { x: 400, y: 300 });
  });

  it("fits a tall drawing by its height and clamps the scale", () => {
    const tall = fit({ minX: 0, minY: 0, maxX: 10, maxY: 100 }, { width: 800, height: 600 }, 50);
    expect(tall.scale).toBe(5);
    const huge = fit({ minX: 0, minY: 0, maxX: 1e6, maxY: 1e6 }, { width: 800, height: 600 });
    expect(huge.scale).toBe(SCALE_LIMITS.min);
  });

  it("fits an empty extent at the maximum scale, centred on it", () => {
    const f = fit({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, { width: 800, height: 600 }, 20);
    expect(f.scale).toBe(SCALE_LIMITS.max);
    expect(toScreen(f, { x: 5, y: 5 })).toEqual({ x: 400, y: 300 });
  });

  it("reports the visible world rectangle", () => {
    const view = visibleWorld({ scale: 2, x: 100, y: 50 }, { width: 800, height: 600 });
    expect(view).toEqual({ minX: -50, minY: -25, maxX: 350, maxY: 275 });
  });

  it("scales the device transform and the backing store by the pixel ratio", () => {
    expect(deviceTransform(IDENTITY_CAMERA, 1)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(deviceTransform({ scale: 2, x: 10, y: -4 }, 1.5)).toEqual([3, 0, 0, 3, 15, -6]);
    expect(backingSize({ width: 333.3, height: 200 }, 1.5)).toEqual({ width: 500, height: 300 });
    expect(backingSize({ width: 0, height: 0.2 }, 2)).toEqual({ width: 1, height: 1 });
  });

  it("returns new cameras and leaves the input untouched", () => {
    const before = { ...cam };
    zoomAt(cam, { x: 1, y: 2 }, 2);
    panBy(cam, 3, 4);
    expect(cam).toEqual(before);
  });
});

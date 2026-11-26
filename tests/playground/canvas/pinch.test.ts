import { describe, expect, it } from "vitest";
import {
  createGestures,
  wheelFactor,
  type PointerInput,
} from "../../../docs/playground/canvas/gestures";
import { createPinch, MIN_SPAN, routeTouch } from "../../../docs/playground/canvas/pinch";

const touch =
  (type: PointerInput["type"]) =>
  (pointerId: number, x: number, y: number): PointerInput => ({
    type,
    pointerId,
    pointerType: "touch",
    x,
    y,
  });
const down = touch("down");
const move = touch("move");
const up = touch("up");

/** A pinch with fingers 1 and 2 down at (100, 100) and (200, 100). */
const twoFingers = () => {
  const p = createPinch();
  p.feed(down(1, 100, 100));
  p.feed(down(2, 200, 100));
  return p;
};

describe("pinch", () => {
  it("one finger gives nothing and does not engage", () => {
    const p = createPinch();
    expect([down(1, 0, 0), move(1, 30, 0)].flatMap((i) => p.feed(i))).toEqual([]);
    expect(p.engaged()).toBe(false);
  });

  it("the second finger landing engages the pinch and cancels the edit", () => {
    const p = createPinch();
    p.feed(down(1, 100, 100));
    expect(p.feed(down(2, 200, 100))).toEqual([{ kind: "cancel" }]);
    expect(p.engaged()).toBe(true);
  });

  it("moving both fingers together pans by the centroid motion, with no net zoom", () => {
    const p = twoFingers();
    const out = [move(1, 110, 120), move(2, 210, 120)].flatMap((i) => p.feed(i));
    let dx = 0;
    let dy = 0;
    let factor = 1;
    for (const i of out) {
      if (i.kind === "pan") [dx, dy] = [dx + i.dx, dy + i.dy];
      if (i.kind === "zoom") factor *= i.factor;
    }
    expect([dx, dy]).toEqual([10, 20]);
    expect(factor).toBeCloseTo(1, 12);
  });

  it("spreading the fingers zooms by the distance ratio at the new centroid", () => {
    const p = twoFingers();
    expect(p.feed(move(2, 300, 100))).toEqual([
      { kind: "pan", dx: 50, dy: 0 },
      { kind: "zoom", at: { x: 200, y: 100 }, factor: 2 },
    ]);
  });

  it("zooms at the centroid after the move, each finger moving in turn", () => {
    const p = twoFingers();
    p.feed(move(1, 75, 100));
    const [, zoom] = p.feed(move(2, 225, 100));
    expect(zoom).toEqual({
      kind: "zoom",
      at: { x: 150, y: 100 },
      factor: 150 / 125,
    });
  });

  it("does not trust the ratio when the fingers are too close", () => {
    const p = createPinch();
    p.feed(down(1, 100, 100));
    p.feed(down(2, 100 + MIN_SPAN - 1, 100));
    expect(p.feed(move(2, 140, 100)).map((i) => i.kind)).toEqual(["pan"]);
  });

  it("tracks the first finger before the second lands", () => {
    const p = createPinch();
    p.feed(down(1, 0, 100));
    p.feed(move(1, 100, 100));
    p.feed(down(2, 200, 100));
    expect(p.feed(move(2, 300, 100))[1]).toEqual({
      kind: "zoom",
      at: { x: 200, y: 100 },
      factor: 2,
    });
  });

  it("ignores a third finger, mouse and pen inputs", () => {
    const p = twoFingers();
    expect(p.feed(down(3, 0, 0))).toEqual([]);
    expect(p.feed(move(3, 50, 50))).toEqual([]);
    expect(p.feed({ type: "move", pointerId: 1, x: 0, y: 0 })).toEqual([]);
    expect(p.feed({ type: "move", pointerId: 1, pointerType: "pen", x: 0, y: 0 })).toEqual([]);
  });

  it("stays engaged until the last finger is up, and resumes with a new second finger", () => {
    const p = twoFingers();
    p.feed(up(2, 200, 100));
    expect(p.engaged()).toBe(true);
    expect(p.feed(move(1, 50, 50))).toEqual([]);
    expect(p.feed(down(2, 150, 50))).toEqual([]);
    expect(p.feed(move(2, 250, 50))[1]).toEqual({
      kind: "zoom",
      at: { x: 150, y: 50 },
      factor: 2,
    });
    p.feed(up(1, 50, 50));
    p.feed({ ...up(2, 250, 50), type: "cancel" });
    expect(p.engaged()).toBe(false);
  });
});

describe("routeTouch", () => {
  it("a single finger is an edit gesture: press, drag and click as with a mouse", () => {
    const feed = routeTouch(createGestures(), createPinch());
    const out = [down(1, 0, 0), move(1, 10, 0), up(1, 10, 0)].flatMap(feed);
    expect(out.map((i) => i.kind)).toEqual(["press", "dragStart", "dragEnd"]);
  });

  it("a second finger cancels the pending drag of the first, then the pinch owns the fingers", () => {
    const g = createGestures();
    const feed = routeTouch(g, createPinch());
    feed(down(1, 100, 100));
    feed(move(1, 110, 100));
    expect(g.mode()).toBe("drag");
    expect(feed(down(2, 210, 100))).toEqual([{ kind: "cancel" }]);
    expect(g.mode()).toBe("idle");
    expect(feed(move(1, 120, 100)).map((i) => i.kind)).toEqual(["pan", "zoom"]);
    const rest = [up(2, 210, 100), move(1, 300, 300), up(1, 300, 300)].flatMap(feed);
    expect(rest).toEqual([]);
  });

  it("after the pinch, a new single finger edits again", () => {
    const feed = routeTouch(createGestures(), createPinch());
    [down(1, 0, 0), down(2, 50, 0), up(1, 0, 0), up(2, 50, 0)].forEach(feed);
    expect([down(1, 5, 5), up(1, 5, 5)].flatMap(feed).map((i) => i.kind)).toEqual([
      "press",
      "click",
    ]);
  });

  it("lets a Ctrl+wheel zoom and a mouse hover through an engaged pinch", () => {
    const pinch = createPinch();
    const feed = routeTouch(createGestures(), pinch);
    [down(1, 0, 0), down(2, 50, 0)].forEach(feed);
    expect(pinch.engaged()).toBe(true);
    expect(feed({ type: "wheel", x: 5, y: 6, deltaY: -100, ctrlKey: true })).toEqual([
      { kind: "zoom", at: { x: 5, y: 6 }, factor: wheelFactor(-100) },
    ]);
    expect(feed({ type: "move", x: 1, y: 2 })).toEqual([{ kind: "hover", at: { x: 1, y: 2 } }]);
  });

  it("passes the mouse and the wheel straight to the gestures", () => {
    const feed = routeTouch(createGestures(), createPinch());
    expect(feed({ type: "wheel", x: 0, y: 0, deltaY: 10 })).toEqual([
      { kind: "pan", dx: 0, dy: -10 },
    ]);
    expect(feed({ type: "move", x: 1, y: 2 })).toEqual([{ kind: "hover", at: { x: 1, y: 2 } }]);
  });
});

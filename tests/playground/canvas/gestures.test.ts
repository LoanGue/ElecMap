import { describe, expect, it } from "vitest";
import {
  createGestures,
  wheelFactor,
  ZOOM_STEP,
  type Intent,
  type PointerInput,
} from "../../../docs/playground/canvas/gestures";

type Input = Omit<PointerInput, "type">;
const down = (x: number, y: number, more: Partial<Input> = {}): PointerInput => ({
  type: "down",
  x,
  y,
  ...more,
});
const move = (x: number, y: number, more: Partial<Input> = {}): PointerInput => ({
  type: "move",
  x,
  y,
  ...more,
});
const up = (x: number, y: number, more: Partial<Input> = {}): PointerInput => ({
  type: "up",
  x,
  y,
  ...more,
});
const wheel = (more: Partial<Input>): PointerInput => ({ type: "wheel", x: 50, y: 60, ...more });

/** Every intent the inputs give, in order. */
const run = (inputs: PointerInput[], g = createGestures()): Intent[] =>
  inputs.flatMap((i) => g.feed(i));

describe("press, click and drag", () => {
  it("a press that stays within the 4 px slop is a click where it started", () => {
    expect(run([down(10, 10), move(13, 10), move(10, 14), up(12, 12)])).toEqual([
      { kind: "press", at: { x: 10, y: 10 } },
      { kind: "click", at: { x: 10, y: 10 } },
    ]);
  });

  it("moving past the slop starts a drag, then reports every move and the end", () => {
    const from = { x: 10, y: 10 };
    expect(run([down(10, 10), move(15, 10), move(30, 20), up(31, 20)])).toEqual([
      { kind: "press", at: from },
      { kind: "dragStart", from, at: { x: 15, y: 10 } },
      { kind: "drag", from, at: { x: 30, y: 20 } },
      { kind: "dragEnd", from, at: { x: 31, y: 20 } },
    ]);
  });

  it("a drag never turns back into a click once started", () => {
    const out = run([down(0, 0), move(10, 0), move(0, 0), up(0, 0)]);
    expect(out.map((i) => i.kind)).toEqual(["press", "dragStart", "drag", "dragEnd"]);
  });

  it("takes the slop as an option", () => {
    const g = createGestures(10);
    expect(run([down(0, 0), move(8, 0), up(8, 0)], g).map((i) => i.kind)).toEqual([
      "press",
      "click",
    ]);
  });

  it("ignores the right button and other pointers while one is down", () => {
    const g = createGestures();
    expect(run([down(0, 0, { button: 2 }), up(0, 0, { button: 2 })], g)).toEqual([]);
    run([down(0, 0, { pointerId: 1 })], g);
    expect(run([down(5, 5, { pointerId: 2 }), move(50, 50, { pointerId: 2 })], g)).toEqual([]);
    expect(run([up(50, 50, { pointerId: 2 })], g)).toEqual([]);
    expect(g.mode()).toBe("pending");
  });

  it("reports hover for a mouse or pen moving with no button down, not for touch", () => {
    expect(run([move(3, 4), move(5, 6, { pointerType: "pen" })])).toEqual([
      { kind: "hover", at: { x: 3, y: 4 } },
      { kind: "hover", at: { x: 5, y: 6 } },
    ]);
    expect(run([move(3, 4, { pointerType: "touch" })])).toEqual([]);
  });
});

describe("cancel and reset", () => {
  it("a pointer cancel drops a pending press or a drag", () => {
    const cancel: PointerInput = { type: "cancel", x: 0, y: 0 };
    expect(run([down(0, 0), cancel])).toEqual([
      { kind: "press", at: { x: 0, y: 0 } },
      { kind: "cancel" },
    ]);
    const g = createGestures();
    run([down(0, 0), move(20, 0), cancel], g);
    expect(g.mode()).toBe("idle");
    expect(run([up(20, 0)], g)).toEqual([]);
  });

  it("a cancel mid-drag ends with exactly one cancel and never a dragEnd", () => {
    const out = run([down(0, 0), move(20, 0), move(30, 0), { type: "cancel", x: 30, y: 0 }]);
    expect(out[out.length - 1]).toEqual({ kind: "cancel" });
    expect(out.filter((i) => i.kind === "cancel")).toHaveLength(1);
    expect(out.some((i) => i.kind === "dragEnd")).toBe(false);
  });

  it("a cancel from another pointer leaves the press alone", () => {
    const g = createGestures();
    run([down(0, 0, { pointerId: 1 })], g);
    expect(g.feed({ type: "cancel", x: 0, y: 0, pointerId: 2 })).toEqual([]);
    expect(g.mode()).toBe("pending");
  });

  it("a cancel during a pan gives nothing and ends the pan", () => {
    const g = createGestures();
    run([down(0, 0, { button: 1 }), move(5, 0)], g);
    expect(g.feed({ type: "cancel", x: 5, y: 0 })).toEqual([]);
    expect(g.mode()).toBe("idle");
  });

  it("reset drops the gesture and says so only when there was one", () => {
    const g = createGestures();
    expect(g.reset()).toEqual([]);
    run([down(0, 0)], g);
    expect(g.reset()).toEqual([{ kind: "cancel" }]);
    expect(run([up(0, 0)], g)).toEqual([]);
  });
});

describe("pan with the middle button or Space", () => {
  it("a middle button drag pans by every move, from the first pixel", () => {
    expect(run([down(0, 0, { button: 1 }), move(1, 0), move(6, -3), up(6, -3)])).toEqual([
      { kind: "pan", dx: 1, dy: 0 },
      { kind: "pan", dx: 5, dy: -3 },
    ]);
  });

  it("Space held turns a left drag into a pan and gives no click", () => {
    const g = createGestures();
    g.setSpace(true);
    expect(g.spaceHeld()).toBe(true);
    expect(run([down(0, 0), move(2, 2), up(2, 2)], g)).toEqual([{ kind: "pan", dx: 2, dy: 2 }]);
  });

  it("releasing Space mid-pan keeps the pan until the button goes up", () => {
    const g = createGestures();
    g.setSpace(true);
    run([down(0, 0)], g);
    g.setSpace(false);
    expect(run([move(3, 0)], g)).toEqual([{ kind: "pan", dx: 3, dy: 0 }]);
    run([up(3, 0)], g);
    expect(run([down(0, 0)], g)).toEqual([{ kind: "press", at: { x: 0, y: 0 } }]);
  });
});

describe("wheel", () => {
  it("a plain wheel pans the view against the scroll", () => {
    expect(run([wheel({ deltaX: 10, deltaY: 100 })])).toEqual([{ kind: "pan", dx: -10, dy: -100 }]);
    expect(run([wheel({ deltaY: 0 })])).toEqual([]);
  });

  it("turns line and page deltas into pixels", () => {
    expect(run([wheel({ deltaY: 3, deltaMode: 1 })])).toEqual([{ kind: "pan", dx: 0, dy: -48 }]);
    expect(run([wheel({ deltaY: 1, deltaMode: 2 })])).toEqual([{ kind: "pan", dx: 0, dy: -400 }]);
  });

  it("Ctrl or Cmd with the wheel zooms at the cursor, wheel up zooms in", () => {
    const [zin] = run([wheel({ deltaY: -100, ctrlKey: true })]);
    const [zout] = run([wheel({ deltaY: 100, metaKey: true })]);
    expect(zin).toEqual({ kind: "zoom", at: { x: 50, y: 60 }, factor: wheelFactor(-100) });
    expect(zin?.kind === "zoom" && zin.factor).toBeGreaterThan(1);
    expect(zout?.kind === "zoom" && zout.factor).toBeLessThan(1);
  });

  it("clamps the zoom factor of one event, and is symmetric for small deltas", () => {
    expect(wheelFactor(-10_000)).toBe(ZOOM_STEP.max);
    expect(wheelFactor(10_000)).toBe(ZOOM_STEP.min);
    expect(wheelFactor(5) * wheelFactor(-5)).toBeCloseTo(1, 12);
  });

  it("works during a drag without ending it", () => {
    const g = createGestures();
    run([down(0, 0), move(10, 0)], g);
    expect(run([wheel({ deltaY: 20 })], g)).toEqual([{ kind: "pan", dx: 0, dy: -20 }]);
    expect(g.mode()).toBe("drag");
  });
});

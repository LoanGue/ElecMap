/**
 * Pointer gestures of the canvas editor as a pure state machine.
 *
 * Fed plain, event-like objects (a pointer or wheel event copied field by
 * field), it returns intents: data the controller applies to the camera and
 * the editing tools. Nothing here touches the DOM; the Space key is reported
 * through `setSpace`, never through a listener.
 *
 * Coordinates are CSS pixels relative to the canvas.
 */

/** A point in canvas CSS pixels. */
export interface Point {
  x: number;
  y: number;
}

/** The fields of a PointerEvent or WheelEvent the machine reads. */
export interface PointerInput {
  type: "down" | "move" | "up" | "cancel" | "wheel";
  x: number;
  y: number;
  /** 0 left, 1 middle, 2 right (PointerEvent.button). Defaults to 0. */
  button?: number;
  /** Defaults to 1. */
  pointerId?: number;
  /** "mouse", "pen" or "touch". Defaults to "mouse". */
  pointerType?: string;
  deltaX?: number;
  deltaY?: number;
  /** WheelEvent.deltaMode: 0 pixels, 1 lines, 2 pages. Defaults to 0. */
  deltaMode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/** What the controller should do in answer to an input. */
export type Intent =
  | { kind: "hover"; at: Point }
  | { kind: "press"; at: Point }
  | { kind: "click"; at: Point }
  | { kind: "dragStart" | "drag" | "dragEnd"; from: Point; at: Point }
  | { kind: "pan"; dx: number; dy: number }
  | { kind: "zoom"; at: Point; factor: number }
  | { kind: "cancel" };

export type Mode = "idle" | "pending" | "drag" | "pan";

export interface Gestures {
  feed(input: PointerInput): Intent[];
  /** Space held turns a left-button drag into a pan. */
  setSpace(down: boolean): void;
  /** Drops the current press or drag, `[{kind:"cancel"}]` if there was one. */
  reset(): Intent[];
  mode(): Mode;
  spaceHeld(): boolean;
}

/** Distance in CSS pixels a press may travel and still be a click. */
export const SLOP = 4;
/** Zoom factor per pixel of wheel delta with Ctrl or Cmd held. */
export const ZOOM_PER_PIXEL = 0.002;
/** Bounds of the zoom factor a single wheel event may give. */
export const ZOOM_STEP = { min: 0.8, max: 1.25 };
/** Pixels per wheel line and per wheel page (deltaMode 1 and 2). */
export const WHEEL_LINE = 16;
export const WHEEL_PAGE = 400;

const LEFT = 0;
const MIDDLE = 1;

type State =
  | { mode: "idle" }
  | { mode: "pending" | "drag"; id: number; from: Point }
  | { mode: "pan"; id: number; last: Point };

const point = (i: PointerInput): Point => ({ x: i.x, y: i.y });

/** Zoom factor of one Ctrl/Cmd+wheel event: up zooms in, clamped to ZOOM_STEP. */
export function wheelFactor(deltaY: number): number {
  const f = Math.exp(-deltaY * ZOOM_PER_PIXEL);
  return Math.min(ZOOM_STEP.max, Math.max(ZOOM_STEP.min, f));
}

function wheel(i: PointerInput): Intent[] {
  const unit = i.deltaMode === 1 ? WHEEL_LINE : i.deltaMode === 2 ? WHEEL_PAGE : 1;
  const dx = (i.deltaX ?? 0) * unit;
  const dy = (i.deltaY ?? 0) * unit;
  if (i.ctrlKey || i.metaKey) {
    return dy === 0 ? [] : [{ kind: "zoom", at: point(i), factor: wheelFactor(dy) }];
  }
  return dx === 0 && dy === 0 ? [] : [{ kind: "pan", dx: 0 - dx, dy: 0 - dy }];
}

export function createGestures(slop = SLOP): Gestures {
  let state: State = { mode: "idle" };
  let space = false;

  const down = (i: PointerInput, id: number): Intent[] => {
    if (state.mode !== "idle") return [];
    const button = i.button ?? LEFT;
    if (button === MIDDLE || (button === LEFT && space)) {
      state = { mode: "pan", id, last: point(i) };
      return [];
    }
    if (button !== LEFT) return [];
    state = { mode: "pending", id, from: point(i) };
    return [{ kind: "press", at: point(i) }];
  };

  const move = (i: PointerInput, id: number): Intent[] => {
    const at = point(i);
    if (state.mode === "idle") {
      return i.pointerType === "touch" ? [] : [{ kind: "hover", at }];
    }
    if (state.id !== id) return [];
    if (state.mode === "pan") {
      const { last } = state;
      state = { ...state, last: at };
      return [{ kind: "pan", dx: at.x - last.x, dy: at.y - last.y }];
    }
    const { from } = state;
    if (state.mode === "drag") return [{ kind: "drag", from, at }];
    if (Math.hypot(at.x - from.x, at.y - from.y) <= slop) return [];
    state = { ...state, mode: "drag" };
    return [{ kind: "dragStart", from, at }];
  };

  const up = (i: PointerInput, id: number): Intent[] => {
    if (state.mode === "idle" || state.id !== id) return [];
    const was = state;
    state = { mode: "idle" };
    if (was.mode === "pending") return [{ kind: "click", at: was.from }];
    if (was.mode === "drag") return [{ kind: "dragEnd", from: was.from, at: point(i) }];
    return [];
  };

  const reset = (): Intent[] => {
    const active = state.mode === "pending" || state.mode === "drag";
    state = { mode: "idle" };
    return active ? [{ kind: "cancel" }] : [];
  };

  return {
    feed(i) {
      const id = i.pointerId ?? 1;
      if (i.type === "wheel") return wheel(i);
      if (i.type === "down") return down(i, id);
      if (i.type === "move") return move(i, id);
      if (i.type === "up") return up(i, id);
      return state.mode !== "idle" && state.id === id ? reset() : [];
    },
    setSpace(d) {
      space = d;
    },
    reset,
    mode: () => state.mode,
    spaceHeld: () => space,
  };
}

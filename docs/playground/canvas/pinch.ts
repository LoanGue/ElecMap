/**
 * Two-finger pan and pinch zoom of the canvas editor, as a pure state machine
 * in the same terms as `gestures.ts`: plain event-like inputs in, intents out.
 *
 * Up to two touch pointers are tracked. Once a second finger lands the pinch
 * is engaged: the motion of the centroid pans, the ratio of the distances
 * zooms at the centroid, and the single-finger edit gesture of the first
 * finger is cancelled. The pinch stays engaged until every finger is up, so
 * the finger left on the glass does not start an edit.
 */
import type { Gestures, Intent, Point, PointerInput } from "./gestures";

export interface Pinch {
  feed(input: PointerInput): Intent[];
  /** True from the second finger down until the last finger up. */
  engaged(): boolean;
}

/** Below this distance in CSS pixels between fingers the ratio is not trusted. */
export const MIN_SPAN = 8;

const centroid = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
const span = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export function createPinch(): Pinch {
  const fingers = new Map<number, Point>();
  let engaged = false;

  const pair = (): [Point, Point] | undefined => {
    const [a, b] = [...fingers.values()];
    return a && b ? [a, b] : undefined;
  };

  const down = (id: number, at: Point): Intent[] => {
    if (fingers.size >= 2 || fingers.has(id)) return [];
    fingers.set(id, at);
    if (fingers.size < 2 || engaged) return [];
    engaged = true;
    return [{ kind: "cancel" }];
  };

  const move = (id: number, at: Point): Intent[] => {
    const before = pair();
    if (!fingers.has(id)) return [];
    fingers.set(id, at);
    const after = pair();
    if (!before || !after) return [];
    const [c0, c1] = [centroid(...before), centroid(...after)];
    const out: Intent[] = [];
    if (c1.x !== c0.x || c1.y !== c0.y) out.push({ kind: "pan", dx: c1.x - c0.x, dy: c1.y - c0.y });
    const [d0, d1] = [span(...before), span(...after)];
    if (d0 >= MIN_SPAN && d1 >= MIN_SPAN && d1 !== d0) {
      out.push({ kind: "zoom", at: c1, factor: d1 / d0 });
    }
    return out;
  };

  return {
    feed(i) {
      if (i.pointerType !== "touch") return [];
      const id = i.pointerId ?? 1;
      const at = { x: i.x, y: i.y };
      if (i.type === "down") return down(id, at);
      if (i.type === "move") return move(id, at);
      if (i.type === "up" || i.type === "cancel") {
        fingers.delete(id);
        if (fingers.size === 0) engaged = false;
      }
      return [];
    },
    engaged: () => engaged,
  };
}

/**
 * One entry point for every pointer input. Touch goes to the pinch first,
 * and while it is engaged the single-pointer gestures see no touch input;
 * the pinch's cancel also drops whatever press or drag they held. Mouse,
 * pen and wheel inputs always reach the gestures, pinch or not.
 */
export function routeTouch(gestures: Gestures, pinch: Pinch): (input: PointerInput) => Intent[] {
  return (input) => {
    const out = pinch.feed(input);
    if (input.pointerType !== "touch" || !pinch.engaged()) return gestures.feed(input);
    if (out.some((i) => i.kind === "cancel")) gestures.reset();
    return out;
  };
}

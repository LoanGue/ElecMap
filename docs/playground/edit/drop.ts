/**
 * End of a part drag in the block editor. A two-pin part whose pins land on
 * a wire turns to lie along it if needed and takes the place of the piece of
 * wire between its pins; anywhere else the drop is a plain move, its wires
 * re-routed.
 *
 * Only wires that touched none of the part's pins before the drag can take
 * it: a part slid along its own wire is moved, never cut into its own wiring.
 *
 * Pure functions on grid units. Like `move`, `drop` starts from the drawing
 * as it was when the drag began, with an absolute target. User nodes are left
 * as they are (the caller applies `liveNodes`).
 */
import type { Orientation } from "../../../src";
import { centerOffset, onSegment as on, pinsOf, rotatable, TURN } from "../model";
import type { Drawing, Part, Pt, Wire } from "../model";
import { fit, insert } from "./fitting";
import { move } from "./moves";

/** Where a dropped part lands on a wire: its anchor and orientation. */
export interface Landing {
  to: Pt;
  dir: Orientation;
}

/** The part placed at `to`, turned to `dir` around its visual centre. */
function turned(p: Part, to: Pt, dir: Orientation): Part {
  const c = centerOffset(p.kind, p.dir);
  const o = centerOffset(p.kind, dir);
  return { ...p, x: to.x + c.x - o.x, y: to.y + c.y - o.y, dir };
}

/** Wires free of the part's pins before the drag: the ones it may cut. */
function foreign(d: Drawing, p: Part): Wire[] {
  const pins = pinsOf(p);
  return d.wires.filter((w) => !pins.some((q) => on(q, w)));
}

/**
 * Where part `id` lands when dropped with its anchor at `to`: as it is if
 * both pins fall on one wire, else turned a quarter around its centre if that
 * puts both pins on one wire. Undefined when no wire takes it, and for parts
 * that do not turn (op-amps, transistors). Lets the editor preview the turn.
 */
export function landing(drawing: Drawing, id: string, to: Pt): Landing | undefined {
  const p = drawing.parts.find((q) => q.id === id);
  if (!p || !rotatable(p.kind)) return undefined;
  const dir = fit(foreign(drawing, p), [p.dir, TURN[p.dir]], (d) => pinsOf(turned(p, to, d)));
  if (dir === undefined) return undefined;
  const q = turned(p, to, dir);
  return { to: { x: q.x, y: q.y }, dir };
}

/**
 * The drawing after part `id` is dropped with its anchor at `to`. On a wire
 * (see `landing`) the part turns if needed, its own wires follow it, and the
 * wire under it is cut in two at its pins. Elsewhere this is
 * `move(drawing, { kind: "part", id, to })`. `drawing` is not modified.
 */
export function drop(drawing: Drawing, id: string, to: Pt): Drawing {
  const land = landing(drawing, id, to);
  if (!land) return move(drawing, { kind: "part", id, to });
  const p = drawing.parts.find((q) => q.id === id) as Part;
  const pins = pinsOf({ ...p, ...land.to, dir: land.dir });
  const cut = { ...drawing, wires: insert(drawing.wires, pins) };
  return move(cut, { kind: "part", id, to: land.to, dir: land.dir });
}

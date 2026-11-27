/**
 * Moves in the block editor: a part dragged or turned, a ground or a label
 * dragged, or free wire ends pulled. The wires attached to what moves are
 * drawn again through the routing module, with the fewest bends; everything
 * else (other pins, grounds, labels, user nodes) stays where it is.
 *
 * Part bodies are a routing cost, not a wall: a body point costs 300 against
 * 100 per bend, and the router only tries a straight wire, the two L shapes
 * and Z shapes offset by at most 3 cells. A wire crosses a body when none of
 * these candidates avoids it.
 *
 * Pure functions on grid units. The caller re-routes from the drawing as it
 * was when the drag began, and only when the grid point under the pointer
 * changes.
 */
import type { Orientation } from "../../../src";
import { pinsOf, TWO_TERMINAL } from "../model";
import type { Drawing, Part, Pt } from "../model";
import { reroute } from "../routing";
import type { Move } from "../routing";

export type { Move } from "../routing";

/** What moves, and where to. */
export type Moving =
  /** A part placed again: new anchor, and new orientation when it turns. */
  | { kind: "part"; id: string; to: Pt; dir?: Orientation }
  | { kind: "ground"; index: number; to: Pt }
  | { kind: "label"; index: number; to: Pt }
  /** Free wire ends, each from → to (a dragged wire moves both of its ends). */
  | { kind: "ends"; moves: Move[] };

const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => {
  const out: Pt[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ x, y });
  return out;
};

/** Grid points covered by the symbol of a part, its pins excluded. */
export function bodyOf(p: Part): Pt[] {
  if (TWO_TERMINAL.has(p.kind)) {
    const [a, b] = pinsOf(p) as [Pt, Pt];
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    return [1, 2, 3].map((i) => ({ x: a.x + i * dx, y: a.y + i * dy }));
  }
  if (p.kind === "opamp") return box(p.x - 4, p.y - 2, p.x - 1, p.y + 2);
  // Neither two-pin nor op-amp: treated as a transistor (BJT or MOSFET).
  return box(p.x - 2, p.y + 1, p.x + 1, p.y + 5);
}

/** Body points of every part, as routing keys. */
export function bodyCells(parts: Part[]): Set<string> {
  return new Set(parts.flatMap(bodyOf).map((q) => `${q.x},${q.y}`));
}

/** Drawing with the item moved, and the points that moved with it. */
function place(d: Drawing, m: Moving): { next: Drawing; moves: Move[] } | undefined {
  if (m.kind === "part") {
    const p = d.parts.find((q) => q.id === m.id);
    if (!p) return undefined;
    const q: Part = { ...p, x: m.to.x, y: m.to.y, dir: m.dir ?? p.dir };
    const after = pinsOf(q);
    const moves = pinsOf(p).map((a, i): Move => [a, after[i] as Pt]);
    return { next: { ...d, parts: d.parts.map((r) => (r === p ? q : r)) }, moves };
  }
  if (m.kind === "ends") return { next: d, moves: m.moves };
  const list = m.kind === "ground" ? d.grounds : d.labels;
  const old = list[m.index];
  if (!old) return undefined;
  const moves: Move[] = [
    [
      { x: old.x, y: old.y },
      { x: m.to.x, y: m.to.y },
    ],
  ];
  if (m.kind === "ground") {
    const grounds = d.grounds.map((g, i) => (i === m.index ? { ...m.to } : g));
    return { next: { ...d, grounds }, moves };
  }
  const labels = d.labels.map((l, i) => (i === m.index ? { ...l, x: m.to.x, y: m.to.y } : l));
  return { next: { ...d, labels }, moves };
}

/** Points that stay put: the pins of the parts that do not move, the grounds
 * and labels that do not move, and the user nodes. */
function anchors(d: Drawing, m: Moving): Pt[] {
  const parts = m.kind === "part" ? d.parts.filter((p) => p.id !== m.id) : d.parts;
  const others = <T extends Pt>(list: T[], kind: "ground" | "label"): Pt[] =>
    list.filter((_, i) => m.kind !== kind || i !== m.index).map((q) => ({ x: q.x, y: q.y }));
  return [
    ...parts.flatMap(pinsOf),
    ...others(d.grounds, "ground"),
    ...others(d.labels, "label"),
    ...d.nodes,
  ];
}

/**
 * The drawing after a move, its wires re-routed. Returns the same drawing
 * when the item is not found, and leaves the wiring alone when nothing moves.
 * Part bodies after the move weigh on the routes but do not forbid them: a
 * wire still crosses a body when every straight, L or Z candidate does.
 * `drawing` is not modified.
 */
export function move(drawing: Drawing, m: Moving): Drawing {
  const placed = place(drawing, m);
  if (!placed) return drawing;
  const { next } = placed;
  const moves = placed.moves.filter(([a, b]) => a.x !== b.x || a.y !== b.y);
  if (moves.length === 0) return next;
  const wires = reroute(drawing.wires, moves, {
    anchors: anchors(drawing, m),
    blocked: bodyCells(next.parts),
  });
  return { ...next, wires };
}

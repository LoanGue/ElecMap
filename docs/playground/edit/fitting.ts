/**
 * Fitting parts and wires together in the block editor: a part dropped on a
 * wire turns to lie along it and takes the place of the piece of wire between
 * its pins; a wire drawn onto another one makes a node that stays.
 *
 * Pure functions on grid units; the editor owns the drawing.
 */
import { onSegment as on } from "../model";
import type { Pt, Wire } from "../routing";

const same = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y;

const isEnd = (p: Pt, w: Wire): boolean =>
  (p.x === w.x1 && p.y === w.y1) || (p.x === w.x2 && p.y === w.y2);

/** Wire arms leaving `p`: one per wire ending there, two per wire passing through. */
const arms = (p: Pt, wires: Wire[]): number =>
  wires.reduce((n, w) => n + (!on(p, w) ? 0 : isEnd(p, w) ? 1 : 2), 0);

/** First orientation, in the order given, that puts every pin on one same wire. */
export function fit<D>(wires: Wire[], dirs: D[], pinsFor: (dir: D) => Pt[]): D | undefined {
  return dirs.find((dir) => {
    const pins = pinsFor(dir);
    return wires.some((w) => pins.every((p) => on(p, w)));
  });
}

/**
 * A two-pin part on a wire takes the place of the piece between its pins:
 * the wire is cut in two, each half ending on the nearer pin. Wires that do
 * not hold both pins, and parts with another number of pins, leave the
 * wiring as it is.
 */
export function insert(wires: Wire[], pins: Pt[]): Wire[] {
  if (pins.length !== 2) return wires;
  const [a, b] = pins as [Pt, Pt];
  const i = wires.findIndex((w) => on(a, w) && on(b, w));
  const w = wires[i];
  if (!w) return wires;
  const s = { x: w.x1, y: w.y1 };
  const e = { x: w.x2, y: w.y2 };
  const dist = (p: Pt, q: Pt) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
  const [near, far] = dist(s, a) <= dist(s, b) ? [a, b] : [b, a];
  const halves = [
    { x1: s.x, y1: s.y, x2: near.x, y2: near.y },
    { x1: far.x, y1: far.y, x2: e.x, y2: e.y },
  ].filter((v) => v.x1 !== v.x2 || v.y1 !== v.y2);
  return [...wires.slice(0, i), ...halves, ...wires.slice(i + 1)];
}

/**
 * Nodes a new wire makes: one of its ends lands where two wire arms already
 * meet (the middle of a wire, a bend, a T), away from any pin. These are the
 * user's nodes: they stay put when the wiring around them changes.
 *
 * `wires` is the wiring BEFORE the new wire is added. An end on a free wire
 * end counts one arm only, so a wire that merely extends another one makes no
 * node; counting the new wire too would turn every extension into a node.
 */
export function nodesMade(wires: Wire[], ends: Pt[], pins: Pt[]): Pt[] {
  return ends.filter((p) => {
    if (pins.some((q) => same(p, q))) return false;
    return arms(p, wires) >= 2;
  });
}

/** Adds the new nodes, once each. */
export function withNodes(nodes: Pt[], made: Pt[]): Pt[] {
  const out = [...nodes];
  for (const p of made) if (!out.some((q) => same(p, q))) out.push(p);
  return out;
}

/**
 * Nodes still on a wire junction: a node keeps its place while at least two
 * wire arms meet on it, and goes once its wires are deleted or shortened to
 * a single free end.
 */
export function liveNodes(nodes: Pt[], wires: Wire[]): Pt[] {
  return nodes.filter((p) => arms(p, wires) >= 2);
}

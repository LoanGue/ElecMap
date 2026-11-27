/**
 * Drawing wires in the block editor: a stroke from one grid point to another
 * becomes one or two straight wires (an L), bent so that a wire leaves a
 * vertical pin vertically. A stroke that ends on the middle of a wire, a bend
 * or a T makes a user node there, which simplify and re-routing keep.
 *
 * Pure functions on grid units: each returns a new drawing, the caller owns
 * the history and the selection.
 */
import { onSegment, pinsOf, TWO_TERMINAL, type Drawing, type Pt, type Wire } from "../model";
import { segment } from "../wires";
import { nodesMade, withNodes } from "./fitting";

const same = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y;

/** Same wire, in either direction. */
const sameWire = (v: Wire, w: Wire): boolean =>
  (v.x1 === w.x1 && v.y1 === w.y1 && v.x2 === w.x2 && v.y2 === w.y2) ||
  (v.x1 === w.x2 && v.y1 === w.y2 && v.x2 === w.x1 && v.y2 === w.y1);

const allPins = (d: Drawing): Pt[] => d.parts.flatMap(pinsOf);

/**
 * Bend of a stroke from `a` to `b`: horizontal first, unless `a` is a pin a
 * wire must leave vertically (either pin of a vertical two-terminal part, the
 * top and bottom pins of a transistor). An op-amp's pins all leave sideways.
 */
export function corner(d: Drawing, a: Pt, b: Pt): Pt {
  let vertical = false;
  for (const p of d.parts) {
    const pins = pinsOf(p);
    const i = pins.findIndex((q) => same(q, a));
    if (i < 0) continue;
    const other = pins[i === 0 ? 1 : 0] as Pt;
    vertical = TWO_TERMINAL.has(p.kind) ? other.x === a.x : i !== 1 && p.kind !== "opamp";
    break;
  }
  return vertical ? { x: a.x, y: b.y } : { x: b.x, y: a.y };
}

/** The straight wires of an L-shaped stroke, zero-length pieces left out. */
export function strokeWires(d: Drawing, a: Pt, b: Pt): Wire[] {
  const c = corner(d, a, b);
  return [segment(a, c), segment(c, b)].filter((w) => w.x1 !== w.x2 || w.y1 !== w.y2);
}

/**
 * The drawing with an L-shaped wire from `from` to `to`. A piece already
 * drawn (either way round) is not added twice. Ends and bend landing where
 * two wire arms already meet, away from a pin, become user nodes: they are
 * found on the wiring before the stroke is added, so a wire that merely
 * extends another one makes no node.
 */
export function addWire(d: Drawing, from: Pt, to: Pt): Drawing {
  if (same(from, to)) return d;
  const stroke = strokeWires(d, from, to);
  const fresh = stroke.filter((w) => !d.wires.some((v) => sameWire(v, w)));
  if (fresh.length === 0) return d;
  const ends = [from, corner(d, from, to), to].filter(
    (p, i, all) => all.findIndex((q) => same(p, q)) === i,
  );
  const made = nodesMade(d.wires, ends, allPins(d));
  return { ...d, wires: [...d.wires, ...fresh], nodes: withNodes(d.nodes, made) };
}

/**
 * Whether a stroke can end at `p`: a pin, a ground, a label, a user node, or
 * any point of a wire (its middle included). The wire tool stops there;
 * elsewhere it keeps drawing from the point reached.
 */
export function connectable(d: Drawing, p: Pt): boolean {
  return (
    allPins(d).some((q) => same(p, q)) ||
    d.grounds.some((q) => same(p, q)) ||
    d.labels.some((q) => same(p, q)) ||
    d.nodes.some((q) => same(p, q)) ||
    d.wires.some((w) => onSegment(p, w))
  );
}

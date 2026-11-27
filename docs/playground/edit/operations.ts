/**
 * Drawing operations of the block editor: place, remove and turn parts, add
 * grounds and labels, clear the drawing, set the directives.
 *
 * Pure functions on grid units: each returns a new drawing and leaves the
 * one given untouched. An operation that changes nothing returns the same
 * object, so the caller can compare references to skip an undo step.
 */
import type { Orientation } from "../../../src";
import {
  centerOffset,
  DEFAULT_VALUE,
  distance,
  emptyDrawing,
  pinsOf,
  PREFIX,
  rotatable,
  TURN,
} from "../model";
import type { Drawing, Kind, Part, Pt, Selection } from "../model";
import { fit, insert, liveNodes } from "./fitting";
import { move } from "./moves";
import { nextId } from "./naming";

/** Farthest a wire selection's point may be from the wire it picks (grid units). */
const WIRE_PICK = 0.5;

/** Names given to new labels, in order, before `x1`, `x2`… */
const LABEL_NAMES = ["in", "out", "a", "b", "c", "d"];

const same = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y;

/** Anchor that puts the visual centre of a `kind` part facing `dir` on `centre`. */
function anchorFor(kind: Kind, dir: Orientation, centre: Pt): Pt {
  const o = centerOffset(kind, dir);
  return { x: centre.x - o.x, y: centre.y - o.y };
}

/**
 * The part the place tool would add: centred on `at`, facing `dir` (op-amps
 * and transistors always face right), with the first free id and the
 * default value. Also the ghost the editor shows under the pointer.
 */
export function ghost(drawing: Drawing, kind: Kind, at: Pt, dir: Orientation): Part {
  const facing = rotatable(kind) ? dir : "right";
  return {
    id: nextId(drawing, PREFIX[kind]),
    kind,
    ...anchorFor(kind, facing, at),
    dir: facing,
    value: DEFAULT_VALUE[kind] ?? "",
  };
}

/**
 * The drawing with a new `kind` part centred on `at`; the new part is the
 * last of `parts`. A two-pin part whose pins land on one wire takes the
 * place of the piece of wire between them; when only a quarter turn puts
 * both pins on a wire (a horizontal resistor dropped on a vertical wire), it
 * turns around its centre first.
 */
export function place(drawing: Drawing, kind: Kind, at: Pt, dir: Orientation): Drawing {
  const base = ghost(drawing, kind, at, dir);
  const turned = (d: Orientation): Part => ({ ...base, ...anchorFor(kind, d, at), dir: d });
  const dirs = rotatable(kind) ? [base.dir, TURN[base.dir]] : [];
  const onWire = fit(drawing.wires, dirs, (d) => pinsOf(turned(d)));
  const part = onWire === undefined ? base : turned(onWire);
  const wires = onWire === undefined ? drawing.wires : insert(drawing.wires, pinsOf(part));
  const nodes = liveNodes(drawing.nodes, wires);
  return { ...drawing, parts: [...drawing.parts, part], wires, nodes };
}

/**
 * The drawing with part `id` turned a quarter clockwise around its visual
 * centre, its wires re-routed (see `move`). Parts that do not turn (op-amps,
 * transistors) and unknown ids leave the drawing as it is.
 */
export function rotate(drawing: Drawing, id: string): Drawing {
  const p = drawing.parts.find((q) => q.id === id);
  if (!p || !rotatable(p.kind)) return drawing;
  const o = centerOffset(p.kind, p.dir);
  const dir = TURN[p.dir];
  const to = anchorFor(p.kind, dir, { x: p.x + o.x, y: p.y + o.y });
  return move(drawing, { kind: "part", id, to, dir });
}

/** Index of the wire a wire selection picks: the nearest one to its point, the
 * first of them at a tie (several wires through a junction). */
function pickWire(drawing: Drawing, at: Pt): number {
  let best = -1;
  let dist = WIRE_PICK;
  drawing.wires.forEach((w, i) => {
    const v = distance(at, w);
    if (v < dist) [best, dist] = [i, v];
  });
  return best;
}

/**
 * The drawing without the selected items: parts by id, a wire by the
 * nearest one to its point (less than half a cell away), grounds and labels by
 * their index in `drawing`. User nodes left with fewer than two wire arms
 * go too (`liveNodes`). Wires attached to a removed part stay.
 */
export function remove(drawing: Drawing, selection: Selection | Selection[]): Drawing {
  const sel = Array.isArray(selection) ? selection : [selection];
  const ids = new Set<string>();
  const wires = new Set<number>();
  const grounds = new Set<number>();
  const labels = new Set<number>();
  for (const s of sel) {
    if (s.kind === "part") ids.add(s.id);
    else if (s.kind === "wire") wires.add(pickWire(drawing, s.at));
    else (s.kind === "ground" ? grounds : labels).add(s.index);
  }
  const next: Drawing = {
    ...drawing,
    parts: drawing.parts.filter((p) => !ids.has(p.id)),
    wires: drawing.wires.filter((_, i) => !wires.has(i)),
    grounds: drawing.grounds.filter((_, i) => !grounds.has(i)),
    labels: drawing.labels.filter((_, i) => !labels.has(i)),
  };
  const changed = (["parts", "wires", "grounds", "labels"] as const).some(
    (k) => next[k].length !== drawing[k].length,
  );
  if (!changed) return drawing;
  return { ...next, nodes: liveNodes(drawing.nodes, next.wires) };
}

/** The drawing with a ground at `at`, the last of `grounds`; unchanged if one is there. */
export function addGround(drawing: Drawing, at: Pt): Drawing {
  if (drawing.grounds.some((g) => same(g, at))) return drawing;
  return { ...drawing, grounds: [...drawing.grounds, { x: at.x, y: at.y }] };
}

/** Name for a new label: `in`, `out`, `a`… `d`, then the first free `x<n>`. */
export function freeLabel(drawing: Drawing): string {
  const used = new Set(drawing.labels.map((l) => l.name));
  const name = LABEL_NAMES.find((n) => !used.has(n));
  if (name !== undefined) return name;
  let n = 1;
  while (used.has(`x${n}`)) n++;
  return `x${n}`;
}

/** The drawing with a label at `at`, the last of `labels`, named by `freeLabel`. */
export function addLabel(drawing: Drawing, at: Pt): Drawing {
  const label = { x: at.x, y: at.y, name: freeLabel(drawing) };
  return { ...drawing, labels: [...drawing.labels, label] };
}

/**
 * The drawing with label `index` named `text`, trimmed. Blank text, text
 * with a space inside and unknown indexes are refused: the drawing comes
 * back unchanged. Several labels may share a name (they join one net).
 */
export function renameLabel(drawing: Drawing, index: number, text: string): Drawing {
  const name = text.trim();
  const old = drawing.labels[index];
  if (!old || name === "" || /\s/.test(name) || name === old.name) return drawing;
  const labels = drawing.labels.map((l, i) => (i === index ? { ...l, name } : l));
  return { ...drawing, labels };
}

/** An empty drawing: parts, wires, grounds, labels, nodes and directives all go. */
export const clear = (): Drawing => emptyDrawing();

/** The drawing with these extra netlist lines (`.model`, `.param`…). */
export function setDirectives(drawing: Drawing, text: string): Drawing {
  return text === drawing.directives ? drawing : { ...drawing, directives: text };
}

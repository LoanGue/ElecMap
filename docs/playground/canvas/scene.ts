/**
 * Scene of the canvas editor: what to draw for a drawing, as plain data in
 * world pixels (`CELL` per grid unit). Wires, junction dots, free pins,
 * symbols (sprite key and translation), ground and label markers, the ghost
 * of the part being placed, the wire being drawn, selection outlines and the
 * highlight flags. No text (scene-text.ts) and no canvas calls (the painter).
 */
import type { ComponentJSON } from "../../../src";
import { onSegment, pinsOf, TWO_TERMINAL } from "../model";
import type { Drawing, Part, Pt, Selection } from "../model";
import { connect } from "../netlist";
import type { Connectivity } from "../netlist";
import { liveNodes } from "../edit/fitting";
import { bodyOf } from "../edit/moves";
import { CELL, spriteKey } from "./sprites";
import type { SpriteCache, SpriteKey, SymbolStyle } from "./sprites";

/** A wire, in world pixels. `hl`: its node is highlighted. */
export interface WireItem {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  hl: boolean;
}

/** Junction dot. `user`: a node the user placed (shown even with two arms). */
export interface DotItem {
  x: number;
  y: number;
  user: boolean;
  hl: boolean;
}

/** Pin connected to nothing: no wire, other pin, ground or label touches it. */
export interface PinItem {
  x: number;
  y: number;
  /** Part id and pin index, in netlist order. */
  part: string;
  pin: number;
}

/** A part's symbol: paint the sprite of `key` translated by `translate`. */
export interface SymbolItem {
  id: string;
  key: SpriteKey;
  /** `p.x * CELL - anchor.x`, `p.y * CELL - anchor.y`. */
  translate: Pt;
  hl: boolean;
}

/** Ground or label marker at its connection point; `index` in the drawing. */
export interface MarkerItem {
  index: number;
  x: number;
  y: number;
  hl: boolean;
}

export type GhostItem =
  { kind: "part"; key: SpriteKey; translate: Pt } | { kind: "ground"; x: number; y: number };

export type Outline =
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "wire"; x1: number; y1: number; x2: number; y2: number };

export interface Scene {
  wires: WireItem[];
  dots: DotItem[];
  freePins: PinItem[];
  symbols: SymbolItem[];
  grounds: MarkerItem[];
  labels: MarkerItem[];
  ghost?: GhostItem;
  /** Wire being drawn, as a polyline (repeated points dropped). */
  preview?: Pt[];
  outlines: Outline[];
}

export interface SceneOptions {
  style: SymbolStyle;
  sprites: SpriteCache;
  /** Compiled component of each part id, when the netlist compiles. */
  info?: ReadonlyMap<string, ComponentJSON>;
  /** Connectivity of the drawing, if the caller already has it. */
  conn?: Connectivity;
  /** Part being placed (grid units), or a ground under the cursor. */
  ghost?: { kind: "part"; part: Part } | { kind: "ground"; at: Pt };
  /** Wire being drawn: start, bend(s), end, in grid units. */
  preview?: Pt[];
  selection?: Selection;
  /** Highlighted node names (`0`, `n3`, `out`) and part ids. */
  highlight?: { nodes?: ReadonlySet<string>; parts?: ReadonlySet<string> };
}

const at = (x: number, y: number): string => `${x},${y}`;
const px = (p: Pt): Pt => ({ x: p.x * CELL, y: p.y * CELL });

/** World pixels of padding around a selected part: two-pin symbols are thin lines. */
const PAD_TWO_PIN = 22;
const PAD_OTHER = 12;
/** Ground glyph around its point: 16 px each side, from 6 px above to 32 px below. */
const GROUND = { side: 16, top: 6, bottom: 32 };
const LABEL_PAD = 8;

function symbol(p: Part, opts: SceneOptions, info?: ComponentJSON): GhostItem & { kind: "part" } {
  const key = spriteKey(p, opts.style, info);
  const { anchor } = opts.sprites.get(key);
  return { kind: "part", key, translate: { x: p.x * CELL - anchor.x, y: p.y * CELL - anchor.y } };
}

/** Dots where three or more connections meet (pins, wire ends, wires passing
 * through), and on the user's nodes still on a junction. */
function dots(d: Drawing, conn: Connectivity, hl: (k: string) => boolean): DotItem[] {
  const out = new Map<string, DotItem>();
  for (const [k, n] of conn.degree) {
    const [x, y] = k.split(",").map(Number) as [number, number];
    if (n >= 3) out.set(k, { ...px({ x, y }), user: false, hl: hl(k) });
  }
  for (const q of liveNodes(d.nodes, d.wires)) {
    out.set(at(q.x, q.y), { ...px(q), user: true, hl: hl(at(q.x, q.y)) });
  }
  return [...out.values()];
}

function freePins(d: Drawing): PinItem[] {
  const count = new Map<string, number>();
  for (const p of d.parts)
    for (const q of pinsOf(p)) count.set(at(q.x, q.y), (count.get(at(q.x, q.y)) ?? 0) + 1);
  const markers = new Set([...d.grounds, ...d.labels].map((q) => at(q.x, q.y)));
  return d.parts.flatMap((p) =>
    pinsOf(p).flatMap((q, pin) => {
      const k = at(q.x, q.y);
      const touched =
        (count.get(k) ?? 0) > 1 || markers.has(k) || d.wires.some((w) => onSegment(q, w));
      return touched ? [] : [{ ...px(q), part: p.id, pin }];
    }),
  );
}

/** Box around grid points, padded in world pixels (left and right by `side`). */
function box(pts: Pt[], side: number, top = side, bottom = top): Outline {
  const xs = pts.map((q) => q.x * CELL);
  const ys = pts.map((q) => q.y * CELL);
  const x = Math.min(...xs) - side;
  const y = Math.min(...ys) - top;
  return {
    kind: "rect",
    x,
    y,
    width: Math.max(...xs) + side - x,
    height: Math.max(...ys) + bottom - y,
  };
}

/** Outline of the selected item; none when it no longer exists. */
function outlines(d: Drawing, sel: Selection | undefined): Outline[] {
  if (!sel) return [];
  if (sel.kind === "part") {
    const p = d.parts.find((q) => q.id === sel.id);
    if (!p) return [];
    return [box([...pinsOf(p), ...bodyOf(p)], TWO_TERMINAL.has(p.kind) ? PAD_TWO_PIN : PAD_OTHER)];
  }
  if (sel.kind === "wire") {
    const w = d.wires.find((v) => onSegment(sel.at, v));
    if (!w) return [];
    return [{ kind: "wire", x1: w.x1 * CELL, y1: w.y1 * CELL, x2: w.x2 * CELL, y2: w.y2 * CELL }];
  }
  const q = sel.kind === "ground" ? d.grounds[sel.index] : d.labels[sel.index];
  if (!q) return [];
  // Ground: the glyph hangs below its point. Label: the marker only (its text box is scene-text's).
  return sel.kind === "ground"
    ? [box([q], GROUND.side, GROUND.top, GROUND.bottom)]
    : [box([q], LABEL_PAD)];
}

function polyline(pts: Pt[]): Pt[] {
  return pts.filter((q, i) => i === 0 || q.x !== pts[i - 1]?.x || q.y !== pts[i - 1]?.y).map(px);
}

/** Everything to draw for `d`, in world pixels. */
export function scene(d: Drawing, opts: SceneOptions): Scene {
  const conn = opts.conn ?? connect(d);
  const nodes = opts.highlight?.nodes;
  const parts = opts.highlight?.parts;
  const hl = (k: string): boolean => {
    const n = conn.node.get(k);
    return nodes !== undefined && n !== undefined && nodes.has(n);
  };
  const marker = (q: Pt, index: number): MarkerItem => ({ index, ...px(q), hl: hl(at(q.x, q.y)) });
  const out: Scene = {
    wires: d.wires.map((w, i) => ({
      x1: w.x1 * CELL,
      y1: w.y1 * CELL,
      x2: w.x2 * CELL,
      y2: w.y2 * CELL,
      hl: nodes?.has(conn.wireNode[i] ?? "") ?? false,
    })),
    dots: dots(d, conn, hl),
    freePins: freePins(d),
    symbols: d.parts.map((p) => {
      const { key, translate } = symbol(p, opts, opts.info?.get(p.id));
      return { id: p.id, key, translate, hl: parts?.has(p.id) ?? false };
    }),
    grounds: d.grounds.map(marker),
    labels: d.labels.map(marker),
    outlines: outlines(d, opts.selection),
  };
  const g = opts.ghost;
  if (g) out.ghost = g.kind === "part" ? symbol(g.part, opts) : { kind: "ground", ...px(g.at) };
  if (opts.preview && opts.preview.length > 1) out.preview = polyline(opts.preview);
  return out;
}

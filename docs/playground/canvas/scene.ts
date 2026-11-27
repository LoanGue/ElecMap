/**
 * Scene of the canvas editor: what to draw for a drawing, as plain data in
 * world pixels (`CELL` per grid unit). Wires, junction dots, free pins,
 * symbols (sprite key and translation), ground and label markers, and the
 * highlight flags. No text (scene-text.ts) and no canvas calls (the painter).
 */
import type { ComponentJSON } from "../../../src";
import { onSegment, pinsOf } from "../model";
import type { Drawing, Part, Pt } from "../model";
import { connect } from "../netlist";
import type { Connectivity } from "../netlist";
import { liveNodes } from "../edit/fitting";
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

export interface Scene {
  wires: WireItem[];
  dots: DotItem[];
  freePins: PinItem[];
  symbols: SymbolItem[];
  grounds: MarkerItem[];
  labels: MarkerItem[];
}

export interface SceneOptions {
  style: SymbolStyle;
  sprites: SpriteCache;
  /** Compiled component of each part id, when the netlist compiles. */
  info?: ReadonlyMap<string, ComponentJSON>;
  /** Connectivity of the drawing, if the caller already has it. */
  conn?: Connectivity;
  /** Highlighted node names (`0`, `n3`, `out`) and part ids. */
  highlight?: { nodes?: ReadonlySet<string>; parts?: ReadonlySet<string> };
}

const at = (x: number, y: number): string => `${x},${y}`;
const px = (p: Pt): Pt => ({ x: p.x * CELL, y: p.y * CELL });

/** Sprite key of a part and the translation putting its anchor on the part. */
function symbol(p: Part, opts: SceneOptions, info?: ComponentJSON) {
  const key = spriteKey(p, opts.style, info);
  const { anchor } = opts.sprites.get(key);
  return { key, translate: { x: p.x * CELL - anchor.x, y: p.y * CELL - anchor.y } };
}

/** Dots where three or more connections meet (pins, wire ends, wires passing
 * through), and on the user's nodes still on a junction. */
function dots(d: Drawing, conn: Connectivity, hl: (q: Pt) => boolean): DotItem[] {
  const out = new Map<string, DotItem>();
  for (const [k, n] of conn.degree) {
    const [x, y] = k.split(",").map(Number) as [number, number];
    if (n >= 3) out.set(k, { ...px({ x, y }), user: false, hl: hl({ x, y }) });
  }
  for (const q of liveNodes(d.nodes, d.wires)) {
    out.set(at(q.x, q.y), { ...px(q), user: true, hl: hl(q) });
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

/** Everything to draw for `d`, in world pixels. */
export function scene(d: Drawing, opts: SceneOptions): Scene {
  const conn = opts.conn ?? connect(d);
  const nodes = opts.highlight?.nodes;
  const parts = opts.highlight?.parts;
  // A user node in the middle of a wire is no connection point: take its wire's node.
  const nodeOf = (q: Pt): string | undefined =>
    conn.node.get(at(q.x, q.y)) ?? conn.wireNode[d.wires.findIndex((w) => onSegment(q, w))];
  const hl = (q: Pt): boolean => {
    const n = nodeOf(q);
    return nodes !== undefined && n !== undefined && nodes.has(n);
  };
  const marker = (q: Pt, index: number): MarkerItem => ({ index, ...px(q), hl: hl(q) });
  return {
    wires: d.wires.map((w, i) => ({
      x1: w.x1 * CELL,
      y1: w.y1 * CELL,
      x2: w.x2 * CELL,
      y2: w.y2 * CELL,
      hl: nodes?.has(conn.wireNode[i] ?? "") ?? false,
    })),
    dots: dots(d, conn, hl),
    freePins: freePins(d),
    symbols: d.parts.map((p) => ({
      id: p.id,
      ...symbol(p, opts, opts.info?.get(p.id)),
      hl: parts?.has(p.id) ?? false,
    })),
    grounds: d.grounds.map(marker),
    labels: d.labels.map(marker),
  };
}

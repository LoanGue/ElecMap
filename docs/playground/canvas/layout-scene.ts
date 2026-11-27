/**
 * Scene of the read-only schematic view: the engine's `layoutCircuit` result
 * turned into the same items as the editor's scene (scene.ts), in world
 * pixels, so one painter draws both. Each placed component becomes the part
 * it would be in the editor, which gives its sprite key and anchor.
 */
import type { PlacedComponent, SchematicLayout } from "../../../src";
import { onSegment, TWO_TERMINAL } from "../model";
import type { Kind, Part, Pt } from "../model";
import { symbol } from "./scene";
import type { MarkerItem, Scene, SceneOptions } from "./scene";
import { CELL } from "./sprites";

export type LayoutSceneOptions = Pick<SceneOptions, "style" | "sprites" | "highlight">;

/** Editor kind of a placed component (polarity for transistors). */
function kindOf(c: PlacedComponent): Kind {
  const comp = c.component;
  if (comp.type === "bjt" || comp.type === "mosfet") return comp.polarity;
  return c.type as Kind;
}

/** Editor anchor: first pin (two-terminal), output (op-amp), top pin (transistor). */
function anchorOf(kind: Kind, c: PlacedComponent): Pt {
  const pin = (i: number): Pt => c.pins[i] as Pt;
  if (TWO_TERMINAL.has(kind)) return { x: pin(0).x, y: pin(0).y };
  if (kind === "opamp") return { x: pin(2).x, y: pin(2).y };
  return { x: pin(1).x + 3, y: pin(1).y - 3 };
}

/** The editor part drawn like a placed component. */
export function partOf(c: PlacedComponent): Part {
  const kind = kindOf(c);
  const dir = TWO_TERMINAL.has(kind) ? c.orientation : "right";
  return { id: c.id, kind, ...anchorOf(kind, c), dir, value: "" };
}

/** Everything to draw for an engine layout, in world pixels. No free pins, no labels. */
export function layoutScene(layout: SchematicLayout, opts: LayoutSceneOptions): Scene {
  const nodes = opts.highlight?.nodes;
  const parts = opts.highlight?.parts;
  const lit = (node: string | undefined): boolean =>
    nodes !== undefined && node !== undefined && nodes.has(node);
  // Node under a ground symbol: a pin there, else the net (rail) passing through.
  const nodeAt = (q: Pt): string | undefined =>
    layout.components.flatMap((c) => c.pins).find((p) => p.x === q.x && p.y === q.y)?.node ??
    layout.nets.find((n) => n.segments.some((s) => onSegment(q, s)))?.node;
  return {
    wires: layout.nets.flatMap((n) =>
      n.segments.map((s) => ({
        x1: s.x1 * CELL,
        y1: s.y1 * CELL,
        x2: s.x2 * CELL,
        y2: s.y2 * CELL,
        hl: lit(n.node),
      })),
    ),
    dots: layout.nets.flatMap((n) =>
      n.junctions.map((j) => ({ x: j.x * CELL, y: j.y * CELL, user: false, hl: lit(n.node) })),
    ),
    freePins: [],
    symbols: layout.components.map((c) => ({
      id: c.id,
      ...symbol(partOf(c), opts, c.component),
      hl: parts?.has(c.id) ?? false,
    })),
    grounds: layout.grounds.map((g, index): MarkerItem => ({
      index,
      x: g.x * CELL,
      y: g.y * CELL,
      hl: lit(nodeAt(g)),
    })),
    labels: [],
  };
}

/**
 * Vector sprites of the playground symbols: the drawing ops of one part,
 * rendered once by the engine's `renderSvg` and reused for every part that
 * looks the same. Ids, names and values never enter the key (the text is drawn
 * apart), so R1..Rn share a single sprite. Pure: no DOM, no canvas.
 */
import { renderSvg } from "../../../src";
import type { ComponentJSON, Orientation, SchematicLayout } from "../../../src";
import { pinsOf, TWO_TERMINAL } from "../model";
import type { Kind, Part, Pt } from "../model";
import { placed, stub } from "../symbols";
import { svgOps } from "./svg-ops";
import type { DrawOp } from "./svg-ops";

/** World pixels per grid cell, as in the camera. */
export const CELL = 20;

export type SymbolStyle = "iec" | "ansi";

/**
 * Visual variant a value can switch: an open switch, a current-controlled
 * behavioural source, a sine voltage source (ANSI glyph), a zener diode.
 */
export type Variant = "" | "open" | "current" | "sine" | "zener";

/** What a sprite depends on. `kind` carries the engine type and the polarity. */
export interface SpriteKey {
  kind: Kind;
  /** Always `"right"` for parts that do not rotate (op-amp, transistors). */
  orientation: Orientation;
  style: SymbolStyle;
  variant: Variant;
}

export interface Sprite {
  /** Ops in sprite pixels, origin at the top-left of `bounds`. */
  ops: DrawOp[];
  /** Where the part's anchor (`Part.x`, `Part.y`) sits, in sprite pixels. */
  anchor: Pt;
  /** Box holding every op, in sprite pixels. */
  bounds: { x: number; y: number; width: number; height: number };
}

const NODES = ["a", "b", "c"];

/** Variant shown by a component (compiled `info`, or the part's stand-in). */
function variantOf(c: Record<string, unknown>): Variant {
  if (c["type"] === "switch") return c["closed"] ? "" : "open";
  if (c["type"] === "bsource") return c["kind"] === "current" ? "current" : "";
  if (c["type"] === "diode") return c["bv"] === undefined ? "" : "zener";
  const wave = c["waveform"] as { kind?: string } | undefined;
  if (c["type"] === "vsource" && !c["dc"] && (c["ac"] !== undefined || wave?.kind === "sine"))
    return "sine";
  return "";
}

/** Sprite key of a part, `info` being its compiled component when the netlist compiles. */
export function spriteKey(p: Part, style: SymbolStyle, info?: ComponentJSON): SpriteKey {
  const comp = (info ?? stub(p, [...NODES])) as unknown as Record<string, unknown>;
  const orientation = TWO_TERMINAL.has(p.kind) ? p.dir : "right";
  return { kind: p.kind, orientation, style, variant: variantOf(comp) };
}

export const keyText = (k: SpriteKey): string =>
  `${k.kind}|${k.orientation}|${k.style}|${k.variant}`;

/** Stand-in component showing the key's variant. */
function component(p: Part, variant: Variant): ComponentJSON {
  const c = stub(p, [...NODES]) as unknown as Record<string, unknown>;
  if (variant === "open") c["closed"] = false;
  if (variant === "current") c["kind"] = "current";
  if (variant === "zener") c["bv"] = 5;
  if (variant === "sine") {
    delete c["dc"];
    c["ac"] = { mag: 1 };
  }
  return c as unknown as ComponentJSON;
}

/** Builds the sprite of a key by rendering a one-part layout with the anchor at (0, 0). */
export function buildSprite(key: SpriteKey): Sprite {
  const p: Part = { id: "", kind: key.kind, x: 0, y: 0, dir: key.orientation, value: "" };
  const pins = pinsOf(p);
  const xs = pins.map((q) => q.x);
  const ys = pins.map((q) => q.y);
  const transistor = !TWO_TERMINAL.has(p.kind) && p.kind !== "opamp";
  // renderSvg pads one cell on each side; transistor rings reach past the right pins.
  const bounds = {
    minX: Math.min(...xs),
    maxX: Math.max(...xs) + (transistor ? 1 : 0),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
  const layout: SchematicLayout = {
    components: [placed(p, [...NODES], component(p, key.variant))],
    nets: [],
    grounds: [],
    couplings: [],
    bounds,
  };
  const svg = renderSvg(layout, {
    theme: "none",
    style: key.style,
    showIds: false,
    showValues: false,
    scale: CELL,
  });
  return {
    ops: svgOps(svg),
    anchor: { x: (1 - bounds.minX) * CELL, y: (1 - bounds.minY) * CELL },
    bounds: {
      x: 0,
      y: 0,
      width: (bounds.maxX - bounds.minX + 2) * CELL,
      height: (bounds.maxY - bounds.minY + 2) * CELL,
    },
  };
}

/** Sprites built on first use and kept for the session. */
export class SpriteCache {
  private readonly sprites = new Map<string, Sprite>();

  get(key: SpriteKey): Sprite {
    const text = keyText(key);
    let s = this.sprites.get(text);
    if (!s) this.sprites.set(text, (s = buildSprite(key)));
    return s;
  }

  get size(): number {
    return this.sprites.size;
  }
}

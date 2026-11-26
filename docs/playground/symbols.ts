/**
 * Symbols of the playground editor: how a drawn part becomes a placed
 * component for the engine's renderer, and the small palette icons.
 */
import { renderSvg, valueText } from "../../src";
import type { ComponentJSON, PlacedComponent, SchematicLayout } from "../../src";
import { DEFAULT_VALUE, pinsOf, TWO_TERMINAL } from "./model";
import type { Kind, Part, Pt } from "./model";

/** Engine component type of a palette kind. */
export function typeOf(kind: Kind): ComponentJSON["type"] {
  if (kind === "npn" || kind === "pnp") return "bjt";
  if (kind === "nmos" || kind === "pmos") return "mosfet";
  return kind;
}

/** Stand-in component JSON while the netlist does not compile. */
export function stub(p: Part, nodes: string[]): ComponentJSON {
  const c: Record<string, unknown> = { id: p.id, type: typeOf(p.kind), nodes, value: 0 };
  if (p.kind === "npn" || p.kind === "pnp" || p.kind === "nmos" || p.kind === "pmos")
    c["polarity"] = p.kind;
  if (p.kind === "vsource" || p.kind === "isource") c["dc"] = 1;
  if (p.kind === "switch") c["closed"] = !/off/i.test(p.value);
  if (p.kind === "bsource") {
    c["kind"] = /^\s*i/i.test(p.value) ? "current" : "voltage";
    c["expression"] = "";
  }
  if (p.kind === "nmos" || p.kind === "pmos") (c["nodes"] as string[]).push(nodes[2] as string);
  return c as unknown as ComponentJSON;
}

/** Placed component of a part, its pins on the given nodes. */
export function placed(p: Part, nodes: string[], info: ComponentJSON | undefined): PlacedComponent {
  const pins = pinsOf(p);
  const comp = info ?? stub(p, [...nodes]);
  let value: string;
  try {
    value = info ? valueText(info) : p.value;
  } catch {
    value = p.value;
  }
  let labelAt: PlacedComponent["labelAt"];
  if (TWO_TERMINAL.has(p.kind)) {
    const [a, b] = pins as [Pt, Pt];
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    labelAt =
      a.y === b.y ? { x: cx, y: cy, align: "middle" } : { x: cx + 1.6, y: cy, align: "start" };
  } else if (p.kind === "opamp") labelAt = { x: p.x - 2.2, y: p.y + 2.6, align: "start" };
  else
    labelAt = {
      x: p.x + (p.kind === "npn" || p.kind === "pnp" ? 1.9 : 1.4),
      y: p.y + 3,
      align: "start",
    };
  return {
    id: p.id,
    type: typeOf(p.kind),
    component: comp,
    orientation: TWO_TERMINAL.has(p.kind) ? p.dir : p.kind === "opamp" ? "right" : "down",
    pins: pins.map((q, i) => ({ ...q, node: nodes[i] ?? "", ground: false })),
    label: { id: p.id, value },
    labelAt,
  };
}

/** Small SVG of a part, for the palette. */
export function icon(kind: Kind, style: "iec" | "ansi"): string {
  const p: Part = { id: "", kind, x: 0, y: 0, dir: "right", value: DEFAULT_VALUE[kind] ?? "" };
  const pins = pinsOf(p);
  const xs = pins.map((q) => q.x);
  const ys = pins.map((q) => q.y);
  const pad = kind === "opamp" ? 0.6 : 0.4;
  const bounds = {
    minX: Math.min(...xs),
    maxX:
      Math.max(...xs) +
      (kind === "npn" || kind === "pnp" || kind === "nmos" || kind === "pmos" ? 1 : 0),
    minY: Math.min(...ys) - (TWO_TERMINAL.has(kind) ? 1 + pad : pad + 1),
    maxY: Math.max(...ys) + (TWO_TERMINAL.has(kind) ? 1 + pad : pad + 1),
  };
  const layout: SchematicLayout = {
    components: [placed(p, ["a", "b", "c"], undefined)],
    nets: [],
    grounds: [],
    couplings: [],
    bounds,
  };
  return renderSvg(layout, { theme: "none", style, showIds: false, showValues: false, scale: 7 });
}

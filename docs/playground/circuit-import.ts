/**
 * From a circuit to a drawing: places the parts where the engine's schematic
 * layout puts them, so an example or a netlist can be edited by hand.
 */
import type { ComponentJSON, ElecMap, PlacedNet, SchematicLayout } from "../../src";
import { emptyDrawing, onSegment, TWO_TERMINAL } from "./model";
import type { Drawing, Kind, Pt } from "./model";

function kindOf(c: ComponentJSON): Kind | undefined {
  switch (c.type) {
    case "bjt":
      return c.polarity === "pnp" ? "pnp" : "npn";
    case "mosfet":
      return c.polarity === "pmos" ? "pmos" : "nmos";
    case "coupling":
      return undefined;
    default:
      return c.type as Kind;
  }
}

/**
 * Drawing of a compiled circuit, from the automatic layout. Elements that
 * cannot be drawn (couplings) and `.model` cards go to the directives; named
 * nodes keep their names through labels.
 */
export function fromCircuit(circuit: ElecMap): Drawing {
  const layout = circuit.layout({ ground: "symbols" });
  const spice = circuit.toSpice().split(/\r?\n/);
  const lineOf = new Map<string, string[]>();
  const directives: string[] = [];
  for (const line of spice) {
    const tokens = line.trim().split(/\s+/);
    const first = tokens[0] ?? "";
    if (first === "" || first.startsWith("*") || /^\.end$/i.test(first)) continue;
    if (first.startsWith(".")) directives.push(line.trim());
    else lineOf.set(first.toUpperCase(), tokens);
  }
  const dx = 2 - layout.bounds.minX;
  const dy = 2 - layout.bounds.minY;
  const d = emptyDrawing();
  const tails: string[] = [];
  for (const c of layout.components) {
    const kind = kindOf(c.component);
    const tokens = lineOf.get(c.id.toUpperCase()) ?? [];
    lineOf.delete(c.id.toUpperCase());
    if (!kind) continue;
    let tail = tokens.slice(1 + ("nodes" in c.component ? c.component.nodes.length : 2));
    if (kind === "opamp") tail = tail.slice(1);
    tails.push(...tail);
    const pins = c.pins;
    let anchor: Pt;
    if (TWO_TERMINAL.has(kind)) anchor = pins[0] as Pt;
    else if (kind === "opamp") anchor = pins[2] as Pt;
    else {
      const a = pins[0] as Pt;
      const b = pins[2] as Pt;
      anchor = a.y < b.y ? a : b;
    }
    d.parts.push({
      id: c.id,
      kind,
      x: anchor.x + dx,
      y: anchor.y + dy,
      dir: c.orientation,
      value: tail.join(" "),
    });
  }
  // Couplings and anything else the layout does not draw.
  for (const tokens of lineOf.values()) directives.unshift(tokens.join(" "));
  for (const net of layout.nets) {
    for (const s of net.segments) {
      d.wires.push({ x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy });
    }
  }
  for (const g of layout.grounds) d.grounds.push({ x: g.x + dx, y: g.y + dy });
  // Labels keep named nodes, and numbered ones that other lines refer to.
  const referred = new Set([...tails, ...directives.flatMap((l) => l.split(/[\s(),=]+/))]);
  for (const net of layout.nets) {
    if (net.ground || circuit.circuit.isGround(net.node)) continue;
    if (/^\d+$/.test(net.node) && !referred.has(net.node)) continue;
    const at = labelPoint(net, layout);
    if (at) d.labels.push({ x: at.x + dx, y: at.y + dy, name: net.node });
  }
  d.directives = directives.join("\n");
  return d;
}

/** A point of the net for its label: the layout's choice when it is on the net. */
function labelPoint(net: PlacedNet, layout: SchematicLayout): Pt | undefined {
  const on = (p: Pt) =>
    net.segments.some((s) => onSegment(p, s)) ||
    layout.components.some((c) =>
      c.pins.some((q) => q.node === net.node && q.x === p.x && q.y === p.y),
    );
  const at = { x: Math.round(net.labelAt.x), y: Math.round(net.labelAt.y) };
  if (on(at)) return at;
  const s = net.segments[0];
  if (s) return { x: s.x1, y: s.y1 };
  for (const c of layout.components) {
    const q = c.pins.find((p) => p.node === net.node);
    if (q) return q;
  }
  return undefined;
}

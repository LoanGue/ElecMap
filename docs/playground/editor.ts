/**
 * Block editor of the playground: components are placed on a grid and wired by
 * hand; the drawing is turned into a SPICE netlist. It is drawn with the
 * engine's own renderer (`renderSvg`), so it looks like the schematics.
 */
import { renderSvg, valueText } from "../../src";
import type {
  ComponentJSON,
  ElecMap,
  Orientation,
  PlacedComponent,
  PlacedNet,
  SchematicLayout,
} from "../../src";
import type { Strings } from "./i18n";

// ------------------------------------------------------------------ model

export type Kind =
  | "resistor"
  | "capacitor"
  | "inductor"
  | "vsource"
  | "isource"
  | "diode"
  | "switch"
  | "opamp"
  | "npn"
  | "pnp"
  | "nmos"
  | "pmos"
  | "vcvs"
  | "vccs"
  | "cccs"
  | "ccvs";

export interface Part {
  id: string;
  kind: Kind;
  /** Anchor: first pin (two-terminal), output (op-amp), top pin (transistor). */
  x: number;
  y: number;
  dir: Orientation;
  /** Rest of the netlist line, after the nodes (`1k`, `DC 5 AC 1`, `NPN`…). */
  value: string;
}

export interface Wire {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface Pt {
  x: number;
  y: number;
}

export interface NetLabel extends Pt {
  name: string;
}

export interface Drawing {
  parts: Part[];
  wires: Wire[];
  grounds: Pt[];
  labels: NetLabel[];
  /** Extra netlist lines: `.model`, `.param`, `K…`. */
  directives: string;
}

export const emptyDrawing = (): Drawing => ({
  parts: [],
  wires: [],
  grounds: [],
  labels: [],
  directives: "",
});

const PREFIX: Record<Kind, string> = {
  resistor: "R",
  capacitor: "C",
  inductor: "L",
  vsource: "V",
  isource: "I",
  diode: "D",
  switch: "S",
  opamp: "X",
  npn: "Q",
  pnp: "Q",
  nmos: "M",
  pmos: "M",
  vcvs: "E",
  vccs: "G",
  cccs: "F",
  ccvs: "H",
};

const DEFAULT_VALUE: Partial<Record<Kind, string>> = {
  resistor: "1k",
  capacitor: "100n",
  inductor: "10m",
  vsource: "DC 5 AC 1",
  isource: "DC 1m",
  switch: "ON",
  npn: "NPN",
  pnp: "PNP",
  nmos: "NMOS",
  pmos: "PMOS",
};

/** Components offered in the palette, in order. */
export const PALETTE: Kind[] = [
  "resistor",
  "capacitor",
  "inductor",
  "vsource",
  "isource",
  "diode",
  "switch",
  "opamp",
  "npn",
  "pnp",
  "nmos",
  "pmos",
];

const TWO_TERMINAL = new Set<Kind>([
  "resistor",
  "capacitor",
  "inductor",
  "vsource",
  "isource",
  "diode",
  "switch",
  "vcvs",
  "vccs",
  "cccs",
  "ccvs",
]);

const DIRS: Record<Orientation, [number, number]> = {
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
  up: [0, -1],
};
const TURN: Record<Orientation, Orientation> = {
  right: "down",
  down: "left",
  left: "up",
  up: "right",
};

const key = (x: number, y: number): string => `${x},${y}`;

/** Pin positions, in netlist order. */
export function pinsOf(p: Part): Pt[] {
  if (TWO_TERMINAL.has(p.kind)) {
    const [dx, dy] = DIRS[p.dir];
    return [
      { x: p.x, y: p.y },
      { x: p.x + 4 * dx, y: p.y + 4 * dy },
    ];
  }
  if (p.kind === "opamp") {
    return [
      { x: p.x - 5, y: p.y + 1 },
      { x: p.x - 5, y: p.y - 1 },
      { x: p.x, y: p.y },
    ];
  }
  const topFirst = p.kind === "npn" || p.kind === "nmos";
  const top = { x: p.x, y: p.y };
  const bottom = { x: p.x, y: p.y + 6 };
  return [topFirst ? top : bottom, { x: p.x - 3, y: p.y + 3 }, topFirst ? bottom : top];
}

/** Offset from the anchor to the visual centre (used to place and rotate). */
function centerOffset(kind: Kind, dir: Orientation): Pt {
  if (TWO_TERMINAL.has(kind)) {
    const [dx, dy] = DIRS[dir];
    return { x: 2 * dx, y: 2 * dy };
  }
  return kind === "opamp" ? { x: -2, y: 0 } : { x: -1, y: 3 };
}

export const rotatable = (kind: Kind): boolean => TWO_TERMINAL.has(kind);

function onSegment(p: Pt, w: Wire): boolean {
  if (w.x1 === w.x2) {
    return p.x === w.x1 && p.y >= Math.min(w.y1, w.y2) && p.y <= Math.max(w.y1, w.y2);
  }
  if (w.y1 === w.y2) {
    return p.y === w.y1 && p.x >= Math.min(w.x1, w.x2) && p.x <= Math.max(w.x1, w.x2);
  }
  return false;
}

/** Distance from a point to a segment (grid units). */
function distance(p: Pt, w: Wire): number {
  const vx = w.x2 - w.x1;
  const vy = w.y2 - w.y1;
  const len = vx * vx + vy * vy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - w.x1) * vx + (p.y - w.y1) * vy) / len));
  return Math.hypot(p.x - (w.x1 + t * vx), p.y - (w.y1 + t * vy));
}

// ----------------------------------------------------------- connectivity

export interface Connectivity {
  /** Node name of every connection point (`x,y`). */
  node: Map<string, string>;
  /** Node of each wire, by index. */
  wireNode: string[];
  /** Number of connections at each point (junction dots at ≥ 3). */
  degree: Map<string, number>;
}

/**
 * Electrical nodes of a drawing. Wire ends connect to whatever lies at that
 * point (pins, other wires, even in their middle); crossing wires do not
 * connect. Ground symbols are node `0`, labels with the same name are the
 * same node, other nodes are named `n1`, `n2`… from top-left.
 */
export function connect(d: Drawing): Connectivity {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r) as string;
    parent.set(k, r);
    return r;
  };
  const add = (k: string) => {
    if (!parent.has(k)) parent.set(k, k);
  };
  const union = (a: string, b: string) => {
    add(a);
    add(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const degree = new Map<string, number>();
  const bump = (k: string, n = 1) => degree.set(k, (degree.get(k) ?? 0) + n);

  const points: Pt[] = [];
  for (const p of d.parts) {
    for (const q of pinsOf(p)) {
      add(key(q.x, q.y));
      bump(key(q.x, q.y));
      points.push(q);
    }
  }
  for (const w of d.wires) {
    union(key(w.x1, w.y1), key(w.x2, w.y2));
    bump(key(w.x1, w.y1));
    bump(key(w.x2, w.y2));
    points.push({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 });
  }
  for (const g of d.grounds) add(key(g.x, g.y));
  for (const l of d.labels) add(key(l.x, l.y));
  points.push(...d.grounds, ...d.labels);
  const seen = new Set<string>();
  for (const w of d.wires) {
    for (const p of points) {
      const k = key(p.x, p.y);
      if (!onSegment(p, w)) continue;
      union(k, key(w.x1, w.y1));
      const end = (p.x === w.x1 && p.y === w.y1) || (p.x === w.x2 && p.y === w.y2);
      // A point in the middle of a wire counts twice (the wire goes on).
      if (!end && !seen.has(`${k}|${w.x1},${w.y1},${w.x2},${w.y2}`)) {
        seen.add(`${k}|${w.x1},${w.y1},${w.x2},${w.y2}`);
        bump(k, 2);
      }
    }
  }
  const grounds = d.grounds.map((g) => key(g.x, g.y));
  for (const g of grounds.slice(1)) union(g, grounds[0] as string);
  const byName = new Map<string, string>();
  for (const l of d.labels) {
    const k = key(l.x, l.y);
    const other = byName.get(l.name);
    if (other) union(k, other);
    else byName.set(l.name, k);
  }

  // Names: ground, then labels, then n1, n2… in reading order.
  const names = new Map<string, string>();
  for (const g of grounds) names.set(find(g), "0");
  for (const l of d.labels) {
    const r = find(key(l.x, l.y));
    if (!names.has(r)) names.set(r, l.name);
  }
  const used = new Set(names.values());
  const roots = new Map<string, Pt>();
  for (const k of parent.keys()) {
    const r = find(k);
    const [x, y] = k.split(",").map(Number) as [number, number];
    const best = roots.get(r);
    if (!best || y < best.y || (y === best.y && x < best.x)) roots.set(r, { x, y });
  }
  let n = 1;
  for (const [r] of [...roots].sort((a, b) => a[1].y - b[1].y || a[1].x - b[1].x)) {
    if (names.has(r)) continue;
    while (used.has(`n${n}`)) n++;
    names.set(r, `n${n}`);
    used.add(`n${n}`);
  }
  const node = new Map<string, string>();
  for (const k of parent.keys()) node.set(k, names.get(find(k)) as string);
  return {
    node,
    wireNode: d.wires.map((w) => node.get(key(w.x1, w.y1)) as string),
    degree,
  };
}

// ---------------------------------------------------------------- netlist

/** SPICE netlist of a drawing. */
export function toNetlist(d: Drawing, conn = connect(d)): string {
  const lines = ["* Drawn in the ElecMap playground"];
  for (const p of d.parts) {
    const nodes = pinsOf(p).map((q) => conn.node.get(key(q.x, q.y)) as string);
    const value = p.value.trim();
    if (p.kind === "opamp") lines.push(`${p.id} ${nodes.join(" ")} OPAMP ${value}`.trim());
    else if (p.kind === "nmos" || p.kind === "pmos") {
      const model = value || (p.kind === "nmos" ? "NMOS" : "PMOS");
      lines.push(`${p.id} ${nodes.join(" ")} ${nodes[2] as string} ${model}`);
    } else if (p.kind === "npn" || p.kind === "pnp") {
      lines.push(`${p.id} ${nodes.join(" ")} ${value || p.kind.toUpperCase()}`);
    } else lines.push(`${p.id} ${nodes.join(" ")} ${value}`.trim());
  }
  const extra = d.directives.trim();
  if (extra) lines.push(extra);
  return `${lines.join("\n")}\n`;
}

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

// --------------------------------------------------------------- drawing

const U = 20;
/** Grid point → pixel (the renderer pads by one cell, bounds start at 0). */
const px = (v: number) => v * U + U;

function typeOf(kind: Kind): ComponentJSON["type"] {
  if (kind === "npn" || kind === "pnp") return "bjt";
  if (kind === "nmos" || kind === "pmos") return "mosfet";
  return kind;
}

/** Stand-in component JSON while the netlist does not compile. */
function stub(p: Part, nodes: string[]): ComponentJSON {
  const c: Record<string, unknown> = { id: p.id, type: typeOf(p.kind), nodes, value: 0 };
  if (p.kind === "npn" || p.kind === "pnp" || p.kind === "nmos" || p.kind === "pmos")
    c["polarity"] = p.kind;
  if (p.kind === "vsource" || p.kind === "isource") c["dc"] = 1;
  if (p.kind === "switch") c["closed"] = !/off/i.test(p.value);
  if (p.kind === "nmos" || p.kind === "pmos") (c["nodes"] as string[]).push(nodes[2] as string);
  return c as unknown as ComponentJSON;
}

function placed(p: Part, nodes: string[], info: ComponentJSON | undefined): PlacedComponent {
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

// ----------------------------------------------------------------- editor

export interface EditorHost {
  t: Strings;
  style(): "iec" | "ansi";
  /** The drawing changed: new netlist. */
  changed(netlist: string): void;
  /** A wire or a component was clicked (probe, as on the schematic). */
  probe(kind: "node" | "part", value: string): void;
  /** Marks probed nodes / parts on the drawing. */
  decorate(svg: SVGSVGElement): void;
}

type Tool =
  | { kind: "select" }
  | { kind: "wire" }
  | { kind: "place"; part: Kind }
  | { kind: "ground" }
  | { kind: "label" };

type Selection =
  | { kind: "part"; id: string }
  | { kind: "wire"; index: number }
  | { kind: "ground"; index: number }
  | { kind: "label"; index: number };

type Drag =
  | { kind: "move"; sel: Selection; start: Pt; from: Drawing; moved: boolean }
  | { kind: "wire"; start: Pt; temporary: boolean };

export class Editor {
  drawing: Drawing = emptyDrawing();
  private conn: Connectivity = connect(this.drawing);
  private info = new Map<string, ComponentJSON>();
  private tool: Tool = { kind: "select" };
  private dir: Orientation = "right";
  private selection: Selection | undefined;
  private drag: Drag | undefined;
  private cursor: Pt | undefined;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private readonly canvas: HTMLElement;
  private readonly props: HTMLElement;
  private readonly status: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly host: EditorHost,
  ) {
    const t = host.t.editor;
    root.innerHTML = `
<div class="ed-toolbar" role="toolbar">
  <div class="ed-group">
    <button data-tool="select" title="${t.select} (V)">${SELECT_ICON}<span>${t.selectShort}</span></button>
    <button data-tool="wire" title="${t.wire} (W)">${WIRE_ICON}<span>${t.wireShort}</span></button>
  </div>
  <div class="ed-group ed-palette"></div>
  <div class="ed-group">
    <button data-tool="ground" title="${t.ground} (G)">${GROUND_ICON}<span>${t.groundShort}</span></button>
    <button data-tool="label" title="${t.label} (N)">${LABEL_ICON}<span>${t.labelShort}</span></button>
  </div>
  <div class="ed-group ed-actions">
    <button data-action="rotate" title="${t.rotate} (R)">⟳</button>
    <button data-action="delete" title="${t.delete} (Del)">🗑</button>
    <button data-action="undo" title="${t.undo} (Ctrl+Z)">↶</button>
    <button data-action="redo" title="${t.redo} (Ctrl+Y)">↷</button>
    <button data-action="clear" title="${t.clear}" class="ed-text">${t.clear}</button>
  </div>
</div>
<div class="ed-canvas" tabindex="0" aria-label="${t.canvas}"></div>
<div class="ed-status"></div>
<div class="ed-props"></div>`;
    this.canvas = root.querySelector(".ed-canvas") as HTMLElement;
    this.props = root.querySelector(".ed-props") as HTMLElement;
    this.status = root.querySelector(".ed-status") as HTMLElement;
    this.palette();
    this.bind();
  }

  // ---------------------------------------------------------------- API

  load(d: Drawing): void {
    this.drawing = d;
    this.selection = undefined;
    this.undoStack = [];
    this.redoStack = [];
    this.update(false);
  }

  /** Values of the compiled circuit (labels), after the host compiled the netlist. */
  setCircuit(circuit: ElecMap | undefined): void {
    this.info = new Map((circuit?.components() ?? []).map((c) => [c.id, c]));
    this.render();
  }

  netlist(): string {
    return toNetlist(this.drawing, this.conn);
  }

  setDirectives(text: string): void {
    if (text === this.drawing.directives) return;
    this.snapshot();
    this.drawing.directives = text;
    this.update();
  }

  palette(): void {
    const t = this.host.t;
    const style = this.host.style();
    (this.root.querySelector(".ed-palette") as HTMLElement).innerHTML = PALETTE.map((k) => {
      const name = t.editor.parts[k] ?? k;
      return `<button data-part="${k}" title="${name}" aria-label="${name}">${icon(k, style)}</button>`;
    }).join("");
    this.toolbar();
  }

  // ------------------------------------------------------------- editing

  private snapshot(): void {
    this.undoStack.push(JSON.stringify(this.drawing));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  private restore(from: string[], to: string[]): void {
    const s = from.pop();
    if (s === undefined) return;
    to.push(JSON.stringify(this.drawing));
    this.drawing = JSON.parse(s) as Drawing;
    this.selection = undefined;
    this.update();
  }

  /** Recomputes the nodes, redraws and (optionally) tells the host. */
  private update(notify = true): void {
    this.conn = connect(this.drawing);
    this.render();
    this.renderProps();
    if (notify) this.host.changed(this.netlist());
  }

  private nextId(kind: Kind): string {
    const prefix = PREFIX[kind];
    const used = new Set(this.drawing.parts.map((p) => p.id.toUpperCase()));
    let n = 1;
    while (used.has(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  }

  private ghost(kind: Kind, at: Pt): Part {
    const o = centerOffset(kind, this.dir);
    return {
      id: this.nextId(kind),
      kind,
      x: at.x - o.x,
      y: at.y - o.y,
      dir: TWO_TERMINAL.has(kind) ? this.dir : "right",
      value: DEFAULT_VALUE[kind] ?? "",
    };
  }

  private place(kind: Kind, at: Pt): void {
    this.snapshot();
    const p = this.ghost(kind, at);
    this.drawing.parts.push(p);
    // Dropped on a wire: the part replaces the piece of wire between its pins.
    if (TWO_TERMINAL.has(kind)) {
      const [a, b] = pinsOf(p) as [Pt, Pt];
      const i = this.drawing.wires.findIndex((w) => onSegment(a, w) && onSegment(b, w));
      const w = this.drawing.wires[i];
      if (w) {
        const s = { x: w.x1, y: w.y1 };
        const e = { x: w.x2, y: w.y2 };
        const near = (q: Pt, r: Pt, o: Pt) =>
          Math.hypot(q.x - r.x, q.y - r.y) <= Math.hypot(q.x - o.x, q.y - o.y) ? r : o;
        const ns = near(s, a, b);
        const ne = ns === a ? b : a;
        this.drawing.wires.splice(
          i,
          1,
          ...[
            { x1: s.x, y1: s.y, x2: ns.x, y2: ns.y },
            { x1: ne.x, y1: ne.y, x2: e.x, y2: e.y },
          ].filter((v) => v.x1 !== v.x2 || v.y1 !== v.y2),
        );
      }
    }
    this.selection = { kind: "part", id: p.id };
    this.update();
  }

  /** Adds an L-shaped wire from `a` to `b` (horizontal first unless it starts vertical). */
  private addWire(a: Pt, b: Pt): void {
    if (a.x === b.x && a.y === b.y) return;
    const corner = this.corner(a, b);
    for (const [p, q] of [
      [a, corner],
      [corner, b],
    ] as [Pt, Pt][]) {
      if (p.x === q.x && p.y === q.y) continue;
      const w = { x1: p.x, y1: p.y, x2: q.x, y2: q.y };
      const dup = this.drawing.wires.some(
        (v) =>
          (v.x1 === w.x1 && v.y1 === w.y1 && v.x2 === w.x2 && v.y2 === w.y2) ||
          (v.x1 === w.x2 && v.y1 === w.y2 && v.x2 === w.x1 && v.y2 === w.y1),
      );
      if (!dup) this.drawing.wires.push(w);
    }
  }

  /** Bend of the wire preview: leave a vertical pin vertically. */
  private corner(a: Pt, b: Pt): Pt {
    const pin = this.drawing.parts
      .flatMap((p) => pinsOf(p).map((q, i) => ({ p, q, i })))
      .find(({ q }) => q.x === a.x && q.y === a.y);
    let vertical = false;
    if (pin) {
      const pins = pinsOf(pin.p);
      const other = pins[pin.i === 0 ? 1 : 0] as Pt;
      vertical = TWO_TERMINAL.has(pin.p.kind)
        ? other.x === a.x
        : pin.i !== 1 && pin.p.kind !== "opamp";
    }
    return vertical ? { x: a.x, y: b.y } : { x: b.x, y: a.y };
  }

  private remove(sel: Selection): void {
    this.snapshot();
    const d = this.drawing;
    if (sel.kind === "part") d.parts = d.parts.filter((p) => p.id !== sel.id);
    else if (sel.kind === "wire") d.wires.splice(sel.index, 1);
    else if (sel.kind === "ground") d.grounds.splice(sel.index, 1);
    else d.labels.splice(sel.index, 1);
    this.selection = undefined;
    this.update();
  }

  private rotate(): void {
    const sel = this.selection;
    if (this.tool.kind === "place") {
      this.dir = TURN[this.dir];
      this.render();
      return;
    }
    if (sel?.kind !== "part") return;
    const p = this.drawing.parts.find((q) => q.id === sel.id);
    if (!p || !rotatable(p.kind)) return;
    this.snapshot();
    const o = centerOffset(p.kind, p.dir);
    const c = { x: p.x + o.x, y: p.y + o.y };
    p.dir = TURN[p.dir];
    const n = centerOffset(p.kind, p.dir);
    p.x = c.x - n.x;
    p.y = c.y - n.y;
    this.update();
  }

  /**
   * Moves the selection by `(dx, dy)` from the drawing `from`; wire ends on the
   * moved pins follow, with a bend when they would go diagonal.
   */
  private moved(from: Drawing, sel: Selection, dx: number, dy: number): Drawing {
    const d = JSON.parse(JSON.stringify(from)) as Drawing;
    let points: Pt[] = [];
    if (sel.kind === "part") {
      const p = d.parts.find((q) => q.id === sel.id);
      if (!p) return d;
      points = pinsOf(p);
      p.x += dx;
      p.y += dy;
    } else if (sel.kind === "ground" || sel.kind === "label") {
      const g = sel.kind === "ground" ? d.grounds[sel.index] : d.labels[sel.index];
      if (!g) return d;
      points = [{ ...g }];
      g.x += dx;
      g.y += dy;
    } else {
      const w = d.wires[sel.index];
      if (!w) return d;
      points = [
        { x: w.x1, y: w.y1 },
        { x: w.x2, y: w.y2 },
      ];
      w.x1 += dx;
      w.x2 += dx;
      w.y1 += dy;
      w.y2 += dy;
    }
    if (dx === 0 && dy === 0) return d;
    const hit = (x: number, y: number) => points.some((q) => q.x === x && q.y === y);
    const out: Wire[] = [];
    d.wires.forEach((w, i) => {
      if (sel.kind === "wire" && i === sel.index) {
        out.push(w);
        return;
      }
      const h1 = hit(w.x1, w.y1);
      const h2 = hit(w.x2, w.y2);
      if (!h1 && !h2) {
        out.push(w);
        return;
      }
      const vertical = w.x1 === w.x2;
      const a = { x: w.x1 + (h1 ? dx : 0), y: w.y1 + (h1 ? dy : 0) };
      const b = { x: w.x2 + (h2 ? dx : 0), y: w.y2 + (h2 ? dy : 0) };
      if (a.x === b.x || a.y === b.y) out.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      else {
        // Keep the fixed end's direction, bend near the moved end.
        const fixed = h1 ? b : a;
        const moving = h1 ? a : b;
        const c = vertical ? { x: fixed.x, y: moving.y } : { x: moving.x, y: fixed.y };
        out.push(
          { x1: fixed.x, y1: fixed.y, x2: c.x, y2: c.y },
          { x1: c.x, y1: c.y, x2: moving.x, y2: moving.y },
        );
      }
    });
    d.wires = out.filter((w) => w.x1 !== w.x2 || w.y1 !== w.y2);
    return d;
  }

  // ------------------------------------------------------------ hit tests

  private pins(): Pt[] {
    return this.drawing.parts.flatMap(pinsOf);
  }

  /** Grid point under the pointer, and the exact position. */
  private at(e: PointerEvent | MouseEvent): { grid: Pt; exact: Pt } {
    const svg = this.canvas.querySelector("svg");
    const r = (svg ?? this.canvas).getBoundingClientRect();
    const exact = { x: (e.clientX - r.left - U) / U, y: (e.clientY - r.top - U) / U };
    return { grid: { x: Math.round(exact.x), y: Math.round(exact.y) }, exact };
  }

  private hit(e: PointerEvent, exact: Pt): Selection | undefined {
    const d = this.drawing;
    const near = (p: Pt, r: number) => Math.hypot(p.x - exact.x, p.y - exact.y) < r;
    const label = d.labels.findIndex(
      (l) =>
        near(l, 0.6) ||
        (exact.y < l.y &&
          exact.y > l.y - 1.35 &&
          exact.x > l.x - 0.3 &&
          exact.x < l.x + 0.3 + l.name.length * 0.36),
    );
    if (label >= 0) return { kind: "label", index: label };
    const ground = d.grounds.findIndex(
      (g) => exact.y >= g.y - 0.3 && exact.y <= g.y + 1.8 && Math.abs(exact.x - g.x) < 0.8,
    );
    if (ground >= 0) return { kind: "ground", index: ground };
    const part = (e.target as Element).closest?.<SVGElement>("g[data-id], [data-hit]");
    const id = part?.dataset["id"] ?? part?.dataset["hit"];
    if (id && d.parts.some((p) => p.id === id)) return { kind: "part", id };
    let best = -1;
    let dist = 0.35;
    d.wires.forEach((w, i) => {
      const v = distance(exact, w);
      if (v < dist) {
        dist = v;
        best = i;
      }
    });
    if (best >= 0) return { kind: "wire", index: best };
    // Bodies, by geometry (clicks between the strokes of a symbol).
    for (const p of [...d.parts].reverse()) {
      const o = centerOffset(p.kind, p.dir);
      const c = { x: p.x + o.x, y: p.y + o.y };
      const horizontal = TWO_TERMINAL.has(p.kind) && (p.dir === "left" || p.dir === "right");
      const [w, h] = TWO_TERMINAL.has(p.kind) ? (horizontal ? [1.6, 0.9] : [0.9, 1.6]) : [2.2, 2.2];
      if (Math.abs(exact.x - c.x) <= w && Math.abs(exact.y - c.y) <= h)
        return { kind: "part", id: p.id };
    }
    return undefined;
  }

  /** A connection point (pin, wire, ground, label) at a grid point. */
  private connectable(p: Pt): boolean {
    return this.conn.node.has(key(p.x, p.y)) || this.drawing.wires.some((w) => onSegment(p, w));
  }

  // -------------------------------------------------------------- events

  private bind(): void {
    const c = this.canvas;
    this.root.querySelector(".ed-toolbar")?.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>("button");
      if (!b) return;
      const tool = b.dataset["tool"];
      const part = b.dataset["part"] as Kind | undefined;
      const action = b.dataset["action"];
      if (tool) this.setTool({ kind: tool } as Tool);
      else if (part) this.setTool({ kind: "place", part });
      else if (action === "rotate") this.rotate();
      else if (action === "delete" && this.selection) this.remove(this.selection);
      else if (action === "undo") this.restore(this.undoStack, this.redoStack);
      else if (action === "redo") this.restore(this.redoStack, this.undoStack);
      else if (action === "clear") {
        this.snapshot();
        this.drawing = emptyDrawing();
        this.selection = undefined;
        this.update();
      }
      c.focus();
    });
    c.addEventListener("pointerdown", (e) => this.onDown(e));
    c.addEventListener("pointermove", (e) => this.onMove(e));
    c.addEventListener("pointerup", (e) => this.onUp(e));
    c.addEventListener("pointerleave", () => {
      this.cursor = undefined;
      if (this.tool.kind !== "select") this.render();
    });
    c.addEventListener("dblclick", (e) => {
      if (this.drag?.kind === "wire") {
        this.drag = undefined;
        this.render();
        return;
      }
      const sel = this.hit(e as PointerEvent, this.at(e).exact);
      if (sel) {
        this.selection = sel;
        this.renderProps();
        const input = this.props.querySelector<HTMLInputElement>(
          "[data-prop='value'], [data-prop='name']",
        );
        input?.focus();
        input?.select();
      }
    });
    c.addEventListener("keydown", (e) => this.onKey(e));
    this.props.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      this.setProp(input.dataset["prop"] ?? "", input.value);
    });
    this.props.addEventListener("keydown", (e) => {
      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
    });
    this.props.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>("button[data-action]");
      if (b?.dataset["action"] === "rotate") this.rotate();
      if (b?.dataset["action"] === "delete" && this.selection) this.remove(this.selection);
    });
  }

  private capture(e: PointerEvent): void {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic or finished pointer */
    }
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    this.drag = undefined;
    if (tool.kind !== "select") this.selection = undefined;
    this.toolbar();
    this.render();
    this.renderProps();
  }

  private toolbar(): void {
    for (const b of this.root.querySelectorAll<HTMLButtonElement>(".ed-toolbar button")) {
      const on =
        (b.dataset["tool"] !== undefined && b.dataset["tool"] === this.tool.kind) ||
        (this.tool.kind === "place" && b.dataset["part"] === this.tool.part);
      b.classList.toggle("on", on);
    }
    this.canvas.dataset["tool"] = this.tool.kind;
  }

  private onKey(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") {
      e.preventDefault();
      if (e.shiftKey) this.restore(this.redoStack, this.undoStack);
      else this.restore(this.undoStack, this.redoStack);
    } else if ((e.ctrlKey || e.metaKey) && k === "y") {
      e.preventDefault();
      this.restore(this.redoStack, this.undoStack);
    } else if (e.ctrlKey || e.metaKey || e.altKey) return;
    else if (k === "escape") {
      if (this.drag) {
        this.drag = undefined;
        this.render();
      } else if (this.tool.kind !== "select") this.setTool({ kind: "select" });
      else {
        this.selection = undefined;
        this.render();
        this.renderProps();
      }
    } else if (k === "delete" || k === "backspace") {
      if (this.selection) {
        e.preventDefault();
        this.remove(this.selection);
      }
    } else if (k === "r") this.rotate();
    else if (k === "w") this.setTool({ kind: "wire" });
    else if (k === "v") this.setTool({ kind: "select" });
    else if (k === "g") this.setTool({ kind: "ground" });
    else if (k === "n") this.setTool({ kind: "label" });
  }

  private onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const { grid, exact } = this.at(e);
    this.canvas.focus();
    const tool = this.tool;
    if (tool.kind === "place") {
      this.place(tool.part, grid);
      if (!e.shiftKey) this.setTool({ kind: "select" });
      return;
    }
    if (tool.kind === "ground") {
      this.snapshot();
      this.drawing.grounds.push(grid);
      this.selection = { kind: "ground", index: this.drawing.grounds.length - 1 };
      if (!e.shiftKey) this.setTool({ kind: "select" });
      this.update();
      return;
    }
    if (tool.kind === "label") {
      this.snapshot();
      const used = new Set(this.drawing.labels.map((l) => l.name));
      const name =
        ["in", "out", "a", "b", "c", "d"].find((n) => !used.has(n)) ?? `x${used.size + 1}`;
      this.drawing.labels.push({ ...grid, name });
      this.selection = { kind: "label", index: this.drawing.labels.length - 1 };
      this.setTool({ kind: "select" });
      this.update();
      const input = this.props.querySelector<HTMLInputElement>("[data-prop='name']");
      input?.focus();
      input?.select();
      return;
    }
    if (tool.kind === "wire") {
      if (this.drag?.kind === "wire") {
        this.snapshot();
        this.addWire(this.drag.start, grid);
        const end =
          this.connectable(grid) && (grid.x !== this.drag.start.x || grid.y !== this.drag.start.y);
        this.drag = end ? undefined : { kind: "wire", start: grid, temporary: false };
        this.update();
      } else this.drag = { kind: "wire", start: grid, temporary: false };
      this.render();
      return;
    }
    // Select tool: a pin starts a wire.
    const pin = this.pins().find((q) => Math.hypot(q.x - exact.x, q.y - exact.y) < 0.4);
    if (pin) {
      this.drag = { kind: "wire", start: pin, temporary: true };
      this.capture(e);
      return;
    }
    const sel = this.hit(e, exact);
    this.selection = sel;
    if (sel) {
      this.drag = {
        kind: "move",
        sel,
        start: grid,
        from: JSON.parse(JSON.stringify(this.drawing)) as Drawing,
        moved: false,
      };
      this.capture(e);
    }
    this.render();
    this.renderProps();
  }

  private onMove(e: PointerEvent): void {
    const { grid, exact } = this.at(e);
    const changed = !this.cursor || this.cursor.x !== grid.x || this.cursor.y !== grid.y;
    this.cursor = grid;
    const drag = this.drag;
    if (drag?.kind === "move") {
      const dx = grid.x - drag.start.x;
      const dy = grid.y - drag.start.y;
      if (!changed) return;
      if (dx !== 0 || dy !== 0) drag.moved = true;
      this.drawing = this.moved(drag.from, drag.sel, dx, dy);
      this.conn = connect(this.drawing);
      this.render();
      return;
    }
    if (this.tool.kind !== "select" || drag?.kind === "wire") {
      if (changed) this.render();
      return;
    }
    // Hover: show the node under the pointer.
    const w = this.drawing.wires.findIndex((v) => distance(exact, v) < 0.35);
    const pin = this.pins().find((q) => Math.hypot(q.x - exact.x, q.y - exact.y) < 0.4);
    const node =
      w >= 0 ? this.conn.wireNode[w] : pin ? this.conn.node.get(key(pin.x, pin.y)) : undefined;
    this.canvas.classList.toggle("ed-on-pin", pin !== undefined);
    this.status.textContent = node !== undefined ? `${this.host.t.node} ${node}` : "";
  }

  private onUp(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    const { grid } = this.at(e);
    if (drag.kind === "move") {
      this.drag = undefined;
      if (drag.moved) {
        this.undoStack.push(JSON.stringify(drag.from));
        this.redoStack = [];
        this.update();
      } else {
        // A click: probe like on the schematic.
        const sel = drag.sel;
        if (sel.kind === "wire") this.host.probe("node", this.conn.wireNode[sel.index] ?? "");
        if (sel.kind === "part") this.host.probe("part", sel.id);
        this.render();
      }
      return;
    }
    if (drag.temporary) {
      if (grid.x !== drag.start.x || grid.y !== drag.start.y) {
        this.snapshot();
        this.addWire(drag.start, grid);
        this.drag = undefined;
        this.update();
      } else {
        // A click on a pin: keep drawing from it, with the wire tool.
        this.tool = { kind: "wire" };
        this.drag = { kind: "wire", start: drag.start, temporary: false };
        this.toolbar();
        this.render();
      }
    }
  }

  private setProp(prop: string, value: string): void {
    const sel = this.selection;
    if (!sel) return;
    const v = value.trim();
    if (sel.kind === "part") {
      const p = this.drawing.parts.find((q) => q.id === sel.id);
      if (!p) return;
      if (prop === "name") {
        const prefix = PREFIX[p.kind];
        const id = (v.toUpperCase().startsWith(prefix) ? v : `${prefix}${v}`).replace(/\s+/g, "_");
        if (id === p.id) return;
        if (
          this.drawing.parts.some((q) => q.id.toUpperCase() === id.toUpperCase()) ||
          id === prefix
        ) {
          this.renderProps(this.host.t.editor.taken);
          return;
        }
        this.snapshot();
        p.id = id;
        this.selection = { kind: "part", id };
      } else {
        this.snapshot();
        p.value = v;
      }
    } else if (sel.kind === "label") {
      const l = this.drawing.labels[sel.index];
      if (!l || !v || /\s/.test(v)) {
        this.renderProps(this.host.t.editor.badName);
        return;
      }
      this.snapshot();
      l.name = v;
    } else return;
    this.update();
  }

  // ------------------------------------------------------------- render

  render(): void {
    const d = this.drawing;
    const conn = this.conn;
    let parts = d.parts;
    let ghost: Part | undefined;
    if (this.tool.kind === "place" && this.cursor) {
      ghost = { ...this.ghost(this.tool.part, this.cursor), id: "__ghost" };
      parts = [...parts, ghost];
    }
    const nodeAt = (q: Pt) => conn.node.get(key(q.x, q.y)) ?? "";
    const components = parts.map((p) =>
      placed(p, pinsOf(p).map(nodeAt), p === ghost ? undefined : this.info.get(p.id)),
    );
    if (ghost) {
      const g = components[components.length - 1] as PlacedComponent;
      g.label = { id: "", value: "" };
    }
    // Nets: segments grouped by node, dots where three or more meet.
    const nets = new Map<string, PlacedNet>();
    d.wires.forEach((w, i) => {
      const node = conn.wireNode[i] ?? "";
      let net = nets.get(node);
      if (!net) {
        net = { node, segments: [], junctions: [], labelAt: { x: w.x1, y: w.y1 } };
        nets.set(node, net);
      }
      net.segments.push({ ...w });
    });
    for (const [k, n] of conn.degree) {
      if (n < 3) continue;
      const [x, y] = k.split(",").map(Number) as [number, number];
      const node = conn.node.get(k) ?? "";
      nets.get(node)?.junctions.push({ x, y });
    }
    // Extent: the visible area at least, and everything drawn.
    const xs = [
      ...parts.flatMap((p) => pinsOf(p).map((q) => q.x)),
      ...d.wires.flatMap((w) => [w.x1, w.x2]),
      ...d.grounds.map((g) => g.x),
      ...d.labels.map((l) => l.x + l.name.length),
    ];
    const ys = [
      ...parts.flatMap((p) => pinsOf(p).map((q) => q.y)),
      ...d.wires.flatMap((w) => [w.y1, w.y2]),
      ...d.grounds.map((g) => g.y + 2),
      ...d.labels.map((l) => l.y),
    ];
    const viewW = Math.floor((this.canvas.clientWidth || 600) / U) - 2;
    const viewH = Math.floor((this.canvas.clientHeight || 420) / U) - 2;
    const layout: SchematicLayout = {
      components,
      nets: [...nets.values()],
      grounds: d.grounds.map((g) => ({ ...g })),
      couplings: [],
      bounds: {
        minX: 0,
        minY: 0,
        maxX: Math.max(viewW, ...xs.map((x) => x + 6)),
        maxY: Math.max(viewH, ...ys.map((y) => y + 4)),
      },
    };
    let svg = renderSvg(layout, {
      theme: "none",
      style: this.host.style(),
      nodeLabels: false,
      title: this.host.t.editor.canvas,
    });
    const overlay: string[] = [];
    // Unconnected pins.
    for (const p of d.parts) {
      for (const q of pinsOf(p)) {
        if ((conn.degree.get(key(q.x, q.y)) ?? 0) <= 1)
          overlay.push(`<circle class="ed-pin" cx="${px(q.x)}" cy="${px(q.y)}" r="3.5"/>`);
      }
    }
    // Labels.
    d.labels.forEach((l, i) => {
      const sel = this.selection?.kind === "label" && this.selection.index === i ? " sel" : "";
      const w = l.name.length * 7.2 + 10;
      const x = px(l.x);
      const y = px(l.y);
      overlay.push(
        `<g class="ed-label${sel}" data-node="${esc(conn.node.get(key(l.x, l.y)) ?? "")}"><circle cx="${x}" cy="${y}" r="2.5"/><path d="M${x} ${y}V${y - 8}"/><rect x="${x - 4}" y="${y - 26}" width="${w}" height="18" rx="4"/><text x="${x + 1}" y="${y - 13}">${esc(l.name)}</text></g>`,
      );
    });
    // Selection.
    const sel = this.selection;
    if (sel?.kind === "part") {
      const p = d.parts.find((q) => q.id === sel.id);
      if (p) {
        const pins = pinsOf(p);
        const o = centerOffset(p.kind, p.dir);
        const pts = [...pins, { x: p.x + o.x, y: p.y + o.y }];
        const extra = TWO_TERMINAL.has(p.kind) ? 1.1 : 0.6;
        const x0 = Math.min(...pts.map((q) => q.x)) - extra;
        const x1 = Math.max(...pts.map((q) => q.x)) + extra;
        const y0 = Math.min(...pts.map((q) => q.y)) - extra;
        const y1 = Math.max(...pts.map((q) => q.y)) + extra;
        overlay.push(
          `<rect class="ed-sel" x="${px(x0)}" y="${px(y0)}" width="${(x1 - x0) * U}" height="${(y1 - y0) * U}" rx="4"/>`,
        );
      }
    } else if (sel?.kind === "wire") {
      const w = d.wires[sel.index];
      if (w)
        overlay.push(
          `<path class="ed-sel-wire" d="M${px(w.x1)} ${px(w.y1)}L${px(w.x2)} ${px(w.y2)}"/>`,
        );
    } else if (sel?.kind === "ground") {
      const g = d.grounds[sel.index];
      if (g)
        overlay.push(
          `<rect class="ed-sel" x="${px(g.x - 0.8)}" y="${px(g.y - 0.3)}" width="${1.6 * U}" height="${1.9 * U}" rx="4"/>`,
        );
    }
    // Wire being drawn, and the cursor.
    if (this.drag?.kind === "wire" && this.cursor) {
      const a = this.drag.start;
      const b = this.cursor;
      const c = this.corner(a, b);
      overlay.push(
        `<path class="ed-preview" d="M${px(a.x)} ${px(a.y)}L${px(c.x)} ${px(c.y)}L${px(b.x)} ${px(b.y)}"/>`,
      );
    }
    if (this.cursor && this.tool.kind !== "select") {
      if (this.tool.kind === "ground") {
        const x = px(this.cursor.x);
        const y = px(this.cursor.y);
        overlay.push(
          `<path class="ed-ghost-path" d="M${x} ${y}V${y + U}M${x - 12} ${y + U}H${x + 12}M${x - 7.6} ${y + 25}H${x + 7.6}M${x - 3} ${y + 30}H${x + 3}"/>`,
        );
      }
      overlay.push(
        `<circle class="ed-cursor" cx="${px(this.cursor.x)}" cy="${px(this.cursor.y)}" r="4"/>`,
      );
    }
    const grid = `<defs><pattern id="ed-dots" width="${U}" height="${U}" patternUnits="userSpaceOnUse" x="${U / 2}" y="${U / 2}"><circle cx="${U / 2}" cy="${U / 2}" r="1.1" class="ed-dot"/></pattern></defs><rect class="ed-grid" width="100%" height="100%" fill="url(#ed-dots)"/>`;
    svg = svg
      .replace(/(<svg[^>]*>(?:<title>.*?<\/title>)?)/, `$1${grid}`)
      .replace("</svg>", `${overlay.join("")}</svg>`);
    if (ghost)
      svg = svg.replace('class="c" data-id="__ghost"', 'class="c ed-ghost" data-id="__ghost"');
    const scroll = { left: this.canvas.scrollLeft, top: this.canvas.scrollTop };
    this.canvas.innerHTML = svg;
    this.canvas.scrollLeft = scroll.left;
    this.canvas.scrollTop = scroll.top;
    const el = this.canvas.querySelector("svg");
    if (el) this.host.decorate(el);
    if (d.parts.length === 0 && d.wires.length === 0 && this.tool.kind === "select") {
      this.status.textContent = this.host.t.editor.empty;
    }
  }

  private renderProps(error?: string): void {
    const t = this.host.t.editor;
    const sel = this.selection;
    let html = "";
    if (sel?.kind === "part") {
      const p = this.drawing.parts.find((q) => q.id === sel.id);
      if (p) {
        const hint = t.valueHints[p.kind] ?? "";
        html = `<label>${t.name}<input data-prop="name" value="${esc(p.id)}" spellcheck="false" size="6"></label>
<label class="ed-value">${t.value}<input data-prop="value" value="${esc(p.value)}" spellcheck="false" placeholder="${esc(hint)}"></label>
${rotatable(p.kind) ? `<button data-action="rotate" title="${t.rotate} (R)">⟳</button>` : ""}<button data-action="delete" title="${t.delete}">🗑</button>
<span class="ed-hint">${esc(hint)}</span>`;
      }
    } else if (sel?.kind === "label") {
      const l = this.drawing.labels[sel.index];
      if (l)
        html = `<label>${t.labelName}<input data-prop="name" value="${esc(l.name)}" spellcheck="false" size="8"></label><button data-action="delete" title="${t.delete}">🗑</button><span class="ed-hint">${t.labelHint}</span>`;
    } else if (sel) {
      html = `<button data-action="delete" title="${t.delete}">🗑 ${t.delete}</button>`;
    } else {
      html = `<span class="ed-hint">${this.tool.kind === "wire" ? t.wireHint : this.tool.kind === "place" ? t.placeHint : t.hint}</span>`;
    }
    if (error) html += `<span class="ed-error">${esc(error)}</span>`;
    this.props.innerHTML = html;
  }
}

function esc(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (ch) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[ch] as string};`,
  );
}

const SELECT_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 3l14 9-6 1.5L10 20z" fill="currentColor"/></svg>`;
const WIRE_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 6h10v12h8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="3" cy="6" r="2" fill="currentColor"/><circle cx="21" cy="18" r="2" fill="currentColor"/></svg>`;
const GROUND_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3v9M5 12h14M8 16h8M11 20h2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
const LABEL_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 12l5-6h13v12H8z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;

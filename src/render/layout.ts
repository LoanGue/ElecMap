import type { CompiledCircuit } from "../core/circuit";
import type { ComponentJSON, ComponentType, NodeName } from "../format/types";
import { formatSI } from "../format/units";
import type { GridBounds } from "./router";
import { Router } from "./router";

/** Direction from the first pin to the second (two-terminal), or of the output (op-amp). */
export type Orientation = "right" | "down" | "left" | "up";

/** A component pin placed on the grid. */
export interface PlacedPin {
  node: NodeName;
  x: number;
  y: number;
  /**
   * True when the node is the ground: drawn with its own ground symbol, or
   * wired to the ground rail (see {@link LayoutOptions.ground}).
   */
  ground: boolean;
}

/** A component placed on the grid (grid units). */
export interface PlacedComponent {
  id: string;
  type: ComponentType;
  component: ComponentJSON;
  orientation: Orientation;
  /**
   * Pins: `[nodes[0], nodes[1]]` for two-terminal components,
   * `[in+, in−, out]` for op-amps.
   */
  pins: PlacedPin[];
  /** Label lines (id, value). */
  label: { id: string; value: string };
  /** Anchor of the label text and its alignment. */
  labelAt: { x: number; y: number; align: "start" | "middle" };
}

/** A routed net: maximal straight segments and junction dots. */
export interface PlacedNet {
  node: NodeName;
  segments: { x1: number; y1: number; x2: number; y2: number }[];
  junctions: { x: number; y: number }[];
  /** Where the node name is written. */
  labelAt: { x: number; y: number };
  /** True for the ground rail (only with `ground: "rail"`). */
  ground?: boolean;
}

/** Magnetic coupling between two placed inductors. */
export interface PlacedCoupling {
  id: string;
  k: number;
  inductors: [string, string];
}

/** Geometry of a schematic, in grid units (see {@link layoutCircuit}). */
export interface SchematicLayout {
  components: PlacedComponent[];
  nets: PlacedNet[];
  /** Ground symbols, drawn below each point (a single one under the rail in rail mode). */
  grounds: { x: number; y: number }[];
  couplings: PlacedCoupling[];
  /** Extent of everything drawn, text included. */
  bounds: GridBounds;
}

/** Length of a two-terminal component between its pins. */
export const PIN_SPAN = 4;
const ROW = 12;
const SHUNT_STEP = 5;
/** Approximate text width in grid units per character (12 px font on a 20 px grid). */
const CHAR = 0.36;

const DIRS: Record<Orientation, [number, number]> = {
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
  up: [0, -1],
};

const UNITS: Partial<Record<ComponentType, string>> = {
  resistor: "Ω",
  capacitor: "F",
  inductor: "H",
};

function sourceText(c: ComponentJSON & { type: "vsource" | "isource" }): string {
  const u = c.type === "vsource" ? "V" : "A";
  const w = c.waveform;
  if (w) {
    switch (w.kind) {
      case "sine":
        return `${w.offset ? `${formatSI(w.offset, u)} + ` : ""}${formatSI(w.amplitude, u)} ~ ${formatSI(w.freq, "Hz")}`;
      case "pulse":
        return `⎍ ${formatSI(w.v1, u)} → ${formatSI(w.v2, u)}`;
      case "step":
        return `step ${formatSI(w.v1 ?? 0, u)} → ${formatSI(w.v2, u)}`;
      case "pwl":
        return "PWL";
      case "exp":
        return `exp ${formatSI(w.v1, u)} → ${formatSI(w.v2, u)}`;
    }
  }
  const parts: string[] = [];
  if (c.dc !== undefined && (c.dc !== 0 || !c.ac)) parts.push(formatSI(c.dc, u));
  if (c.ac) parts.push(`AC ${formatSI(c.ac.mag, u)}${c.ac.phase ? ` ∠${c.ac.phase}°` : ""}`);
  return parts.join(", ") || formatSI(0, u);
}

/** Text of the value shown next to a component. */
export function valueText(c: ComponentJSON): string {
  switch (c.type) {
    case "resistor":
    case "capacitor":
    case "inductor":
      return formatSI(c.value, UNITS[c.type]);
    case "vsource":
    case "isource":
      return sourceText(c);
    case "vcvs":
      return `${c.gain}·V(${c.control[0]},${c.control[1]})`;
    case "vccs":
      return `${formatSI(c.gain, "S")}·V(${c.control[0]},${c.control[1]})`;
    case "cccs":
      return `${c.gain}·I(${c.controlSource})`;
    case "ccvs":
      return `${formatSI(c.gain, "Ω")}·I(${c.controlSource})`;
    case "opamp":
      return c.gain === undefined
        ? ""
        : `A = ${formatSI(c.gain)}${c.gbw ? `, ${formatSI(c.gbw, "Hz")}` : ""}`;
    case "switch":
      return c.closed ? "closed" : "open";
    case "coupling":
      return `k = ${c.k}`;
  }
}

const textWidth = (s: string) => s.length * CHAR;

type Key = string;
const key = (x: number, y: number): Key => `${x},${y}`;

/** Grid cells used by a placed element. */
interface Footprint {
  /** Hard cells (bodies). */
  body: Key[];
  /** Room kept under grounded pins (ground symbol, or the drop to the rail). */
  reserved: Key[];
  /** Text cells. */
  text: Key[];
  pins: Key[];
}

interface Candidate {
  placed: PlacedComponent;
  footprint: Footprint;
  grounds: { x: number; y: number }[];
}

function rect(x0: number, y0: number, x1: number, y1: number): Key[] {
  const out: Key[] = [];
  for (let x = Math.floor(Math.min(x0, x1)); x <= Math.ceil(Math.max(x0, x1)); x++) {
    for (let y = Math.floor(Math.min(y0, y1)); y <= Math.ceil(Math.max(y0, y1)); y++)
      out.push(key(x, y));
  }
  return out;
}

function groundCells(x: number, y: number): Key[] {
  return rect(x - 1, y + 1, x + 1, y + 2);
}

/** Two-terminal component with its first pin at `(x, y)`. */
function twoTerminal(
  c: ComponentJSON & { nodes: [NodeName, NodeName] },
  x: number,
  y: number,
  orientation: Orientation,
  isGround: (n: NodeName) => boolean,
  showValue: boolean,
): Candidate {
  const [dx, dy] = DIRS[orientation];
  const pins: PlacedPin[] = c.nodes.map((node, i) => ({
    node,
    x: x + dx * PIN_SPAN * i,
    y: y + dy * PIN_SPAN * i,
    ground: isGround(node),
  }));
  const p0 = pins[0] as PlacedPin;
  const p1 = pins[1] as PlacedPin;
  const value = showValue ? valueText(c) : "";
  const cx = (p0.x + p1.x) / 2;
  const cy = (p0.y + p1.y) / 2;
  const horizontal = dy === 0;
  const body = horizontal
    ? rect(cx - 1, cy - 1, cx + 1, cy + 1)
    : rect(cx - 1, cy - 1, cx + 1, cy + 1);
  let text: Key[];
  let labelAt: PlacedComponent["labelAt"];
  if (horizontal) {
    const w = Math.max(textWidth(c.id), textWidth(value)) / 2;
    text = [
      ...rect(cx - w, cy - 2, cx + w, cy - 2),
      ...(value ? rect(cx - w, cy + 2, cx + w, cy + 2) : []),
    ];
    labelAt = { x: cx, y: cy, align: "middle" };
  } else {
    const w = Math.max(textWidth(c.id), textWidth(value));
    text = rect(cx + 2, cy - 1, cx + 1.6 + w, cy + 1);
    labelAt = { x: cx + 1.6, y: cy, align: "start" };
  }
  const grounds = pins.filter((p) => p.ground).map((p) => ({ x: p.x, y: p.y }));
  return {
    placed: {
      id: c.id,
      type: c.type,
      component: c,
      orientation,
      pins,
      label: { id: c.id, value },
      labelAt,
    },
    footprint: {
      body,
      reserved: grounds.flatMap((g) => groundCells(g.x, g.y)),
      text,
      pins: pins.map((p) => key(p.x, p.y)),
    },
    grounds,
  };
}

/** Op-amp with its output pin at `(x, y)`, inverting input on top. */
function opamp(
  c: ComponentJSON & { type: "opamp" },
  x: number,
  y: number,
  isGround: (n: NodeName) => boolean,
  showValue: boolean,
): Candidate {
  const [np, nn, no] = c.nodes;
  const pins: PlacedPin[] = [
    { node: np, x: x - 5, y: y + 1, ground: isGround(np) },
    { node: nn, x: x - 5, y: y - 1, ground: isGround(nn) },
    { node: no, x, y, ground: isGround(no) },
  ];
  const value = showValue ? valueText(c) : "";
  const body = rect(x - 4, y - 2, x - 1, y + 2);
  const grounds = pins.filter((p) => p.ground).map((p) => ({ x: p.x, y: p.y }));
  const w = Math.max(textWidth(c.id), textWidth(value));
  return {
    placed: {
      id: c.id,
      type: c.type,
      component: c,
      orientation: "right",
      pins,
      label: { id: c.id, value },
      labelAt: { x: x - 2.2, y: y + 2.6, align: "start" },
    },
    footprint: {
      body,
      reserved: grounds.flatMap((g) => groundCells(g.x, g.y)),
      text: rect(x - 2, y + 2, x - 2 + w, y + 3 + (value ? 1 : 0)),
      pins: pins.map((p) => key(p.x, p.y)),
    },
    grounds,
  };
}

/** Options of {@link layoutCircuit}. */
export interface LayoutOptions {
  /** Include component values in the label footprints (default true). */
  showValues?: boolean;
  /**
   * How grounded pins are drawn:
   * - `"symbols"`: a ground symbol under each of them;
   * - `"rail"`: wired to a common line at the bottom of the schematic, which
   *   closes the circuit, with a single ground symbol;
   * - `"auto"` (default): the rail when every grounded pin reaches it by a
   *   straight drop that touches nothing else, the symbols otherwise.
   */
  ground?: "symbols" | "rail" | "auto";
}

type TwoTerminal = ComponentJSON & { nodes: [NodeName, NodeName] };

/**
 * Computes a schematic layout.
 *
 * 1. **Columns**: nodes are discovered breadth-first from the first grounded
 *    source; edges are oriented by discovery order (op-amp inputs always
 *    before their output) and each node takes the column `1 + min` of its
 *    predecessors (`1 + max` for op-amp outputs). Rows inside a column follow
 *    the barycentre of the predecessors.
 * 2. **Placement**: grounded components hang vertically under their node with a
 *    ground symbol, series components lie horizontally between their nodes,
 *    long and feedback branches go above. Each component takes the first
 *    candidate position that does not overlap anything already placed.
 * 3. **Routing**: every net is routed on the grid by A* (bends and crossings
 *    penalised, no shared segments between nets), as a Steiner tree grown from
 *    the node's anchor point.
 * 4. **Ground**: a symbol under each grounded pin, or a rail under the whole
 *    schematic that every grounded pin drops to (see {@link LayoutOptions.ground}).
 */
export function layoutCircuit(
  circuit: CompiledCircuit,
  options: LayoutOptions = {},
): SchematicLayout {
  const mode = options.ground ?? "auto";
  if (mode === "symbols") return build(circuit, options, "off") as SchematicLayout;
  if (mode === "rail") return build(circuit, options, "force") as SchematicLayout;
  return build(circuit, options, "clean") ?? (build(circuit, options, "off") as SchematicLayout);
}

/**
 * `rail`: `"off"` draws ground symbols; `"force"` always draws the rail;
 * `"clean"` draws it only when every drop is straight and free, and returns
 * `undefined` otherwise.
 */
function build(
  circuit: CompiledCircuit,
  options: LayoutOptions,
  rail: "off" | "force" | "clean",
): SchematicLayout | undefined {
  const showValue = options.showValues ?? true;
  const isGround = (n: NodeName) => circuit.isGround(n);
  const comps = circuit.components;
  const twoTerms = comps.filter(
    (c): c is TwoTerminal => c.type !== "opamp" && c.type !== "coupling",
  );
  const opamps = comps.filter((c): c is ComponentJSON & { type: "opamp" } => c.type === "opamp");
  const nodes = circuit.nodes.filter((n) => !isGround(n));

  // ---- 1. Discovery order -------------------------------------------------
  const adjacency = new Map<NodeName, NodeName[]>(nodes.map((n) => [n, []]));
  const link = (a: NodeName, b: NodeName) => {
    if (a === b || isGround(a) || isGround(b)) return;
    adjacency.get(a)?.push(b);
    adjacency.get(b)?.push(a);
  };
  for (const c of twoTerms) link(c.nodes[0], c.nodes[1]);
  for (const o of opamps) {
    link(o.nodes[0], o.nodes[2]);
    link(o.nodes[1], o.nodes[2]);
  }
  const rootSource = twoTerms.find(
    (c) =>
      (c.type === "vsource" || c.type === "isource") &&
      c.nodes.some(isGround) &&
      !c.nodes.every(isGround),
  );
  const roots: NodeName[] = [];
  if (rootSource) roots.push(rootSource.nodes.find((n) => !isGround(n)) as NodeName);
  roots.push(...nodes);
  const order = new Map<NodeName, number>();
  const tree = new Map<NodeName, number>();
  let treeCount = 0;
  for (const r of roots) {
    if (order.has(r)) continue;
    const queue = [r];
    order.set(r, order.size);
    tree.set(r, treeCount);
    while (queue.length > 0) {
      const u = queue.shift() as NodeName;
      for (const v of adjacency.get(u) ?? []) {
        if (!order.has(v)) {
          order.set(v, order.size);
          tree.set(v, treeCount);
          queue.push(v);
        }
      }
    }
    treeCount++;
  }
  const ord = (n: NodeName) => order.get(n) ?? 0;

  // ---- 2. Oriented edges and columns -------------------------------------
  const inputsOf = new Map<NodeName, Set<NodeName>>(); // output → op-amp inputs
  for (const o of opamps) {
    const set = inputsOf.get(o.nodes[2]) ?? new Set();
    for (const i of [o.nodes[0], o.nodes[1]]) if (!isGround(i) && i !== o.nodes[2]) set.add(i);
    inputsOf.set(o.nodes[2], set);
  }
  const preds = new Map<NodeName, { from: NodeName; opamp: boolean }[]>(nodes.map((n) => [n, []]));
  const succs = new Map<NodeName, NodeName[]>(nodes.map((n) => [n, []]));
  const addEdge = (a: NodeName, b: NodeName, opamp: boolean) => {
    preds.get(b)?.push({ from: a, opamp });
    succs.get(a)?.push(b);
  };
  for (const c of twoTerms) {
    const [a, b] = c.nodes;
    if (a === b || isGround(a) || isGround(b)) continue;
    if (inputsOf.get(b)?.has(a)) addEdge(a, b, false);
    else if (inputsOf.get(a)?.has(b)) addEdge(b, a, false);
    else if (ord(a) < ord(b)) addEdge(a, b, false);
    else addEdge(b, a, false);
  }
  for (const [out, ins] of inputsOf) for (const i of ins) addEdge(i, out, true);

  // Topological order (Kahn), breaking cycles by discovery order.
  const indeg = new Map(nodes.map((n) => [n, preds.get(n)?.length ?? 0]));
  const done = new Set<NodeName>();
  const topo: NodeName[] = [];
  const byOrder = [...nodes].sort((a, b) => ord(a) - ord(b));
  while (topo.length < nodes.length) {
    const next =
      byOrder.find((n) => !done.has(n) && indeg.get(n) === 0) ?? byOrder.find((n) => !done.has(n));
    if (next === undefined) break;
    done.add(next);
    topo.push(next);
    for (const s of succs.get(next) ?? []) indeg.set(s, (indeg.get(s) ?? 1) - 1);
  }
  const col = new Map<NodeName, number>();
  for (const n of topo) {
    let minNormal = Infinity;
    let maxOpamp = 0;
    for (const p of preds.get(n) ?? []) {
      const pc = col.get(p.from);
      if (pc === undefined) continue;
      if (p.opamp) maxOpamp = Math.max(maxOpamp, pc + 1);
      else minNormal = Math.min(minNormal, pc + 1);
    }
    col.set(n, Math.max(Number.isFinite(minNormal) ? minNormal : 0, maxOpamp));
  }
  // Separate trees side by side, then drop empty columns.
  let offset = 0;
  for (let t = 0; t < treeCount; t++) {
    const members = nodes.filter((n) => tree.get(n) === t);
    if (members.length === 0) continue;
    for (const n of members) col.set(n, (col.get(n) ?? 0) + offset);
    offset = Math.max(...members.map((n) => col.get(n) ?? 0)) + 1;
  }
  const used = [...new Set(col.values())].sort((a, b) => a - b);
  for (const n of nodes) col.set(n, used.indexOf(col.get(n) ?? 0));
  const columns: NodeName[][] = used.map(() => []);
  for (const n of topo) columns[col.get(n) ?? 0]?.push(n);

  const inverting = new Set(opamps.map((o) => o.nodes[1]).filter((n) => !isGround(n)));
  const nonInverting = new Set(opamps.map((o) => o.nodes[0]).filter((n) => !isGround(n)));
  // Rows: barycentre of the predecessors' rows.
  const row = new Map<NodeName, number>();
  for (const members of columns) {
    const bary = (n: NodeName) => {
      const rows = (preds.get(n) ?? [])
        .map((p) => row.get(p.from))
        .filter((r): r is number => r !== undefined);
      return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : 0;
    };
    // Ties: inverting op-amp inputs on top (they are drawn above the non-inverting ones).
    const rank = (n: NodeName) => (inverting.has(n) ? 0 : nonInverting.has(n) ? 2 : 1);
    members.sort((a, b) => bary(a) - bary(b) || rank(a) - rank(b) || ord(a) - ord(b));
    members.forEach((n, i) => row.set(n, i));
  }

  // Column positions: room for the grounded components hanging under each node.
  const shunts = new Map<NodeName, TwoTerminal[]>(nodes.map((n) => [n, []]));
  for (const c of twoTerms) {
    const g = c.nodes.filter(isGround).length;
    if (g === 1) shunts.get(c.nodes.find((n) => !isGround(n)) as NodeName)?.push(c);
  }
  const colX: number[] = [];
  let x = 0;
  columns.forEach((members, i) => {
    colX[i] = x;
    const k = Math.max(1, ...members.map((n) => shunts.get(n)?.length ?? 0));
    x += 6 + SHUNT_STEP * k;
  });
  // Op-amp outputs sit one cell below the inverting input (or above the
  // non-inverting one), so that the input wire is straight.
  const yOverride = new Map<NodeName, number>();
  const baseY = (n: NodeName) => yOverride.get(n) ?? (row.get(n) ?? 0) * ROW;
  for (const n of topo) {
    const o = opamps.find((op) => op.nodes[2] === n);
    if (!o || isGround(n)) continue;
    const [ip, im] = o.nodes;
    if (!isGround(im) && im !== n) yOverride.set(n, baseY(im) + 1);
    else if (!isGround(ip) && ip !== n) yOverride.set(n, baseY(ip) - 1);
  }
  const anchor = (n: NodeName) => ({ x: colX[col.get(n) ?? 0] ?? 0, y: baseY(n) });

  // ---- 3. Placement -------------------------------------------------------
  const occupied = new Set<Key>(nodes.map((n) => key(anchor(n).x, anchor(n).y)));
  const placed: PlacedComponent[] = [];
  const grounds: { x: number; y: number }[] = [];
  const bodyCells = new Set<Key>();
  const textCells = new Set<Key>();
  const pinCells = new Set<Key>();

  const fits = (cand: Candidate) => {
    const f = cand.footprint;
    for (const k of [...f.body, ...f.text]) if (occupied.has(k) || pinCells.has(k)) return false;
    for (const k of f.pins) if (occupied.has(k) || pinCells.has(k)) return false;
    return true;
  };
  const accept = (cand: Candidate) => {
    placed.push(cand.placed);
    grounds.push(...cand.grounds);
    for (const k of cand.footprint.body) {
      occupied.add(k);
      bodyCells.add(k);
    }
    for (const k of cand.footprint.reserved) {
      occupied.add(k);
      if (rail === "off") bodyCells.add(k);
    }
    for (const k of cand.footprint.text) {
      occupied.add(k);
      textCells.add(k);
    }
    for (const k of cand.footprint.pins) pinCells.add(k);
  };
  const place = (make: (dx: number, dy: number) => Candidate, offsets: [number, number][]) => {
    for (const [dx, dy] of offsets) {
      const cand = make(dx, dy);
      if (fits(cand)) return accept(cand);
    }
    // Last resort: move far away along y until it fits.
    for (let dy = 1; ; dy++) {
      const cand = make(0, ROW * dy + 3);
      if (fits(cand)) return accept(cand);
    }
  };
  const spiral = (stepX: number, stepY: number, n = 8): [number, number][] => {
    const out: [number, number][] = [];
    for (let r = 0; r <= n; r++) {
      for (const [a, b] of [
        [0, -r],
        [0, r],
        [r, 0],
        [-r, 0],
        [r, -r],
        [-r, -r],
        [r, r],
        [-r, r],
      ] as const) {
        const o: [number, number] = [a * stepX, b * stepY];
        if (!out.some(([p, q]) => p === o[0] && q === o[1])) out.push(o);
      }
    }
    return out;
  };

  // Op-amps first: output pin two cells left of the output node.
  for (const o of opamps) {
    const out = isGround(o.nodes[2]) ? { x: 10, y: 0 } : anchor(o.nodes[2]);
    place((dx, dy) => opamp(o, out.x - 2 + dx, out.y + dy, isGround, showValue), spiral(1, 5));
  }

  // Grounded components hang under their node, sources first.
  const isSource = (c: ComponentJSON) => c.type === "vsource" || c.type === "isource";
  for (const n of topo) {
    const list = [...(shunts.get(n) ?? [])].sort(
      (a, b) => Number(isSource(b)) - Number(isSource(a)),
    );
    const a = anchor(n);
    list.forEach((c, i) => {
      const groundFirst = isGround(c.nodes[0]);
      const offsets: [number, number][] = [];
      for (let k = i; k < i + 8; k++) offsets.push([k * SHUNT_STEP, 0]);
      offsets.push(...spiral(SHUNT_STEP, ROW).slice(1));
      place(
        (dx, dy) =>
          groundFirst
            ? twoTerminal(c, a.x + dx, a.y + 2 + PIN_SPAN + dy, "up", isGround, showValue)
            : twoTerminal(c, a.x + dx, a.y + 2 + dy, "down", isGround, showValue),
        offsets,
      );
    });
  }

  // Series components.
  const series = twoTerms.filter((c) => !c.nodes.some(isGround) && c.nodes[0] !== c.nodes[1]);
  const kind = (c: TwoTerminal) => {
    const [a, b] = c.nodes;
    const ca = col.get(a) ?? 0;
    const cb = col.get(b) ?? 0;
    return ca === cb ? 1 : Math.abs(ca - cb) === 1 ? 0 : 2;
  };
  series.sort((p, q) => kind(p) - kind(q));
  const upFirst: [number, number][] = [[0, 0]];
  for (let k = 1; k <= 12; k++) upFirst.push([0, -5 * k], [0, 5 * k]);
  for (const c of series) {
    const [a, b] = c.nodes;
    const left = (col.get(a) ?? 0) <= (col.get(b) ?? 0) ? a : b;
    const right = left === a ? b : a;
    const forward = left === a; // first pin on the left
    const pa = anchor(left);
    const pb = anchor(right);
    const k = kind(c);
    if (k === 0) {
      // Between adjacent columns, ending 3 cells before the right node.
      const x1 = pb.x - 3;
      place(
        (dx, dy) =>
          forward
            ? twoTerminal(c, x1 - PIN_SPAN + dx, pb.y + dy, "right", isGround, showValue)
            : twoTerminal(c, x1 + dx, pb.y + dy, "left", isGround, showValue),
        upFirst,
      );
    } else if (k === 1) {
      // Same column: vertical between the two rows, beside the hanging components.
      const top = pa.y <= pb.y ? left : right;
      const ta = anchor(top);
      const dir: Orientation = top === a ? "down" : "up";
      const y0 = dir === "down" ? ta.y + 2 : ta.y + 2 + PIN_SPAN;
      const offsets: [number, number][] = [];
      for (let i = 1; i < 10; i++) offsets.push([-3 + SHUNT_STEP * i, 0], [-3 + SHUNT_STEP * i, 5]);
      place((dx, dy) => twoTerminal(c, ta.x + dx, y0 + dy, dir, isGround, showValue), offsets);
    } else {
      // Long or feedback branch: above, centred between the columns.
      const xm = Math.round((pa.x + pb.x) / 2);
      const y = Math.min(pa.y, pb.y) - 5;
      const offs: [number, number][] = [];
      for (let i = 0; i < 12; i++) offs.push([0, -5 * i], [3, -5 * i], [-3, -5 * i]);
      place(
        (dx, dy) =>
          forward
            ? twoTerminal(c, xm - 2 + dx, y + dy, "right", isGround, showValue)
            : twoTerminal(c, xm + 2 + dx, y + dy, "left", isGround, showValue),
        offs,
      );
    }
  }
  // Degenerate components (both pins on the same node or both grounded).
  for (const c of twoTerms) {
    if (placed.some((p) => p.id === c.id)) continue;
    const a = isGround(c.nodes[0]) ? { x: -6, y: 0 } : anchor(c.nodes[0]);
    place(
      (dx, dy) => twoTerminal(c, a.x + dx, a.y + 2 + dy, "down", isGround, showValue),
      spiral(SHUNT_STEP, ROW),
    );
  }
  // Keep the components in input order.
  const position = new Map(comps.map((c, i) => [c.id, i]));
  placed.sort((p, q) => (position.get(p.id) ?? 0) - (position.get(q.id) ?? 0));

  // ---- 4. Routing ---------------------------------------------------------
  const pointsOf = (cells: Iterable<Key>) =>
    [...cells].map((k) => k.split(",").map(Number) as [number, number]);
  const all = [...pointsOf(occupied), ...pointsOf(pinCells)];
  let minX = Math.min(...all.map((p) => p[0]));
  let minY = Math.min(...all.map((p) => p[1]));
  let maxX = Math.max(...all.map((p) => p[0]));
  let maxY = Math.max(...all.map((p) => p[1]));
  const router = new Router({ minX: minX - 3, minY: minY - 3, maxX: maxX + 3, maxY: maxY + 3 });
  for (const [px, py] of pointsOf(bodyCells)) router.block(px, py);
  for (const [px, py] of pointsOf(textCells)) router.discourage(px, py);

  const pinsByNet = new Map<NodeName, PlacedPin[]>(nodes.map((n) => [n, []]));
  for (const p of placed)
    for (const pin of p.pins) if (!pin.ground) pinsByNet.get(pin.node)?.push(pin);
  for (const [net, pins] of pinsByNet) for (const p of pins) router.pin(net, p.x, p.y);

  // Ground rail, routed before the other nets so that they go around the drops.
  const groundPins = placed.flatMap((p) => p.pins.filter((pin) => pin.ground));
  const useRail = rail !== "off" && groundPins.length > 0;
  if (rail === "clean" && groundPins.length < 2) return undefined;
  const gnd = circuit.ground;
  if (useRail) {
    const railY = maxY + 1;
    const xs = groundPins.map((p) => p.x);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    for (const p of groundPins) router.pin(gnd, p.x, p.y);
    const railPath: number[] = [];
    for (let rx = x0; rx <= x1; rx++) railPath.push(router.index(rx, railY));
    router.commit(gnd, railPath);
    const railSet = new Set(railPath);
    const tree = new Set(railPath);
    // A straight drop that touches no body, pin, label or other wire.
    const straight = (p: PlacedPin) => {
      for (let y = p.y + 1; y < railY; y++) {
        const k = key(p.x, y);
        if (bodyCells.has(k) || pinCells.has(k) || textCells.has(k)) return false;
        if (!router.isFree(gnd, p.x, y)) return false;
      }
      return true;
    };
    // Lowest pins first: their drops are the shortest.
    for (const p of [...groundPins].sort((a, b) => b.y - a.y || a.x - b.x)) {
      if (straight(p)) {
        const path: number[] = [];
        for (let y = p.y; y <= railY; y++) path.push(router.index(p.x, y));
        router.commit(gnd, path);
        for (const v of path) tree.add(v);
      } else if (rail === "clean") {
        return undefined;
      } else {
        const path = router.route(gnd, [p.x, p.y], tree.size ? tree : railSet);
        router.commit(gnd, path);
        for (const v of path) tree.add(v);
      }
    }
    let sx = Math.round((x0 + x1) / 2);
    if (x1 > x0 && xs.includes(sx)) sx = xs.includes(sx + 1) ? sx - 1 : sx + 1;
    grounds.length = 0;
    grounds.push({ x: sx, y: railY });
    maxY = Math.max(maxY, railY + 2);
  }

  const span = (pins: PlacedPin[]) =>
    pins.length === 0
      ? 0
      : Math.max(...pins.map((p) => p.x)) -
        Math.min(...pins.map((p) => p.x)) +
        Math.max(...pins.map((p) => p.y)) -
        Math.min(...pins.map((p) => p.y));
  const netOrder = [...pinsByNet.keys()].sort(
    (a, b) => span(pinsByNet.get(a) ?? []) - span(pinsByNet.get(b) ?? []),
  );
  const seeds = new Map<NodeName, { x: number; y: number }>();
  for (const net of netOrder) {
    const pins = pinsByNet.get(net) ?? [];
    if (pins.length === 0) continue;
    const a = anchor(net);
    const inBox =
      pins.length >= 2 &&
      a.x >= Math.min(...pins.map((p) => p.x)) &&
      a.x <= Math.max(...pins.map((p) => p.x)) &&
      a.y >= Math.min(...pins.map((p) => p.y)) &&
      a.y <= Math.max(...pins.map((p) => p.y)) &&
      !bodyCells.has(key(a.x, a.y)) &&
      router.isFree(net, a.x, a.y);
    const treeSet = new Set<number>();
    const remaining = [...pins];
    if (inBox) {
      treeSet.add(router.index(a.x, a.y));
      seeds.set(net, a);
    } else {
      const first = remaining.shift() as PlacedPin;
      treeSet.add(router.index(first.x, first.y));
      seeds.set(net, first);
    }
    while (remaining.length > 0) {
      // Nearest pin to the tree first.
      const treePts = [...treeSet].map((i) => router.point(i));
      let best = 0;
      let bestD = Infinity;
      remaining.forEach((p, i) => {
        const d = Math.min(...treePts.map(([tx, ty]) => Math.abs(tx - p.x) + Math.abs(ty - p.y)));
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      const pin = remaining.splice(best, 1)[0] as PlacedPin;
      const path = router.route(net, [pin.x, pin.y], treeSet);
      router.commit(net, path);
      for (const v of path) treeSet.add(v);
    }
  }

  // ---- 5. Segments and junctions -----------------------------------------
  const pinKeys = new Map<Key, number>();
  for (const p of placed)
    for (const pin of p.pins)
      if (useRail || !pin.ground)
        pinKeys.set(key(pin.x, pin.y), (pinKeys.get(key(pin.x, pin.y)) ?? 0) + 1);
  const nets: PlacedNet[] = [];
  for (const net of useRail ? [...nodes, gnd] : nodes) {
    const edges = router.netEdges.get(net) ?? [];
    const degree = new Map<number, number>();
    const unique = new Map<string, [number, number]>();
    for (const [u, v] of edges) {
      const k = u < v ? `${u}-${v}` : `${v}-${u}`;
      if (!unique.has(k)) unique.set(k, u < v ? [u, v] : [v, u]);
    }
    // Prune dangling stubs (leaves that are not pins), e.g. an unused anchor.
    for (let changed = true; changed;) {
      changed = false;
      const deg = new Map<number, number>();
      for (const [u, v] of unique.values()) {
        deg.set(u, (deg.get(u) ?? 0) + 1);
        deg.set(v, (deg.get(v) ?? 0) + 1);
      }
      for (const [k, [u, v]] of unique) {
        const leaf = [u, v].find((w) => deg.get(w) === 1 && !pinKeys.has(key(...router.point(w))));
        if (leaf !== undefined) {
          unique.delete(k);
          changed = true;
          break;
        }
      }
    }
    for (const [u, v] of unique.values()) {
      degree.set(u, (degree.get(u) ?? 0) + 1);
      degree.set(v, (degree.get(v) ?? 0) + 1);
    }
    const junctions: { x: number; y: number }[] = [];
    for (const [v, d] of degree) {
      const [px, py] = router.point(v);
      if (d + (pinKeys.get(key(px, py)) ?? 0) >= 3) junctions.push({ x: px, y: py });
    }
    const seed = seeds.get(net) ?? (net === gnd ? (grounds[0] ?? anchor(net)) : anchor(net));
    nets.push({
      node: net,
      segments: mergeSegments(
        [...unique.values()].map(([u, v]) => [router.point(u), router.point(v)]),
      ),
      junctions,
      labelAt: { x: seed.x, y: seed.y },
      ...(net === gnd ? { ground: true } : {}),
    });
    for (const v of degree.keys()) {
      const [px, py] = router.point(v);
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
  }

  const couplings: PlacedCoupling[] = comps
    .filter((c): c is ComponentJSON & { type: "coupling" } => c.type === "coupling")
    .map((c) => ({ id: c.id, k: c.k, inductors: [...c.inductors] as [string, string] }));

  return {
    components: placed,
    nets,
    grounds,
    couplings,
    bounds: { minX: minX - 1, minY: minY - 1, maxX: maxX + 1, maxY: maxY + 1 },
  };
}

/** Merges unit edges into maximal horizontal / vertical segments. */
function mergeSegments(edges: [number, number][][]): PlacedNet["segments"] {
  const horizontal = new Map<number, number[]>(); // y → x of left ends
  const vertical = new Map<number, number[]>(); // x → y of top ends
  for (const [a, b] of edges) {
    const [ax, ay] = a as [number, number];
    const [bx, by] = b as [number, number];
    if (ay === by) horizontal.set(ay, [...(horizontal.get(ay) ?? []), Math.min(ax, bx)]);
    else vertical.set(ax, [...(vertical.get(ax) ?? []), Math.min(ay, by)]);
  }
  const out: PlacedNet["segments"] = [];
  const runs = (starts: number[]) => {
    const s = [...new Set(starts)].sort((p, q) => p - q);
    const res: [number, number][] = [];
    for (const v of s) {
      const last = res[res.length - 1];
      if (last && last[1] === v) last[1] = v + 1;
      else res.push([v, v + 1]);
    }
    return res;
  };
  for (const [y, xs] of horizontal)
    for (const [x1, x2] of runs(xs)) out.push({ x1, y1: y, x2, y2: y });
  for (const [x, ys] of vertical)
    for (const [y1, y2] of runs(ys)) out.push({ x1: x, y1, x2: x, y2 });
  return out;
}

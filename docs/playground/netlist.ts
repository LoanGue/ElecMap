/**
 * From the drawing to SPICE: which wire ends, pins, grounds and labels share a
 * node, and the netlist the engine reads. Pure functions of the drawing.
 */
import { onSegment, pinsOf } from "./model";
import type { Drawing, Pt } from "./model";

const key = (x: number, y: number): string => `${x},${y}`;

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

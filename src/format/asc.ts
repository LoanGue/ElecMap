/**
 * LTspice schematic (`.asc`): the schematic of {@link layoutCircuit} redrawn
 * with LTspice's own symbols, so that the file opens, simulates and can be
 * edited in LTspice.
 *
 * - the elements are those of the portable netlist ({@link toCir}): same
 *   names, values and `.model` cards;
 * - every symbol sits where ElecMap draws the component, turned to match;
 *   short wires join its pins to the nets of the layout;
 * - every net carries a label with its name, so `V(out)` exists in LTspice;
 * - the connectivity of the drawing is checked against the netlist; a net
 *   that LTspice would read differently is drawn with labels instead of wires.
 *
 * @module
 */
import { portableCircuit } from "./cir";
import type { CirOptions } from "./cir";
import { formatSpice } from "./units";
import type { CircuitJSON } from "./types";
import type { PlacedComponent, SchematicLayout } from "../render/layout";

/** Options of {@link toAsc}. */
export type AscOptions = CirOptions;

/** LTspice units per layout grid step. */
const SCALE = 32;

export type Point = readonly [number, number];

/** A symbol of LTspice's library, its pins in SpiceOrder (from the `.asy` files). */
export interface AscSymbol {
  name: string;
  pins: Point[];
}

export const ASC_SYMBOLS: Record<string, AscSymbol> = {
  res: {
    name: "res",
    pins: [
      [16, 16],
      [16, 96],
    ],
  },
  cap: {
    name: "cap",
    pins: [
      [16, 0],
      [16, 64],
    ],
  },
  ind: {
    name: "ind",
    pins: [
      [16, 16],
      [16, 96],
    ],
  },
  voltage: {
    name: "voltage",
    pins: [
      [0, 16],
      [0, 96],
    ],
  },
  current: {
    name: "current",
    pins: [
      [0, 0],
      [0, 80],
    ],
  },
  diode: {
    name: "diode",
    pins: [
      [16, 0],
      [16, 64],
    ],
  },
  e: {
    name: "e",
    pins: [
      [0, 16],
      [0, 96],
      [-48, 32],
      [-48, 80],
    ],
  },
  g: {
    name: "g",
    pins: [
      [0, 96],
      [0, 16],
      [-48, 32],
      [-48, 80],
    ],
  },
  f: {
    name: "f",
    pins: [
      [0, 0],
      [0, 80],
    ],
  },
  h: {
    name: "h",
    pins: [
      [0, 16],
      [0, 96],
    ],
  },
  bv: {
    name: "bv",
    pins: [
      [0, 16],
      [0, 96],
    ],
  },
  bi: {
    name: "bi",
    pins: [
      [0, 0],
      [0, 80],
    ],
  },
  npn: {
    name: "npn",
    pins: [
      [64, 0],
      [0, 48],
      [64, 96],
    ],
  },
  pnp: {
    name: "pnp",
    pins: [
      [64, 0],
      [0, 48],
      [64, 96],
    ],
  },
  nmos: {
    name: "nmos",
    pins: [
      [48, 0],
      [0, 80],
      [48, 96],
    ],
  },
  pmos: {
    name: "pmos",
    pins: [
      [48, 0],
      [0, 80],
      [48, 96],
    ],
  },
  nmos4: {
    name: "nmos4",
    pins: [
      [48, 0],
      [0, 80],
      [48, 96],
      [48, 48],
    ],
  },
  pmos4: {
    name: "pmos4",
    pins: [
      [48, 0],
      [0, 80],
      [48, 96],
      [48, 48],
    ],
  },
  // In ElecMap's node order (in+, in−, out); SpiceOrder is in−, in+, out.
  opamp: {
    name: "Opamps\\opamp",
    pins: [
      [-32, 80],
      [-32, 48],
      [32, 64],
    ],
  },
};

/** LTspice's orientations: where a symbol point lands (y points down). */
export const ASC_TRANSFORMS: [string, (p: Point) => Point][] = [
  ["R0", ([x, y]) => [x, y]],
  ["R90", ([x, y]) => [-y, x]],
  ["R180", ([x, y]) => [-x, -y]],
  ["R270", ([x, y]) => [y, -x]],
  ["M0", ([x, y]) => [-x, y]],
  ["M90", ([x, y]) => [y, x]],
  ["M180", ([x, y]) => [x, -y]],
  ["M270", ([x, y]) => [-y, -x]],
];

const key = ([x, y]: Point) => `${x},${y}`;
const round16 = (v: number) => Math.round(v / 16) * 16;

export interface Wire {
  a: Point;
  b: Point;
}

/** A symbol to draw, with its pins in drawing coordinates. */
interface Placed {
  symbol: AscSymbol;
  rotation: string;
  origin: Point;
  attrs: [string, string][];
  /** Each pin, its net (SPICE name) and the layout point it joins (if any). */
  pins: { at: Point; node: string; to: Point | undefined }[];
}

/**
 * Nodes that LTspice would read differently from the netlist: shorted to
 * another node or split in pieces. LTspice joins wire ends, pins and labels
 * lying on the same point, and labels of the same name.
 */
export function ascConflicts(
  wires: readonly Wire[],
  pins: readonly { at: Point; node: string }[],
  flags: readonly { at: Point; node: string }[],
): Set<string> {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r) as string;
    parent.set(k, r);
    return r;
  };
  const join = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const points = [
    ...wires.flatMap((w) => [w.a, w.b]),
    ...pins.map((p) => p.at),
    ...flags.map((f) => f.at),
  ];
  for (const w of wires) {
    join(key(w.a), key(w.b));
    // A point inside a wire may touch it (LTspice versions differ): count it.
    for (const p of points) {
      const inX =
        w.a[1] === w.b[1] &&
        p[1] === w.a[1] &&
        p[0] > Math.min(w.a[0], w.b[0]) &&
        p[0] < Math.max(w.a[0], w.b[0]);
      const inY =
        w.a[0] === w.b[0] &&
        p[0] === w.a[0] &&
        p[1] > Math.min(w.a[1], w.b[1]) &&
        p[1] < Math.max(w.a[1], w.b[1]);
      if (inX || inY) join(key(p), key(w.a));
    }
  }
  for (const f of flags) join(key(f.at), `net:${f.node}`);
  const names = new Map<string, Set<string>>();
  const roots = new Map<string, Set<string>>();
  for (const p of [...pins, ...flags]) {
    const r = find(key(p.at));
    entry(names, r, () => new Set<string>()).add(p.node);
    entry(roots, p.node, () => new Set<string>()).add(r);
  }
  const bad = new Set<string>();
  for (const set of names.values()) if (set.size > 1) for (const n of set) bad.add(n);
  for (const [n, set] of roots) if (set.size > 1) bad.add(n);
  return bad;
}

/** Symbol of a portable element, or `undefined` when LTspice has none. */
function symbolOf(
  c: PlacedComponent["component"],
  name: string,
  value: string,
): AscSymbol | undefined {
  switch (name[0]) {
    case "R":
      return ASC_SYMBOLS.res;
    case "C":
      return ASC_SYMBOLS.cap;
    case "L":
      return ASC_SYMBOLS.ind;
    case "V":
      return ASC_SYMBOLS.voltage;
    case "I":
      return ASC_SYMBOLS.current;
    case "D":
      return ASC_SYMBOLS.diode;
    case "E":
      return c.type === "opamp" ? ASC_SYMBOLS.opamp : ASC_SYMBOLS.e;
    case "G":
      return ASC_SYMBOLS.g;
    case "F":
      return ASC_SYMBOLS.f;
    case "H":
      return ASC_SYMBOLS.h;
    case "B":
      return /^I\s*=/i.test(value) ? ASC_SYMBOLS.bi : ASC_SYMBOLS.bv;
    case "Q":
      return c.type === "bjt" && c.polarity === "pnp" ? ASC_SYMBOLS.pnp : ASC_SYMBOLS.npn;
    case "M": {
      if (c.type !== "mosfet") return undefined;
      const four = c.nodes[3] !== c.nodes[2];
      return ASC_SYMBOLS[`${c.polarity}${four ? "4" : ""}`];
    }
    case "X":
      return c.type === "opamp" ? ASC_SYMBOLS.opamp : undefined;
    default:
      return undefined;
  }
}

/** Orientation and position that put the symbol's pins closest to the layout's. */
function fit(
  symbol: AscSymbol,
  targets: Point[],
): { rotation: string; origin: Point; at: Point[] } {
  const n = targets.length;
  let best: { rotation: string; origin: Point; at: Point[]; cost: number } | undefined;
  for (const [rotation, t] of ASC_TRANSFORMS) {
    const moved = symbol.pins.slice(0, n).map(t);
    const cx = (v: Point[], i: 0 | 1) => v.reduce((s, p) => s + p[i], 0) / n;
    const origin: Point = [
      round16(cx(targets, 0) - cx(moved, 0)),
      round16(cx(targets, 1) - cx(moved, 1)),
    ];
    const at = symbol.pins.map(t).map(([x, y]): Point => [x + origin[0], y + origin[1]]);
    // Distance, plus how far the pins leave the axis of their layout pin.
    const cost = targets.reduce((s, [x, y], i) => {
      const [px, py] = at[i] as Point;
      return s + Math.hypot(px - x, py - y) + 4 * Math.min(Math.abs(px - x), Math.abs(py - y));
    }, 0);
    if (!best || cost < best.cost - 1e-9) best = { rotation, origin, at, cost };
  }
  const { rotation, origin, at } = best as NonNullable<typeof best>;
  return { rotation, origin, at };
}

/**
 * Writes a circuit as an LTspice schematic, drawn from its layout
 * (see {@link layoutCircuit} with `ground: "symbols"`).
 */
export function toAsc(
  circuit: CircuitJSON,
  layout: SchematicLayout,
  options: AscOptions = {},
): string {
  const p = portableCircuit(circuit, options);
  const placedById = new Map(layout.components.map((c) => [c.id, c]));
  const scaled = ([x, y]: Point): Point => [x * SCALE, y * SCALE];

  const symbols: Placed[] = [];
  const texts: string[] = [];
  let usesOpamp = false;
  for (const e of p.elements) {
    const c = e.component;
    if (c.type === "coupling") {
      texts.push(`!${e.line}`);
      continue;
    }
    const placed = placedById.get(c.id);
    if (e.name === undefined || !placed) {
      if (e.name !== undefined) texts.push(`!${e.line}`);
      else texts.push(`;${e.line.replace(/^\*\s*/, "")}`);
      continue;
    }
    const symbol = symbolOf(c, e.name, e.value);
    if (!symbol) {
      texts.push(`!${e.line}`);
      continue;
    }
    const nodes =
      symbol === ASC_SYMBOLS.opamp && c.type === "opamp" ? c.nodes.map((n) => p.node(n)) : e.nodes;
    const targets = placed.pins.map((q): Point => scaled([q.x, q.y]));
    const { rotation, origin, at } = fit(symbol, targets);
    // LTspice names an op-amp after its prefix X (the ideal one is an E here).
    const inst = symbol === ASC_SYMBOLS.opamp ? e.name.replace(/^EX/, "X") : e.name;
    const attrs: [string, string][] = [["InstName", inst]];
    if (symbol === ASC_SYMBOLS.opamp && c.type === "opamp") {
      usesOpamp = true;
      attrs.push(["Value", "opamp"]);
      attrs.push(["SpiceLine", `Aol=${formatSpice(c.gain ?? options.idealGain ?? 1e6)}`]);
      attrs.push(["SpiceLine2", `GBW=${formatSpice(c.gbw ?? 1e12)}`]);
    } else attrs.push(["Value", e.value]);
    symbols.push({
      symbol,
      rotation,
      origin,
      attrs,
      pins: at.map((q, i) => ({ at: q, node: nodes[i] as string, to: targets[i] })),
    });
  }

  // Nets of the layout, scaled; ground pins get a ground label.
  const netWires = new Map<string, Wire[]>();
  for (const net of layout.nets) {
    const name = p.node(net.node);
    const list = entry(netWires, name, (): Wire[] => []);
    for (const s of net.segments) list.push({ a: scaled([s.x1, s.y1]), b: scaled([s.x2, s.y2]) });
  }
  const labelled = new Set<string>();
  let draw = build();
  for (let k = 0; k < 8; k++) {
    const bad = ascConflicts(draw.wires, draw.pins, draw.flags);
    if (bad.size === 0) break;
    for (const n of bad) labelled.add(n);
    draw = build();
  }

  function build() {
    const wires: Wire[] = [];
    const flags: { at: Point; node: string }[] = [];
    const pins: { at: Point; node: string }[] = [];
    const flagged = new Set<string>();
    for (const [node, list] of netWires) if (!labelled.has(node)) wires.push(...list);
    for (const s of symbols) {
      for (const pin of s.pins) {
        pins.push({ at: pin.at, node: pin.node });
        if (labelled.has(pin.node) || !pin.to) {
          flags.push({ at: pin.at, node: pin.node });
          continue;
        }
        const [x, y] = pin.at;
        const [tx, ty] = pin.to;
        if (x !== tx && y !== ty) {
          wires.push({ a: pin.at, b: [tx, y] }, { a: [tx, y], b: pin.to });
        } else if (x !== tx || y !== ty) wires.push({ a: pin.at, b: pin.to });
        // One label per net, on its first pin; the ground everywhere.
        if (pin.node === "0" || !flagged.has(pin.node)) flags.push({ at: pin.to, node: pin.node });
        flagged.add(pin.node);
      }
    }
    return {
      wires: split(wires, [...pins.map((q) => q.at), ...flags.map((f) => f.at)]),
      pins,
      flags,
    };
  }

  // Sheet: the drawing, then the directives below it.
  const xs = [...draw.wires.flatMap((w) => [w.a[0], w.b[0]]), ...draw.pins.map((q) => q.at[0])];
  const ys = [...draw.wires.flatMap((w) => [w.a[1], w.b[1]]), ...draw.pins.map((q) => q.at[1])];
  const minX = Math.min(0, ...xs) - 64;
  const maxX = Math.max(0, ...xs) + 64;
  const maxY = Math.max(0, ...ys) + 64;
  const analysis = options.analysis ?? ".op";
  const directives = [
    // The op-amps use LTspice's own model: drop their subcircuits.
    ...withoutOpampSubckts(p.directives),
    ...(usesOpamp ? [".lib opamp.sub"] : []),
    ...texts.filter((t) => t.startsWith("!")).map((t) => t.slice(1)),
    ...(typeof analysis === "string" ? [analysis] : analysis),
  ];
  const out = ["Version 4", `SHEET 1 ${maxX - minX + 64} ${maxY + 64 + 32 * directives.length}`];
  for (const w of draw.wires) out.push(`WIRE ${w.a[0]} ${w.a[1]} ${w.b[0]} ${w.b[1]}`);
  for (const f of draw.flags) out.push(`FLAG ${f.at[0]} ${f.at[1]} ${f.node}`);
  for (const s of symbols) {
    out.push(`SYMBOL ${s.symbol.name} ${s.origin[0]} ${s.origin[1]} ${s.rotation}`);
    for (const [k, v] of s.attrs) out.push(`SYMATTR ${k} ${v}`);
  }
  let y = maxY + 32;
  out.push(`TEXT ${minX} ${y} Left 2 ;${p.title}`);
  for (const t of texts.filter((t) => t.startsWith(";")))
    out.push(`TEXT ${minX} ${(y += 32)} Left 2 ${t}`);
  // A multi-line directive is one TEXT, its lines joined by a literal "\n".
  out.push(`TEXT ${minX} ${y + 32} Left 2 !${directives.join("\\n")}`);
  return `${out.join("\n")}\n`;
}

/** Directives without the subcircuits of the op-amps. */
function withoutOpampSubckts(directives: readonly string[]): string[] {
  const out: string[] = [];
  let skip = false;
  for (const d of directives) {
    if (d.startsWith(".subckt OPAMP_")) skip = true;
    if (!skip) out.push(d);
    if (d.startsWith(".ends")) skip = false;
  }
  return out;
}

/** The value of `key`, created by `make` when missing. */
function entry<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  let v = map.get(key);
  if (v === undefined) {
    v = make();
    map.set(key, v);
  }
  return v;
}

/** Cuts wires at every point lying inside them, so that every contact is an end. */
function split(wires: readonly Wire[], extra: readonly Point[]): Wire[] {
  const points = [...wires.flatMap((w) => [w.a, w.b]), ...extra];
  const seen = new Set<string>();
  const out: Wire[] = [];
  for (const w of wires) {
    const horizontal = w.a[1] === w.b[1];
    const axis = horizontal ? 0 : 1;
    const lo = Math.min(w.a[axis], w.b[axis]);
    const hi = Math.max(w.a[axis], w.b[axis]);
    const cuts = [
      lo,
      ...points
        .filter((q) => q[1 - axis] === w.a[1 - axis] && q[axis] > lo && q[axis] < hi)
        .map((q) => q[axis]),
      hi,
    ];
    const sorted = [...new Set(cuts)].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      const lo2 = sorted[i - 1] as number;
      const hi2 = sorted[i] as number;
      const a: Point = horizontal ? [lo2, w.a[1]] : [w.a[0], lo2];
      const b: Point = horizontal ? [hi2, w.a[1]] : [w.a[0], hi2];
      const k = `${key(a)}-${key(b)}`;
      if (a[0] === b[0] && a[1] === b[1]) continue;
      if (!seen.has(k)) out.push({ a, b });
      seen.add(k);
    }
  }
  return out;
}

/**
 * Drawing model of the playground editor: the parts, wires, grounds and labels
 * on the grid, and where each part's pins are. Pure data and geometry.
 */
import type { Orientation } from "../../src";
import type { Pt, Wire } from "./wires";

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
  | "ccvs"
  | "bsource";

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

export type { Pt, Wire };

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

export const PREFIX: Record<Kind, string> = {
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
  bsource: "B",
};

export const DEFAULT_VALUE: Partial<Record<Kind, string>> = {
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
  bsource: "V=5*sin(2*pi*1k*time)",
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
  "bsource",
  "npn",
  "pnp",
  "nmos",
  "pmos",
];

export const TWO_TERMINAL = new Set<Kind>([
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
  "bsource",
]);

export const DIRS: Record<Orientation, [number, number]> = {
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
  up: [0, -1],
};
export const TURN: Record<Orientation, Orientation> = {
  right: "down",
  down: "left",
  left: "up",
  up: "right",
};

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
export function centerOffset(kind: Kind, dir: Orientation): Pt {
  if (TWO_TERMINAL.has(kind)) {
    const [dx, dy] = DIRS[dir];
    return { x: 2 * dx, y: 2 * dy };
  }
  return kind === "opamp" ? { x: -2, y: 0 } : { x: -1, y: 3 };
}

export const rotatable = (kind: Kind): boolean => TWO_TERMINAL.has(kind);

export function onSegment(p: Pt, w: Wire): boolean {
  if (w.x1 === w.x2) {
    return p.x === w.x1 && p.y >= Math.min(w.y1, w.y2) && p.y <= Math.max(w.y1, w.y2);
  }
  if (w.y1 === w.y2) {
    return p.y === w.y1 && p.x >= Math.min(w.x1, w.x2) && p.x <= Math.max(w.x1, w.x2);
  }
  return false;
}

/** Distance from a point to a segment (grid units). */
export function distance(p: Pt, w: Wire): number {
  const vx = w.x2 - w.x1;
  const vy = w.y2 - w.y1;
  const len = vx * vx + vy * vy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - w.x1) * vx + (p.y - w.y1) * vy) / len));
  return Math.hypot(p.x - (w.x1 + t * vx), p.y - (w.y1 + t * vy));
}

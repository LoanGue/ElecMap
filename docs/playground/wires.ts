/**
 * Wires of the block editor, and how to keep them as simple as possible.
 *
 * Wires are horizontal or vertical segments on the grid. A wire end connects
 * to whatever lies at that point (a pin, another wire, even in its middle);
 * crossing wires do not connect. Anchors are the points that are never merged
 * away: pins, grounds, labels and the nodes the user created.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Wire {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const key = (p: Pt): string => `${p.x},${p.y}`;
export const endsOf = (w: Wire): [Pt, Pt] => [
  { x: w.x1, y: w.y1 },
  { x: w.x2, y: w.y2 },
];
export const segment = (a: Pt, b: Pt): Wire => ({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
export const straight = (w: Wire): boolean => w.x1 === w.x2 || w.y1 === w.y2;
export const horizontal = (w: Wire): boolean => w.y1 === w.y2 && w.x1 !== w.x2;

/** Unit steps covered by a wire: `x,y,h` goes right from (x, y), `x,y,v` goes down. */
export function steps(w: Wire): string[] {
  const out: string[] = [];
  if (w.y1 === w.y2) {
    for (let x = Math.min(w.x1, w.x2); x < Math.max(w.x1, w.x2); x++) out.push(`${x},${w.y1},h`);
  } else if (w.x1 === w.x2) {
    for (let y = Math.min(w.y1, w.y2); y < Math.max(w.y1, w.y2); y++) out.push(`${w.x1},${y},v`);
  }
  return out;
}

/** Grid points covered by a wire, ends included. */
export function points(w: Wire): string[] {
  const out: string[] = [];
  const n = Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1);
  const sx = Math.sign(w.x2 - w.x1);
  const sy = Math.sign(w.y2 - w.y1);
  for (let i = 0; i <= n; i++) out.push(`${w.x1 + i * sx},${w.y1 + i * sy}`);
  return out;
}

/** Which steps of `set` leave (x, y): right, left, down, up. */
export function arms(set: Set<string>, x: number, y: number): [boolean, boolean, boolean, boolean] {
  return [
    set.has(`${x},${y},h`),
    set.has(`${x - 1},${y},h`),
    set.has(`${x},${y},v`),
    set.has(`${x},${y - 1},v`),
  ];
}

/**
 * The same wiring with the fewest wires: overlaps merge, zero-length wires go,
 * and wires meeting in line at a free point become one. Wires still end at
 * every bend, junction and anchor, so the connections do not change.
 */
export function simplify(wires: Wire[], anchors: Pt[]): Wire[] {
  const set = new Set<string>();
  const fixed = new Set(anchors.map(key));
  const conn = new Set(fixed);
  const odd: Wire[] = [];
  for (const w of wires) {
    if (!straight(w)) odd.push(w);
    else if (w.x1 !== w.x2 || w.y1 !== w.y2) {
      for (const s of steps(w)) set.add(s);
      for (const p of endsOf(w)) conn.add(key(p));
    }
  }
  const stop = (x: number, y: number): boolean => {
    const k = `${x},${y}`;
    if (!conn.has(k)) return false;
    if (fixed.has(k)) return true;
    const [r, l, d, u] = arms(set, x, y);
    const n = [r, l, d, u].filter(Boolean).length;
    return !(n === 2 && ((r && l) || (d && u)));
  };
  const out: Wire[] = [];
  const seen = new Set<string>();
  for (const s of set) {
    if (seen.has(s)) continue;
    const [sx, sy, dir] = s.split(",");
    const x = Number(sx);
    const y = Number(sy);
    if (dir === "h") {
      let a = x;
      while (!stop(a, y) && set.has(`${a - 1},${y},h`)) a--;
      let b = x + 1;
      while (!stop(b, y) && set.has(`${b},${y},h`)) b++;
      for (let i = a; i < b; i++) seen.add(`${i},${y},h`);
      out.push({ x1: a, y1: y, x2: b, y2: y });
    } else {
      let a = y;
      while (!stop(x, a) && set.has(`${x},${a - 1},v`)) a--;
      let b = y + 1;
      while (!stop(x, b) && set.has(`${x},${b},v`)) b++;
      for (let i = a; i < b; i++) seen.add(`${x},${i},v`);
      out.push({ x1: x, y1: a, x2: x, y2: b });
    }
  }
  return [...out, ...odd];
}

/** Wire ends that touch nothing (no other wire, no anchor). Diagonal wires count by their ends. */
export function looseEnds(wires: Wire[], anchors: Pt[]): Set<string> {
  const set = new Set(wires.flatMap(steps));
  const diagonal = wires.filter((w) => !straight(w)).flatMap(endsOf);
  const fixed = new Set([...anchors, ...diagonal].map(key));
  const out = new Set<string>();
  for (const w of wires) {
    if (!straight(w)) continue;
    for (const p of endsOf(w)) {
      const n = arms(set, p.x, p.y).filter(Boolean).length;
      if (n === 1 && !fixed.has(key(p))) out.add(key(p));
    }
  }
  return out;
}

/** Removes the wires left hanging by an edit (loose ends listed in `keep` stay). */
export function prune(wires: Wire[], anchors: Pt[], keep: Set<string>): Wire[] {
  let out = simplify(wires, anchors);
  for (;;) {
    const loose = looseEnds(out, anchors);
    const next = out.filter((w) => !endsOf(w).some((p) => loose.has(key(p)) && !keep.has(key(p))));
    if (next.length === out.length) return out;
    out = simplify(next, anchors);
  }
}

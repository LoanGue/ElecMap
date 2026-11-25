/**
 * Wire routing of the block editor: keeps the wiring as simple as possible.
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

/** A point that moves, from → to. */
export type Move = [Pt, Pt];

export interface RouteContext {
  /** Anchors that stay in place (the moving points are given by the moves). */
  anchors: Pt[];
  /** Grid points covered by part bodies after the move: wires go around them. */
  blocked: Set<string>;
}

const key = (p: Pt): string => `${p.x},${p.y}`;
const endsOf = (w: Wire): [Pt, Pt] => [
  { x: w.x1, y: w.y1 },
  { x: w.x2, y: w.y2 },
];
const segment = (a: Pt, b: Pt): Wire => ({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
const straight = (w: Wire): boolean => w.x1 === w.x2 || w.y1 === w.y2;
const horizontal = (w: Wire): boolean => w.y1 === w.y2 && w.x1 !== w.x2;

/** Unit steps covered by a wire: `x,y,h` goes right from (x, y), `x,y,v` goes down. */
function steps(w: Wire): string[] {
  const out: string[] = [];
  if (w.y1 === w.y2) {
    for (let x = Math.min(w.x1, w.x2); x < Math.max(w.x1, w.x2); x++) out.push(`${x},${w.y1},h`);
  } else if (w.x1 === w.x2) {
    for (let y = Math.min(w.y1, w.y2); y < Math.max(w.y1, w.y2); y++) out.push(`${w.x1},${y},v`);
  }
  return out;
}

/** Grid points covered by a wire, ends included. */
function points(w: Wire): string[] {
  const out: string[] = [];
  const n = Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1);
  const sx = Math.sign(w.x2 - w.x1);
  const sy = Math.sign(w.y2 - w.y1);
  for (let i = 0; i <= n; i++) out.push(`${w.x1 + i * sx},${w.y1 + i * sy}`);
  return out;
}

/** Which steps of `set` leave (x, y): right, left, down, up. */
function arms(set: Set<string>, x: number, y: number): boolean[] {
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

/** Wire ends that touch nothing (no other wire, no anchor). */
export function looseEnds(wires: Wire[], anchors: Pt[]): Set<string> {
  const set = new Set(wires.flatMap(steps));
  const fixed = new Set(anchors.map(key));
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
function prune(wires: Wire[], anchors: Pt[], keep: Set<string>): Wire[] {
  let out = simplify(wires, anchors);
  for (;;) {
    const loose = looseEnds(out, anchors);
    const next = out.filter((w) => !endsOf(w).some((p) => loose.has(key(p)) && !keep.has(key(p))));
    if (next.length === out.length) return out;
    out = simplify(next, anchors);
  }
}

// ---------------------------------------------------------------- routes

interface Rules {
  /** Steps and points of the other nets: never run along them. */
  foreignSteps: Set<string>;
  foreignPoints: Set<string>;
  /** Steps of the same net: running along them hides the wiring. */
  ownSteps: Set<string>;
  blocked: Set<string>;
  /** Direction the old wire left the fixed end with. */
  prefer: "h" | "v" | undefined;
  /** Direction the old wire reached the moved pin with. */
  enter: "h" | "v" | undefined;
}

/** The path through `pts` without repeated points or joints in line. */
function clean(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const before = out[out.length - 2];
    const inLine =
      last &&
      before &&
      ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y));
    if (inLine) out.pop();
    out.push(p);
  }
  return out;
}

function score(path: Pt[], rules: Rules): number {
  const wires = path.slice(1).map((p, i) => segment(path[i] as Pt, p));
  let cost = (wires.length - 1) * 100;
  for (const w of wires) {
    cost += Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1);
    for (const s of steps(w)) {
      if (rules.foreignSteps.has(s)) cost += 1000;
      if (rules.ownSteps.has(s)) cost += 20;
    }
    for (const k of points(w)) {
      if (rules.foreignPoints.has(k)) cost += 1000;
      if (rules.blocked.has(k)) cost += 300;
    }
  }
  const first = wires[0];
  if (first && rules.prefer && (horizontal(first) ? "h" : "v") !== rules.prefer) cost += 1;
  const last = wires[wires.length - 1];
  if (last && rules.enter && (horizontal(last) ? "h" : "v") !== rules.enter) cost += 2;
  return cost;
}

/** The cheapest path from `a` to `b`: straight, then one bend, then two. */
function route(a: Pt, b: Pt, rules: Rules): { wires: Wire[]; cost: number } {
  const paths: Pt[][] = [
    [a, { x: b.x, y: a.y }, b],
    [a, { x: a.x, y: b.y }, b],
  ];
  const span = (u: number, v: number) => {
    const out: number[] = [];
    for (let m = Math.min(u, v) - 3; m <= Math.max(u, v) + 3; m++) out.push(m);
    return out;
  };
  for (const m of span(a.x, b.x)) paths.push([a, { x: m, y: a.y }, { x: m, y: b.y }, b]);
  for (const m of span(a.y, b.y)) paths.push([a, { x: a.x, y: m }, { x: b.x, y: m }, b]);
  let best = { wires: [] as Wire[], cost: Infinity };
  for (const raw of paths) {
    const path = clean(raw);
    const cost = path.length < 2 ? 0 : score(path, rules);
    if (cost < best.cost)
      best = { wires: path.slice(1).map((p, i) => segment(path[i] as Pt, p)), cost };
  }
  return best;
}

/**
 * Where the end of a straight stem can slide to on the bar of a T, so that the
 * moved pin at `to` still meets the bar at a right angle.
 */
function slide(at: Pt, stem: Wire, bar: Wire[], to: Pt): Pt | undefined {
  if (bar.length !== 2 || bar.some((w) => horizontal(w) === horizontal(stem))) return undefined;
  if (horizontal(bar[0] as Wire)) {
    const xs = bar.flatMap((w) => [w.x1, w.x2]);
    if (to.y === at.y || to.x <= Math.min(...xs) || to.x >= Math.max(...xs)) return undefined;
    return { x: to.x, y: at.y };
  }
  const ys = bar.flatMap((w) => [w.y1, w.y2]);
  if (to.x === at.x || to.y <= Math.min(...ys) || to.y >= Math.max(...ys)) return undefined;
  return { x: at.x, y: to.y };
}

/** Electrical net of each point touched by a wire (by its key). */
function nets(wires: Wire[]): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r) as string;
    return r;
  };
  for (const w of wires) {
    const [a, b] = endsOf(w).map((p) => find(key(p))) as [string, string];
    parent.set(a, a);
    if (a !== b) parent.set(b, a);
  }
  const out = new Map<string, string>();
  for (const w of wires)
    for (const k of points(w)) if (!out.has(k)) out.set(k, find(key(endsOf(w)[0])));
  return out;
}

/**
 * Wiring after some points moved (the pins of a dragged part, a ground…).
 * Each wire chain from a moved point back to its first fixed point (an anchor,
 * a junction) is drawn again with the fewest bends, around the other nets and
 * the part bodies. A straight stem of a T slides along the bar instead, so the
 * T stays a T. Chains whose both ends move, or that end nowhere, follow.
 */
export function reroute(wires: Wire[], moves: Move[], ctx: RouteContext): Wire[] {
  const before = [...ctx.anchors, ...moves.map((m) => m[0])];
  const after = [...ctx.anchors, ...moves.map((m) => m[1])];
  const runs = simplify(wires, before);
  const keep = looseEnds(runs, before);
  const fixed = new Set(before.map(key));
  const moving = new Set(moves.map((m) => key(m[0])));
  const at = new Map<string, number[]>();
  runs.forEach((w, i) => {
    for (const p of endsOf(w)) at.set(key(p), [...(at.get(key(p)) ?? []), i]);
  });
  const net = nets(runs);
  const done = new Set<number>();
  const added: Wire[] = [];
  const far = (w: Wire, p: Pt): Pt => {
    const [a, b] = endsOf(w);
    return a.x === p.x && a.y === p.y ? b : a;
  };

  /** What a new wire from `from`'s net to `to` must stay away from. */
  const rulesFor = (from: Pt, to: Pt, chain: number[], prefer?: Rules["prefer"]): Rules => {
    const start = runs[chain[0] ?? -1];
    const netOf = (p: Pt) => net.get(key(p)) ?? key(p);
    const own = netOf(from);
    const origin = (i: number) =>
      i < ctx.anchors.length ? (after[i] as Pt) : (moves[i - ctx.anchors.length] as Move)[0];
    return {
      foreignSteps: new Set(
        runs.flatMap((w, i) => (chain.includes(i) || netOf(endsOf(w)[0]) === own ? [] : steps(w))),
      ),
      ownSteps: new Set(
        runs.flatMap((w, i) => (!chain.includes(i) && netOf(endsOf(w)[0]) === own ? steps(w) : [])),
      ),
      foreignPoints: new Set(
        after.filter((p, i) => (p.x !== to.x || p.y !== to.y) && netOf(origin(i)) !== own).map(key),
      ),
      blocked: ctx.blocked,
      prefer,
      enter: start && (horizontal(start) ? "h" : "v"),
    };
  };

  for (const [from, to] of moves) {
    for (const first of at.get(key(from)) ?? []) {
      if (done.has(first)) continue;
      const chain = [first];
      let end = far(runs[first] as Wire, from);
      while (!fixed.has(key(end)) && at.get(key(end))?.length === 2) {
        const next = at.get(key(end))?.find((j) => !chain.includes(j));
        if (next === undefined) break;
        chain.push(next);
        end = far(runs[next] as Wire, end);
      }
      for (const j of chain) done.add(j);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if (moving.has(key(end)) || ((at.get(key(end))?.length ?? 0) === 1 && !fixed.has(key(end)))) {
        if (!moving.has(key(end))) keep.add(key({ x: end.x + dx, y: end.y + dy }));
        for (const j of chain) {
          const w = runs[j] as Wire;
          added.push({ x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy });
        }
        continue;
      }
      const last = runs[chain[chain.length - 1] as number] as Wire;
      const rules = rulesFor(from, to, chain, horizontal(last) ? "h" : "v");
      let best = route(end, to, rules);
      const ids = at.get(key(end)) ?? [];
      if (chain.length === 1 && !fixed.has(key(end)) && ids.length === 3) {
        const bar = ids.filter((j) => j !== first).map((j) => runs[j] as Wire);
        const slid = slide(end, last, bar, to);
        const alt = slid && route(slid, to, rules);
        if (alt && alt.cost <= best.cost) best = alt;
      }
      added.push(...best.wires);
    }
    // A pin set right on a ground, a label or another pin keeps that connection.
    const touching = ctx.anchors.some((q) => q.x === from.x && q.y === from.y);
    if (touching && (from.x !== to.x || from.y !== to.y)) {
      added.push(...route(from, to, rulesFor(from, to, [])).wires);
    }
  }
  return prune([...runs.filter((_, i) => !done.has(i)), ...added], after, keep);
}

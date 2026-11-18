/** Integer grid point `[x, y]`. */
export type GridPoint = readonly [number, number];

/** Rectangle in grid units (inclusive). */
export interface GridBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;
const NO_DIR = 4;

/** Wire usage of a grid vertex by one net. */
interface Usage {
  net: string;
  h: boolean;
  v: boolean;
  /** Pin, bend, junction or end point: no other net may cross here. */
  node: boolean;
}

/** Costs of the router (in grid steps). */
const COST = {
  step: 1,
  bend: 4,
  crossing: 8,
  soft: 6,
  /** Penalty of a forbidden move in the relaxed (fallback) pass. */
  relaxed: 400,
} as const;

/** Binary min-heap of `[priority, value]`. */
class Heap {
  private readonly keys: number[] = [];
  private readonly values: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, value: number): void {
    const { keys, values } = this;
    let i = keys.length;
    keys.push(key);
    values.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((keys[p] as number) <= key) break;
      keys[i] = keys[p] as number;
      values[i] = values[p] as number;
      i = p;
    }
    keys[i] = key;
    values[i] = value;
  }

  pop(): number {
    const { keys, values } = this;
    const top = values[0] as number;
    const lastK = keys.pop() as number;
    const lastV = values.pop() as number;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && (keys[r] as number) < (keys[l] as number) ? r : l;
        if ((keys[c] as number) >= lastK) break;
        keys[i] = keys[c] as number;
        values[i] = values[c] as number;
        i = c;
      }
      keys[i] = lastK;
      values[i] = lastV;
    }
    return top;
  }
}

/**
 * Orthogonal maze router on an integer grid (A* with bend and crossing costs).
 *
 * Rules enforced between different nets: no shared segment, no touching at a
 * pin / bend / junction; perpendicular crossings are allowed but penalised.
 * Component bodies are hard obstacles, labels soft ones. When no legal path
 * exists the route is retried with every rule turned into a large penalty, so
 * routing never fails.
 */
export class Router {
  private readonly width: number;
  private readonly height: number;
  private readonly hard = new Set<number>();
  private readonly soft = new Set<number>();
  private readonly usage = new Map<number, Usage[]>();
  private readonly edgeNet = new Map<number, string>();
  /** Unit edges used by each net, `[from, to]` vertex indices. */
  readonly netEdges = new Map<string, [number, number][]>();

  constructor(readonly bounds: GridBounds) {
    this.width = bounds.maxX - bounds.minX + 1;
    this.height = bounds.maxY - bounds.minY + 1;
  }

  /** Vertex index of a grid point. */
  index(x: number, y: number): number {
    return (y - this.bounds.minY) * this.width + (x - this.bounds.minX);
  }

  /** Grid point of a vertex index. */
  point(i: number): [number, number] {
    return [(i % this.width) + this.bounds.minX, Math.floor(i / this.width) + this.bounds.minY];
  }

  private inside(x: number, y: number): boolean {
    const b = this.bounds;
    return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
  }

  private edgeKey(a: number, b: number): number {
    return a < b ? a * 4 + (b - a === 1 ? 0 : 1) : b * 4 + (a - b === 1 ? 0 : 1);
  }

  /** Marks a vertex as a hard obstacle (component body, ground symbol). */
  block(x: number, y: number): void {
    if (this.inside(x, y)) this.hard.add(this.index(x, y));
  }

  /** Marks a vertex as a soft obstacle (text). */
  discourage(x: number, y: number): void {
    if (this.inside(x, y)) this.soft.add(this.index(x, y));
  }

  /** Whether a vertex is free of hard obstacles and of wires of other nets. */
  isFree(net: string, x: number, y: number): boolean {
    if (!this.inside(x, y)) return false;
    const i = this.index(x, y);
    return !this.hard.has(i) && this.foreign(i, net).length === 0;
  }

  /** Registers a pin of `net`: a fixed connection point. */
  pin(net: string, x: number, y: number): void {
    this.use(this.index(x, y), net, false, false, true);
  }

  private use(i: number, net: string, h: boolean, v: boolean, node: boolean): void {
    const list = this.usage.get(i) ?? [];
    const own = list.find((u) => u.net === net);
    if (own) {
      own.h ||= h;
      own.v ||= v;
      own.node ||= node || (own.h && own.v);
    } else {
      list.push({ net, h, v, node: node || (h && v) });
      this.usage.set(i, list);
    }
  }

  /**
   * Shortest legal path from `from` to any vertex of `targets` (vertex
   * indices of the same net). Returns the vertex indices, start first.
   */
  route(net: string, from: GridPoint, targets: ReadonlySet<number>): number[] {
    const start = this.index(from[0], from[1]);
    if (targets.has(start)) return [start];
    return (
      this.search(net, start, targets, false) ?? this.search(net, start, targets, true) ?? [start]
    );
  }

  private search(
    net: string,
    start: number,
    targets: ReadonlySet<number>,
    relaxed: boolean,
  ): number[] | undefined {
    const n = this.width * this.height;
    // Heuristic: distance to the bounding box of the targets (admissible).
    let tx0 = Infinity;
    let ty0 = Infinity;
    let tx1 = -Infinity;
    let ty1 = -Infinity;
    for (const t of targets) {
      const [x, y] = this.point(t);
      tx0 = Math.min(tx0, x);
      ty0 = Math.min(ty0, y);
      tx1 = Math.max(tx1, x);
      ty1 = Math.max(ty1, y);
    }
    const heuristic = (x: number, y: number) =>
      Math.max(0, tx0 - x, x - tx1) + Math.max(0, ty0 - y, y - ty1);

    const states = n * 5;
    const cost = new Float64Array(states).fill(Infinity);
    const prev = new Int32Array(states).fill(-1);
    const heap = new Heap();
    const s0 = start * 5 + NO_DIR;
    cost[s0] = 0;
    const [sx, sy] = this.point(start);
    heap.push(heuristic(sx, sy), s0);

    while (heap.size > 0) {
      const s = heap.pop();
      const v = Math.floor(s / 5);
      const d = s % 5;
      const c = cost[s] as number;
      if (v !== start && targets.has(v)) return this.trace(prev, s);
      const [x, y] = this.point(v);
      const crossingHere = v !== start && this.foreign(v, net).length > 0;
      for (let nd = 0; nd < 4; nd++) {
        if (d !== NO_DIR && nd === (d + 2) % 4) continue;
        if (crossingHere && nd !== d) continue;
        const nx = x + (DX[nd] as number);
        const ny = y + (DY[nd] as number);
        if (!this.inside(nx, ny)) continue;
        const w = this.index(nx, ny);
        let step: number = COST.step;
        if (d !== NO_DIR && nd !== d) step += COST.bend;
        const isTarget = targets.has(w);
        const edgeOwner = this.edgeNet.get(this.edgeKey(v, w));
        if (edgeOwner !== undefined && edgeOwner !== net) {
          if (!relaxed) continue;
          step += COST.relaxed;
        }
        if (this.hard.has(w) && !isTarget) {
          if (!relaxed) continue;
          step += COST.relaxed;
        }
        if (this.soft.has(w)) step += COST.soft;
        const horizontal = nd === 0 || nd === 2;
        for (const u of this.foreign(w, net)) {
          const legal = !isTarget && !u.node && (horizontal ? !u.h : !u.v);
          if (!legal) {
            if (!relaxed) {
              step = Infinity;
              break;
            }
            step += COST.relaxed;
          } else step += COST.crossing;
        }
        if (step === Infinity) continue;
        // A path may not run through an unconnected pin of its own net.
        if (!isTarget && this.usage.get(w)?.some((u) => u.net === net && u.node)) {
          if (!relaxed) continue;
          step += COST.relaxed;
        }
        const ns = w * 5 + nd;
        const nc = c + step;
        if (nc < (cost[ns] as number)) {
          cost[ns] = nc;
          prev[ns] = s;
          heap.push(nc + heuristic(nx, ny), ns);
        }
      }
    }
    return undefined;
  }

  private foreign(i: number, net: string): Usage[] {
    return (this.usage.get(i) ?? []).filter((u) => u.net !== net);
  }

  private trace(prev: Int32Array, s: number): number[] {
    const path: number[] = [];
    let cur = s;
    while (cur >= 0) {
      path.push(Math.floor(cur / 5));
      cur = prev[cur] as number;
    }
    return path.reverse();
  }

  /** Records a routed path of `net`. */
  commit(net: string, path: readonly number[]): void {
    const edges = this.netEdges.get(net) ?? [];
    this.netEdges.set(net, edges);
    for (let k = 0; k < path.length; k++) {
      const v = path[k] as number;
      const a = path[k - 1];
      const b = path[k + 1];
      const horiz = (o: number | undefined) => o !== undefined && Math.abs(o - v) === 1;
      const vert = (o: number | undefined) => o !== undefined && Math.abs(o - v) > 1;
      const end = a === undefined || b === undefined;
      const bend = !end && horiz(a) !== horiz(b);
      this.use(v, net, horiz(a) || horiz(b), vert(a) || vert(b), end || bend);
      if (b !== undefined) {
        this.edgeNet.set(this.edgeKey(v, b), net);
        edges.push([v, b]);
      }
    }
  }
}

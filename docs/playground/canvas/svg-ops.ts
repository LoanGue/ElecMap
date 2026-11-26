/**
 * Reads the SVG that `renderSvg` emits for a symbol into plain drawing ops, so
 * the canvas can replay the engine's own symbols without a DOM. Only the subset
 * `renderSvg` writes is understood: `path`, `circle`, `rect` and nested
 * `g transform`; text, title and the stylesheet are ignored.
 */

/** Affine matrix `[a, b, c, d, e, f]`, as in `CanvasRenderingContext2D.setTransform`. */
export type Matrix = readonly [number, number, number, number, number, number];

/** Theme colour an op is painted with, `null` for none. */
export type Ink = "fg" | "wire" | null;

/** Paint shared by every op: the flattened transform and the inks read from the classes. */
export interface Paint {
  transform: Matrix;
  stroke: Ink;
  fill: Ink;
  /** Dashed stroke (class `k`). */
  dashed: boolean;
}

export type DrawOp =
  | ({ op: "path"; d: string } & Paint)
  | ({ op: "circle"; cx: number; cy: number; r: number } & Paint)
  | ({ op: "rect"; x: number; y: number; width: number; height: number } & Paint);

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m · n`: applies `n` first, then `m`. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const [A, B, C, D, E, F] = n;
  return [
    a * A + c * B,
    b * A + d * B,
    a * C + c * D,
    b * C + d * D,
    a * E + c * F + e,
    b * E + d * F + f,
  ];
}

/** Cosine and sine, exact on multiples of 90 degrees. */
function turn(deg: number): [number, number] {
  const q = (((deg / 90) % 4) + 4) % 4;
  if (Number.isInteger(q)) return [[1, 0, -1, 0][q] ?? 1, [0, 1, 0, -1][q] ?? 0];
  const rad = (deg * Math.PI) / 180;
  return [Math.cos(rad), Math.sin(rad)];
}

/** One transform function (`translate`, `rotate`, `scale`, `matrix`) as a matrix. */
function step(name: string, v: number[]): Matrix {
  const [p = 0, q, s] = v;
  switch (name) {
    case "translate":
      return [1, 0, 0, 1, p, q ?? 0];
    case "scale":
      return [p, 0, 0, q ?? p, 0, 0];
    case "rotate": {
      const [cos, sin] = turn(p);
      const rot: Matrix = [cos, sin, 0 - sin, cos, 0, 0]; // 0 - sin: no -0
      if (q === undefined || s === undefined) return rot;
      return multiply(multiply([1, 0, 0, 1, q, s], rot), [1, 0, 0, 1, -q, -s]);
    }
    case "matrix":
      return v.length === 6 ? (v as unknown as Matrix) : IDENTITY;
    default:
      return IDENTITY;
  }
}

/** Parses a `transform` attribute into one matrix (functions apply right to left). */
export function parseTransform(text: string): Matrix {
  let m = IDENTITY;
  for (const [, name = "", args = ""] of text.matchAll(/([a-z]+)\s*\(([^)]*)\)/gi)) {
    const v = args
      .split(/[\s,]+/)
      .filter((x) => x !== "")
      .map(Number);
    m = multiply(m, step(name, v));
  }
  return m;
}

function attributes(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, key = "", value = ""] of text.matchAll(/([\w:-]+)="([^"]*)"/g)) out.set(key, value);
  return out;
}

/** Inks of an element from its classes: `s`/`w` stroke, `f`/`j` fill, `k` dashes. */
function paint(classes: Set<string>, transform: Matrix): Paint {
  const stroke: Ink = classes.has("s") ? "fg" : classes.has("w") ? "wire" : null;
  const fill: Ink = classes.has("f") ? "fg" : classes.has("j") ? "wire" : null;
  return { transform, stroke, fill, dashed: classes.has("k") };
}

const num = (a: Map<string, string>, key: string) => Number(a.get(key) ?? 0);

/** Drawing ops of an SVG written by `renderSvg`, in document order. */
export function svgOps(svg: string): DrawOp[] {
  const body = svg.replace(/<(style|title|text)\b[^>]*>[\s\S]*?<\/\1>/g, "");
  const stack: Matrix[] = [IDENTITY];
  const ops: DrawOp[] = [];
  for (const [, close, tag = "", rest = "", selfClose] of body.matchAll(
    /<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g,
  )) {
    if (close) {
      if (tag === "g" && stack.length > 1) stack.pop();
      continue;
    }
    const a = attributes(rest);
    const own = a.has("transform") ? parseTransform(a.get("transform") ?? "") : IDENTITY;
    const transform = multiply(stack[stack.length - 1] ?? IDENTITY, own);
    if (tag === "g") {
      if (!selfClose) stack.push(transform);
      continue;
    }
    const classes = new Set((a.get("class") ?? "").split(/\s+/));
    if (classes.has("bg")) continue;
    const p = paint(classes, transform);
    if (p.stroke === null && p.fill === null) continue;
    if (tag === "path") ops.push({ op: "path", d: a.get("d") ?? "", ...p });
    else if (tag === "circle")
      ops.push({ op: "circle", cx: num(a, "cx"), cy: num(a, "cy"), r: num(a, "r"), ...p });
    else if (tag === "rect")
      ops.push({
        op: "rect",
        x: num(a, "x"),
        y: num(a, "y"),
        width: num(a, "width"),
        height: num(a, "height"),
        ...p,
      });
  }
  return ops;
}

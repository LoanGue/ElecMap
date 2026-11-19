import type { PlacedComponent, SchematicLayout } from "./layout";
import { PIN_SPAN } from "./layout";

/** Options of {@link renderSvg}. */
export interface SvgOptions {
  /** Symbol set: `"iec"` (European, default) or `"ansi"` (US). */
  style?: "iec" | "ansi";
  /** Show component values (default true). */
  showValues?: boolean;
  /** Show component ids (default true). */
  showIds?: boolean;
  /**
   * Node names: `"named"` (default) shows non-numeric names only,
   * `true` all of them, `false` none.
   */
  nodeLabels?: boolean | "named";
  /** Component ids or node names to highlight. */
  highlight?: readonly string[];
  /**
   * Colours: `"auto"` (default, follows `prefers-color-scheme`), `"light"`, `"dark"`,
   * or `"none"` to omit the embedded stylesheet and style the classes yourself.
   */
  theme?: "auto" | "light" | "dark" | "none";
  /** Pixels per grid unit (default 20). */
  scale?: number;
  /** Paint a background rectangle (default false: transparent). */
  background?: boolean;
  /**
   * Ground drawing (used by `ElecMap.toSVG`): `"auto"` (default), `"rail"`
   * (common line at the bottom that closes the circuit) or `"symbols"` (one
   * ground symbol per grounded pin). See `LayoutOptions.ground`.
   */
  ground?: "symbols" | "rail" | "auto";
  /** Accessible title (`<title>`). */
  title?: string;
}

const LIGHT =
  "--em-fg:#1f2328;--em-wire:#1f2328;--em-muted:#59636e;--em-accent:#0969da;--em-hl:#cf222e;--em-bg:#ffffff";
const DARK =
  "--em-fg:#e6edf3;--em-wire:#d1d9e0;--em-muted:#9198a1;--em-accent:#4493f8;--em-hl:#ff7b72;--em-bg:#0d1117";

function stylesheet(theme: "auto" | "light" | "dark", font: number): string {
  const vars =
    theme === "auto"
      ? `.elecmap{${LIGHT}}@media (prefers-color-scheme: dark){.elecmap{${DARK}}}`
      : `.elecmap{${theme === "light" ? LIGHT : DARK}}`;
  return (
    vars +
    ".elecmap .bg{fill:var(--em-bg)}" +
    ".elecmap .w,.elecmap .s{fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}" +
    ".elecmap .w{stroke:var(--em-wire)}.elecmap .s{stroke:var(--em-fg)}" +
    ".elecmap .f{fill:var(--em-fg)}.elecmap .j{fill:var(--em-wire)}" +
    ".elecmap .k{stroke-dasharray:4 3}" +
    `.elecmap text{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:${font}px;fill:var(--em-fg)}` +
    ".elecmap .id{font-weight:600}.elecmap .val{fill:var(--em-muted)}" +
    `.elecmap .node{fill:var(--em-accent);font-style:italic;font-size:${Math.round(font * 0.92)}px}` +
    ".elecmap .hl .s,.elecmap .w.hl{stroke:var(--em-hl)}.elecmap .hl .f,.elecmap .j.hl{fill:var(--em-hl)}" +
    ".elecmap .hl text{fill:var(--em-hl)}"
  );
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r = (n: number) => Math.round(n * 100) / 100;

const ANGLE = { right: 0, down: 90, left: 180, up: -90 } as const;

/** Body of a two-terminal symbol along +x, from 0 to 80 (pins at 0 and 80). */
function twoTerminalBody(c: PlacedComponent, style: "iec" | "ansi"): string {
  const comp = c.component;
  const path = (d: string, cls = "s") => `<path class="${cls}" d="${d}"/>`;
  switch (comp.type) {
    case "resistor":
      return style === "ansi"
        ? path("M0 0H20L23.33 -8L30 8L36.67 -8L43.33 8L50 -8L56.67 8L60 0H80")
        : path("M0 0H22M58 0H80") + `<rect class="s" x="22" y="-7" width="36" height="14"/>`;
    case "capacitor":
      return path("M0 0H36M44 0H80M36 -12V12M44 -12V12");
    case "inductor":
      return path("M0 0H20a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0H80");
    case "vsource": {
      const sine = !comp.dc && (comp.ac !== undefined || comp.waveform?.kind === "sine");
      const circle = `<circle class="s" cx="40" cy="0" r="16"/>`;
      if (style === "iec") return path("M0 0H80") + circle;
      return path("M0 0H24M56 0H80") + circle + (sine ? path("M30 0q5 -12 10 0t10 0") : "");
    }
    case "isource": {
      const circle = `<circle class="s" cx="40" cy="0" r="16"/>`;
      if (style === "iec") return path("M0 0H24M56 0H80M40 -16V16M63 -5L70 0L63 5") + circle;
      return path("M0 0H24M56 0H80M30 0H50M44 -5L50 0L44 5") + circle;
    }
    case "vcvs":
    case "ccvs":
      return path("M0 0H24M56 0H80M24 0L40 -16L56 0L40 16Z");
    case "vccs":
    case "cccs":
      return path("M0 0H24M56 0H80M24 0L40 -16L56 0L40 16ZM31 0H49M43 -5L49 0L43 5");
    case "switch":
      return (
        path(comp.closed ? "M0 0H26M54 0H80M26 0L54 -3" : "M0 0H26M54 0H80M26 0L51 -14") +
        `<circle class="s" cx="26" cy="0" r="2.5"/><circle class="s" cx="54" cy="0" r="2.5"/>`
      );
    case "diode": {
      // Triangle pointing to the cathode bar; a zener bar has bent ends.
      const bar = comp.bv === undefined ? "M50 -10V10" : "M44 -13L50 -10V10L56 13";
      return path("M0 0H30M50 0H80" + bar) + `<path class="s f" d="M30 -10L50 0L30 10Z"/>`;
    }
    default:
      return path("M0 0H80");
  }
}

/** Polarity marks (drawn upright in screen space). */
function polarity(
  c: PlacedComponent,
  style: "iec" | "ansi",
  px: (x: number) => number,
  py: (y: number) => number,
  u: number,
): string {
  const t = c.component.type;
  if (t !== "vsource" && t !== "vcvs" && t !== "ccvs") return "";
  const [p0, p1] = c.pins as [PlacedComponent["pins"][0], PlacedComponent["pins"][0]];
  const at = (f: number) => [px(p0.x + (p1.x - p0.x) * f), py(p0.y + (p1.y - p0.y) * f)] as const;
  const m = 0.15 * u;
  const plus = ([x, y]: readonly [number, number]) =>
    `M${r(x - m)} ${r(y)}H${r(x + m)}M${r(x)} ${r(y - m)}V${r(y + m)}`;
  const minus = ([x, y]: readonly [number, number]) => `M${r(x - m)} ${r(y)}H${r(x + m)}`;
  const comp = c.component;
  const sineAnsi =
    comp.type === "vsource" &&
    !comp.dc &&
    (comp.ac !== undefined || comp.waveform?.kind === "sine");
  // IEC and sine sources: a single "+" outside, next to the first pin.
  const outside = t === "vsource" && (sineAnsi || style === "iec");
  if (outside) {
    const [x, y] = at(0.22);
    const horizontal = p0.y === p1.y;
    const off = 0.55 * u;
    return `<path class="s" d="${plus(horizontal ? [x, y - off] : [x - off, y])}"/>`;
  }
  return `<path class="s" d="${plus(at(0.37))}${minus(at(0.63))}"/>`;
}

function opampSymbol(
  c: PlacedComponent,
  px: (x: number) => number,
  py: (y: number) => number,
  u: number,
): string {
  const out = c.pins[2] as PlacedComponent["pins"][0];
  const X = (dx: number) => r(px(out.x + dx));
  const Y = (dy: number) => r(py(out.y + dy));
  const m = 0.15 * u;
  const d =
    `M${X(-5)} ${Y(-1)}H${X(-4)}M${X(-5)} ${Y(1)}H${X(-4)}M${X(-1)} ${Y(0)}H${X(0)}` +
    `M${X(-4)} ${Y(-2)}L${X(-1)} ${Y(0)}L${X(-4)} ${Y(2)}Z` +
    `M${r(px(out.x - 3.55) - m)} ${Y(-1)}H${r(px(out.x - 3.55) + m)}` +
    `M${r(px(out.x - 3.55) - m)} ${Y(1)}H${r(px(out.x - 3.55) + m)}M${r(px(out.x - 3.55))} ${r(py(out.y + 1) - m)}V${r(py(out.y + 1) + m)}`;
  return `<path class="s" d="${d}"/>`;
}

/**
 * Renders a {@link SchematicLayout} as a standalone SVG document.
 * Elements carry `data-id` (components) and `data-node` (nets) attributes for interactivity.
 */
export function renderSvg(layout: SchematicLayout, options: SvgOptions = {}): string {
  const u = options.scale ?? 20;
  const style = options.style ?? "iec";
  const showValues = options.showValues ?? true;
  const showIds = options.showIds ?? true;
  const nodeLabels = options.nodeLabels ?? "named";
  const highlight = new Set(options.highlight ?? []);
  const theme = options.theme ?? "auto";
  const b = layout.bounds;
  const pad = u;
  const px = (x: number) => (x - b.minX) * u + pad;
  const py = (y: number) => (y - b.minY) * u + pad;
  const width = r((b.maxX - b.minX) * u + 2 * pad);
  const height = r((b.maxY - b.minY) * u + 2 * pad);
  const font = Math.round(u * 0.6);
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" class="elecmap" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">`,
  );
  if (options.title) out.push(`<title>${esc(options.title)}</title>`);
  if (theme !== "none") out.push(`<style>${stylesheet(theme, font)}</style>`);
  if (options.background) out.push(`<rect class="bg" width="100%" height="100%"/>`);

  // Wires.
  for (const net of layout.nets) {
    if (net.segments.length === 0) continue;
    const d = net.segments
      .map((s) => `M${r(px(s.x1))} ${r(py(s.y1))}L${r(px(s.x2))} ${r(py(s.y2))}`)
      .join("");
    const hl = highlight.has(net.node) ? " hl" : "";
    out.push(`<path class="w${hl}" data-node="${esc(net.node)}" d="${d}"/>`);
  }
  for (const net of layout.nets) {
    const hl = highlight.has(net.node) ? " hl" : "";
    for (const j of net.junctions) {
      out.push(
        `<circle class="j${hl}" data-node="${esc(net.node)}" cx="${r(px(j.x))}" cy="${r(py(j.y))}" r="${r(u * 0.17)}"/>`,
      );
    }
  }

  // Ground symbols.
  const g = layout.grounds
    .map((p) => {
      const x = px(p.x);
      const y = py(p.y);
      return `M${r(x)} ${r(y)}V${r(y + u)}M${r(x - 0.6 * u)} ${r(y + u)}H${r(x + 0.6 * u)}M${r(x - 0.38 * u)} ${r(y + 1.25 * u)}H${r(x + 0.38 * u)}M${r(x - 0.15 * u)} ${r(y + 1.5 * u)}H${r(x + 0.15 * u)}`;
    })
    .join("");
  if (g) out.push(`<path class="s" d="${g}"/>`);

  // Components.
  const s = u / 20;
  for (const c of layout.components) {
    const hl = highlight.has(c.id) ? " hl" : "";
    const parts: string[] = [];
    if (c.type === "opamp") {
      parts.push(opampSymbol(c, px, py, u));
    } else {
      const p0 = c.pins[0] as PlacedComponent["pins"][0];
      parts.push(
        `<g transform="translate(${r(px(p0.x))} ${r(py(p0.y))}) rotate(${ANGLE[c.orientation]}) scale(${r((s * PIN_SPAN) / 4)})">${twoTerminalBody(c, style)}</g>`,
      );
      parts.push(polarity(c, style, px, py, u));
    }
    // Labels.
    const lines: string[] = [];
    const { x, y, align } = c.labelAt;
    const id = showIds ? c.label.id : "";
    const value = showValues ? c.label.value : "";
    if (c.type === "opamp") {
      if (id) lines.push(`<text class="id" x="${r(px(x))}" y="${r(py(y))}">${esc(id)}</text>`);
      if (value)
        lines.push(`<text class="val" x="${r(px(x))}" y="${r(py(y) + font)}">${esc(value)}</text>`);
    } else if (align === "middle") {
      if (id)
        lines.push(
          `<text class="id" text-anchor="middle" x="${r(px(x))}" y="${r(py(y - 1.25))}">${esc(id)}</text>`,
        );
      if (value)
        lines.push(
          `<text class="val" text-anchor="middle" x="${r(px(x))}" y="${r(py(y + 1.85))}">${esc(value)}</text>`,
        );
    } else {
      const both = id && value;
      if (id)
        lines.push(
          `<text class="id" x="${r(px(x - 0.3))}" y="${r(py(y + (both ? -0.15 : 0.3)))}">${esc(id)}</text>`,
        );
      if (value)
        lines.push(
          `<text class="val" x="${r(px(x - 0.3))}" y="${r(py(y + (both ? 0.75 : 0.3)))}">${esc(value)}</text>`,
        );
    }
    out.push(
      `<g class="c${hl}" data-id="${esc(c.id)}" data-type="${c.type}">${parts.join("")}${lines.join("")}</g>`,
    );
  }

  // Magnetic couplings: polarity dots, and a core between parallel vertical windings.
  for (const k of layout.couplings) {
    const [a, bb] = k.inductors.map((id) => layout.components.find((c) => c.id === id));
    if (!a || !bb) continue;
    const dots = [a, bb]
      .map((c) => {
        const p0 = c.pins[0] as PlacedComponent["pins"][0];
        const p1 = c.pins[1] as PlacedComponent["pins"][0];
        const fx = p0.x + (p1.x - p0.x) * 0.3;
        const fy = p0.y + (p1.y - p0.y) * 0.3;
        const horizontal = p0.y === p1.y;
        return `<circle class="f" cx="${r(px(fx + (horizontal ? 0 : -0.75)))}" cy="${r(py(fy + (horizontal ? 0.75 : 0)))}" r="${r(u * 0.13)}"/>`;
      })
      .join("");
    const ca = center(a);
    const cb = center(bb);
    const mx = (ca.x + cb.x) / 2;
    const my = (ca.y + cb.y) / 2;
    const vertical =
      a.pins[0]?.x === a.pins[1]?.x && bb.pins[0]?.x === bb.pins[1]?.x && ca.y === cb.y;
    const core = vertical
      ? `<path class="s" d="M${r(px(mx) - 3)} ${r(py(my - 1))}V${r(py(my + 1))}M${r(px(mx) + 3)} ${r(py(my - 1))}V${r(py(my + 1))}"/>`
      : `<path class="s k" d="M${r(px(ca.x))} ${r(py(ca.y))}L${r(px(cb.x))} ${r(py(cb.y))}"/>`;
    const label = `<text class="val" text-anchor="middle" x="${r(px(mx))}" y="${r(py(my - 1.4))}">${esc(`${showIds ? `${k.id} ` : ""}k = ${k.k}`)}</text>`;
    const hl = highlight.has(k.id) ? " hl" : "";
    out.push(
      `<g class="c${hl}" data-id="${esc(k.id)}" data-type="coupling">${dots}${core}${label}</g>`,
    );
  }

  // Node names.
  if (nodeLabels) {
    for (const net of layout.nets) {
      if (net.ground) continue;
      if (nodeLabels === "named" && /^\d+$/.test(net.node)) continue;
      const hl = highlight.has(net.node) ? " hl" : "";
      out.push(
        `<text class="node${hl}" data-node="${esc(net.node)}" x="${r(px(net.labelAt.x) + 4)}" y="${r(py(net.labelAt.y) - 5)}">${esc(net.node)}</text>`,
      );
    }
  }
  out.push("</svg>");
  return out.join("");
}

function center(c: PlacedComponent): { x: number; y: number } {
  const p0 = c.pins[0] as PlacedComponent["pins"][0];
  const p1 = c.pins[1] as PlacedComponent["pins"][0];
  return { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
}

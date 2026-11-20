/**
 * SVG line plots shared by the documentation figures and the playground.
 * No colours here: stylesheets theme `.em-plot` (light and dark).
 */

export interface Series {
  x: readonly number[];
  y: readonly number[];
  label?: string;
  dashed?: boolean;
}

/** Filled area between two curves (a Monte-Carlo envelope). */
export interface Band {
  x: readonly number[];
  lo: readonly number[];
  hi: readonly number[];
  label?: string;
  /** Colour index of the series it belongs to (default 0). */
  color?: number;
}

export interface Panel {
  series: Series[];
  /** Areas drawn under the series. */
  bands?: Band[];
  yLabel: string;
  yTicks?: number[];
  /** Logarithmic y axis (absolute values, one tick per decade). */
  logY?: boolean;
}

export interface PlotOptions {
  panels: Panel[];
  xLabel: string;
  logX?: boolean;
  xFormat?: (v: number) => string;
  width?: number;
  panelHeight?: number;
}

const COLORS = ["c1", "c2", "c3", "c4", "c5"];

export function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return ticks;
}

export const fmt = (v: number): string => {
  const a = Math.abs(v);
  if (a === 0) return "0";
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "G"],
    [1e6, "M"],
    [1e3, "k"],
    [1, ""],
    [1e-3, "m"],
    [1e-6, "µ"],
    [1e-9, "n"],
    [1e-12, "p"],
  ];
  for (const [scale, prefix] of units) {
    if (a >= scale * 0.999) return `${Number((v / scale).toPrecision(3))}${prefix}`;
  }
  return v.toExponential(0);
};

export function plot(options: PlotOptions): string {
  const width = options.width ?? 640;
  const ph = options.panelHeight ?? 170;
  const left = 58;
  const right = 16;
  const top = 14;
  const gap = 26;
  const bottom = 42;
  const pw = width - left - right;
  const height = top + options.panels.length * ph + (options.panels.length - 1) * gap + bottom;

  const allX = options.panels.flatMap((p) => [
    ...p.series.flatMap((s) => [...s.x]),
    ...(p.bands ?? []).flatMap((b) => [...b.x]),
  ]);
  const xMin = Math.min(...allX);
  const xMax = Math.max(...allX);
  const tx = options.logX
    ? (x: number) =>
        left + ((Math.log10(x) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin))) * pw
    : (x: number) => left + ((x - xMin) / (xMax - xMin)) * pw;
  const xTicks = options.logX
    ? Array.from(
        { length: Math.round(Math.log10(xMax) - Math.log10(xMin)) + 1 },
        (_, i) => xMin * 10 ** i,
      )
    : niceTicks(xMin, xMax, 6);
  const xFormat = options.xFormat ?? fmt;

  const parts: string[] = [];
  options.panels.forEach((panel, pi) => {
    const y0 = top + pi * (ph + gap);
    // A log axis plots log10|y|; its ticks are decades.
    const map = panel.logY ? (y: number) => Math.log10(Math.abs(y)) : (y: number) => y;
    const bands = panel.bands ?? [];
    const ys = [
      ...panel.series.flatMap((s) => s.y.map(map)),
      ...bands.flatMap((b) => [...b.lo.map(map), ...b.hi.map(map)]),
    ].filter(Number.isFinite);
    let yMin = ys.length > 0 ? Math.min(...ys) : 0;
    let yMax = ys.length > 0 ? Math.max(...ys) : 1;
    if (panel.logY) {
      yMin = Math.floor(yMin);
      yMax = Math.max(Math.ceil(yMax), yMin + 1);
    } else {
      const pad = (yMax - yMin) * 0.08 || Math.abs(yMax) * 0.1 || 1;
      yMin -= pad;
      yMax += pad;
    }
    const autoTicks = panel.logY
      ? Array.from({ length: yMax - yMin + 1 }, (_, i) => yMin + i)
      : niceTicks(yMin, yMax, 4);
    const yTicks = (panel.yTicks ?? autoTicks).filter((t) => t >= yMin && t <= yMax);
    const ty = (y: number) => y0 + ph - ((map(y) - yMin) / (yMax - yMin)) * ph;
    const tickY = (t: number) => y0 + ph - ((t - yMin) / (yMax - yMin)) * ph;

    parts.push(`<rect class="frame" x="${left}" y="${y0}" width="${pw}" height="${ph}"/>`);
    for (const t of yTicks) {
      const y = tickY(t).toFixed(1);
      parts.push(`<line class="grid" x1="${left}" x2="${left + pw}" y1="${y}" y2="${y}"/>`);
      parts.push(
        `<text class="tick" x="${left - 6}" y="${y}" text-anchor="end" dy="0.32em">${fmt(panel.logY ? 10 ** t : t)}</text>`,
      );
    }
    if (options.logX) {
      // Minor decade lines.
      for (const d of xTicks.slice(0, -1)) {
        for (let k = 2; k < 10; k++) {
          const x = tx(d * k).toFixed(1);
          parts.push(`<line class="grid minor" x1="${x}" x2="${x}" y1="${y0}" y2="${y0 + ph}"/>`);
        }
      }
    }
    for (const t of xTicks) {
      const x = tx(t).toFixed(1);
      parts.push(`<line class="grid" x1="${x}" x2="${x}" y1="${y0}" y2="${y0 + ph}"/>`);
    }
    parts.push(
      `<text class="label" transform="translate(14 ${y0 + ph / 2}) rotate(-90)" text-anchor="middle">${panel.yLabel}</text>`,
    );
    for (const b of bands) {
      const pts = [
        ...b.x.map((x, i) => [x, b.hi[i] ?? NaN] as const),
        ...b.x.map((x, i) => [x, b.lo[i] ?? NaN] as const).reverse(),
      ].filter(([, y]) => Number.isFinite(map(y)));
      const d = pts
        .map(([x, y], i) => `${i === 0 ? "M" : "L"}${tx(x).toFixed(1)},${ty(y).toFixed(1)}`)
        .join("");
      parts.push(`<path d="${d}Z" class="band ${COLORS[(b.color ?? 0) % COLORS.length]}"/>`);
    }
    panel.series.forEach((s, si) => {
      const d = s.x
        .map((x, i) => {
          const y = s.y[i] ?? NaN;
          return Number.isFinite(map(y))
            ? `${i === 0 ? "M" : "L"}${tx(x).toFixed(1)},${ty(y).toFixed(1)}`
            : "";
        })
        .join("");
      const dash = s.dashed ? ` stroke-dasharray="5 4"` : "";
      parts.push(`<path d="${d}" class="line ${COLORS[si % COLORS.length]}"${dash}/>`);
    });
    const labelled = panel.series.filter((s) => s.label);
    bands
      .filter((b) => b.label)
      .forEach((b, i) => {
        const lx = left + pw - 150;
        const ly = y0 + 16 + (labelled.length + i) * 18;
        parts.push(
          `<rect x="${lx}" y="${ly - 6}" width="22" height="12" rx="2" class="band ${COLORS[(b.color ?? 0) % COLORS.length]}"/>`,
          `<text class="legend" x="${lx + 28}" y="${ly}" dy="0.32em">${b.label ?? ""}</text>`,
        );
      });
    labelled.forEach((s, i) => {
      const si = panel.series.indexOf(s);
      const lx = left + pw - 150;
      const ly = y0 + 16 + i * 18;
      const dash = s.dashed ? ` stroke-dasharray="5 4"` : "";
      parts.push(
        `<line x1="${lx}" x2="${lx + 22}" y1="${ly}" y2="${ly}" class="line ${COLORS[si % COLORS.length]}"${dash}/>`,
        `<text class="legend" x="${lx + 28}" y="${ly}" dy="0.32em">${s.label ?? ""}</text>`,
      );
    });
  });
  const yAxis = top + options.panels.length * ph + (options.panels.length - 1) * gap;
  for (const t of xTicks) {
    parts.push(
      `<text class="tick" x="${tx(t).toFixed(1)}" y="${yAxis + 16}" text-anchor="middle">${xFormat(t)}</text>`,
    );
  }
  parts.push(
    `<text class="label" x="${left + pw / 2}" y="${height - 6}" text-anchor="middle">${options.xLabel}</text>`,
  );

  // No colours here: the site stylesheet themes `.em-plot` (light and dark).
  // Plot-area geometry, read by the playground's cursor.
  const geometry = `data-left="${left}" data-right="${left + pw}" data-xmin="${xMin}" data-xmax="${xMax}" data-log="${options.logX ? 1 : 0}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="em-plot" viewBox="0 0 ${width} ${height}" ${geometry} role="img">
${parts.join("\n")}
</svg>`;
}

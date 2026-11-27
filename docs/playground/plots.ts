/**
 * Plots of the analysis panels, with a cursor that reads every series at the
 * mouse position. The figure builder and the axis maths are pure; the cursor
 * handlers receive the event and touch only the figure under it.
 */
import { plot } from "../site/plot";
import type { PlotOptions, Series } from "../site/plot";
import { esc, si } from "./format";

/** What the cursor of one figure reads: the series of each panel and their unit. */
export interface PlotData {
  panels: { series: Series[]; unit: string; digits: number }[];
  xFormat: (v: number) => string;
}

/** Data of the figures on the page, by `data-plot` id. */
export interface PlotRegistry {
  data: Map<string, PlotData>;
  count: number;
}

export function plotRegistry(): PlotRegistry {
  return { data: new Map(), count: 0 };
}

/**
 * A plot `width` pixels wide with a cursor. `units` gives the unit and the
 * significant digits read on each panel; the data is kept in `registry`.
 */
export function figure(
  registry: PlotRegistry,
  options: PlotOptions,
  units: [string, number][],
  width: number,
): string {
  const id = `p${++registry.count}`;
  registry.data.set(id, {
    panels: options.panels.map((p, i) => ({
      series: p.series,
      unit: units[i]?.[0] ?? "",
      digits: units[i]?.[1] ?? 4,
    })),
    xFormat: options.xFormat ?? ((v: number) => si(v, "Hz", 4)),
  });
  return `<figure class="pg-plot" data-plot="${id}">${plot({ width, panelHeight: 130, ...options })}<div class="pg-cursor" hidden></div><div class="pg-readout" hidden></div></figure>`;
}

/** Range of the x axis, linear or logarithmic. */
export interface Axis {
  min: number;
  max: number;
  log: boolean;
}

/** Value at the fraction `u` (0 left, 1 right) of `axis`. */
export function axisValue(axis: Axis, u: number): number {
  const { min, max, log } = axis;
  return log
    ? 10 ** (Math.log10(min) + u * (Math.log10(max) - Math.log10(min)))
    : min + u * (max - min);
}

/** Fraction of `axis` (0 left, 1 right) where `x` lies. */
export function axisFraction(axis: Axis, x: number): number {
  const { min, max, log } = axis;
  return log
    ? (Math.log10(x) - Math.log10(min)) / (Math.log10(max) - Math.log10(min))
    : (x - min) / (max - min);
}

/**
 * Index of the sample of `xs` (ascending) closest to the value at the fraction
 * `u` of `axis` (the lower one on a tie; 0 when `xs` is empty).
 */
export function nearestIndex(axis: Axis, xs: readonly number[], u: number): number {
  const x = axisValue(axis, u);
  let lo = 0;
  let hi = xs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((xs[mid] as number) < x) lo = mid + 1;
    else hi = mid - 1;
  }
  let k = Math.max(Math.min(lo, xs.length - 1), 0);
  if (k > 0 && Math.abs((xs[k - 1] as number) - x) < Math.abs((xs[k] as number) - x)) k--;
  return k;
}

/** Moves the cursor of the figure under the mouse and reads every series there. */
export function onPlotMove(registry: PlotRegistry, event: MouseEvent): void {
  const fig = (event.target as Element).closest<HTMLElement>("[data-plot]");
  if (!fig) return;
  const svg = fig.querySelector<SVGSVGElement>("svg");
  const data = registry.data.get(fig.dataset["plot"] ?? "");
  const cursor = fig.querySelector<HTMLElement>(".pg-cursor");
  const readout = fig.querySelector<HTMLElement>(".pg-readout");
  if (!svg || !data || !cursor || !readout) return;
  const box = svg.getBoundingClientRect();
  const scale = box.width / svg.viewBox.baseVal.width;
  const left = Number(svg.dataset["left"]);
  const right = Number(svg.dataset["right"]);
  const px = (event.clientX - box.left) / scale;
  if (px < left || px > right) {
    cursor.hidden = true;
    readout.hidden = true;
    return;
  }
  const axis: Axis = {
    min: Number(svg.dataset["xmin"]),
    max: Number(svg.dataset["xmax"]),
    log: svg.dataset["log"] === "1",
  };
  const xs = data.panels[0]?.series[0]?.x ?? [];
  const k = nearestIndex(axis, xs, (px - left) / (right - left));
  const figBox = fig.getBoundingClientRect();
  const sx = box.left - figBox.left;
  cursor.hidden = false;
  cursor.style.left = `${sx + (left + axisFraction(axis, xs[k] as number) * (right - left)) * scale}px`;
  cursor.style.top = `${box.top - figBox.top}px`;
  cursor.style.height = `${box.height}px`;
  const lines = data.panels.flatMap((p) =>
    p.series.map((s, i) => {
      const v = s.y[k] ?? NaN;
      return `<div><i class="c${(i % 5) + 1}"></i>${esc(s.label ?? "")} <b>${si(v, p.unit, p.digits)}</b></div>`;
    }),
  );
  readout.hidden = false;
  readout.innerHTML = `<div class="pg-readout-x">${data.xFormat(xs[k] as number)}</div>${lines.join("")}`;
  const cx = event.clientX - figBox.left;
  const flip = cx > figBox.width * 0.6;
  readout.style.left = flip ? "" : `${cx + 14}px`;
  readout.style.right = flip ? `${figBox.width - cx + 14}px` : "";
  readout.style.top = `${Math.max(event.clientY - figBox.top - 20, 0)}px`;
}

/** Hides the cursor of the figure the mouse left. */
export function onPlotLeave(event: MouseEvent): void {
  const fig = (event.target as Element).closest<HTMLElement>("[data-plot]");
  fig?.querySelectorAll<HTMLElement>(".pg-cursor, .pg-readout").forEach((el) => (el.hidden = true));
}

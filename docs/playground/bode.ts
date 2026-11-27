/**
 * Bode plots and the metrics of a transfer function: frequency range, phase
 * ticks, the plot itself, the metrics list and the frequency controls. Pure:
 * the state, the strings and the figure builder are passed in, and every
 * function returns HTML for the page to insert.
 */
import type { Complex, TransferFunction } from "../../src";
import type { PlotOptions } from "../site/plot";
import { attempt, complexText, esc, parseNumber, si } from "./format";
import type { Strings } from "./i18n";
import type { State } from "./state";

/** Builds a figure with a cursor; `units` gives the unit and digits read on each panel. */
export type Figure = (options: PlotOptions, units: [string, number][]) => string;

/** The frequency bounds typed by the user (blank or invalid means automatic). */
export type FrequencyInput = Pick<State, "fStart" | "fStop">;

/** The state read by the Bode controls. */
export type ControlState = Pick<
  State,
  "fStart" | "fStop" | "mc" | "tolR" | "tolC" | "tolL" | "tolOther" | "runs"
>;

/**
 * Plotted frequency range: the user's bounds when valid, else the range of
 * `H`, widened to whole decades so that the log axis ticks fall on 1, 10, 100…
 */
export function frequencyRange(
  H: Pick<TransferFunction, "frequencyRange">,
  input: FrequencyInput,
): [number, number] {
  const [a, b] = H.frequencyRange();
  const lo = parseNumber(input.fStart);
  const hi = parseNumber(input.fStop);
  const start = lo !== undefined && lo > 0 ? lo : a;
  const stop = hi !== undefined && hi > start ? hi : Math.max(b, start * 10);
  return [10 ** Math.floor(Math.log10(start)), 10 ** Math.ceil(Math.log10(stop))];
}

/** Phase ticks on multiples of 45°, or of 90° and 180° for wide ranges. */
export function phaseTicks(phase: readonly number[]): number[] {
  const lo = Math.min(...phase);
  const hi = Math.max(...phase);
  const span = hi - lo;
  const step = span > 540 ? 180 : span > 200 ? 90 : 45;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step; v += step)
    ticks.push(v);
  return ticks;
}

/** Gain and phase of `H` over its frequency range, the gain clipped 120 dB below its peak. */
export function bodePlot(
  H: TransferFunction,
  input: FrequencyInput,
  t: Strings,
  figure: Figure,
): string {
  const [fStart, fStop] = frequencyRange(H, input);
  const bode = H.bode({ fStart, fStop, points: 400 });
  const peak = Math.max(...bode.magnitudeDb.filter(Number.isFinite));
  const floor = Math.min(peak - 120, -40);
  const gain = bode.magnitudeDb.map((v) => Math.max(v, floor));
  return figure(
    {
      logX: true,
      xLabel: t.frequency,
      panels: [
        { series: [{ x: bode.freq, y: gain, label: "|H|" }], yLabel: t.gainDb },
        {
          series: [{ x: bode.freq, y: bode.phase, label: "φ" }],
          yLabel: t.phase,
          yTicks: phaseTicks(bode.phase),
        },
      ],
    },
    [
      ["dB", 4],
      ["°", 4],
    ],
  );
}

/** Gains, filter type, cutoffs, f0, Q, ζ, bandwidth, stability, poles and zeros of `H`. */
export function metrics(H: TransferFunction, t: Strings): string {
  const items: [string, string][] = [];
  const db = (g: number) =>
    g === 0 ? "" : ` (${(20 * Math.log10(Math.abs(g))).toFixed(2).replace(/^-0\.00$/, "0.00")} dB)`;
  const dc = H.dcGain();
  items.push([t.dcGain, `${si(dc, "")}${Number.isFinite(dc) ? db(dc) : ""}`]);
  const hf = H.highFrequencyGain();
  items.push([t.hfGain, `${si(hf, "")}${Number.isFinite(hf) ? db(hf) : ""}`]);
  items.push([t.filter, t.filters[H.filterType()] ?? H.filterType()]);
  items.push([t.order, String(H.order)]);
  const cutoffs = attempt(() => H.cutoffFrequencies()) ?? [];
  if (cutoffs.length > 0) items.push([t.cutoff, cutoffs.map((f) => si(f, "Hz")).join(", ")]);
  const f0 = H.naturalFrequency();
  if (f0 !== undefined) items.push([t.f0, si(f0, "Hz")]);
  const q = H.qFactor();
  if (q !== undefined) items.push([t.q, q.toPrecision(4)]);
  const zeta = H.dampingRatio();
  if (zeta !== undefined) items.push([t.zeta, zeta.toPrecision(4)]);
  if (H.filterType() === "bandpass") {
    const peak = H.peakGain();
    items.push([t.peak, `${si(peak, "")}${db(peak)} @ ${si(H.peakFrequency(), "Hz")}`]);
  }
  const bw = attempt(() => H.bandwidth());
  if (bw !== undefined) items.push([t.bandwidth, si(bw, "Hz")]);
  items.push([t.stable, H.isStable() ? t.yes : t.no]);
  const roots = (list: Complex[]) =>
    list.length === 0
      ? t.none
      : list
          .map(
            (p) =>
              `${complexText(p, "rad/s")} <span class="pg-dim">(${si(p.abs() / (2 * Math.PI), "Hz")})</span>`,
          )
          .join("<br>");
  return `<dl class="pg-metrics">${items
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("")}</dl>
<div class="pg-grid2 pg-roots">
  <div><h3>${t.poles}</h3><p>${roots(H.poles())}</p></div>
  <div><h3>${t.zeros}</h3><p>${roots(H.zeros())}</p></div>
</div>`;
}

/** Frequency bounds, plus the Monte-Carlo toggle and tolerances when `tolerance` is set. */
export function bodeControls(state: ControlState, t: Strings, tolerance = false): string {
  const pct = (key: "tolR" | "tolC" | "tolL", label: string) =>
    `<label>${label} ±<input data-bind="${key}" value="${esc(state[key])}" size="3"> %</label>`;
  const toggle = tolerance
    ? `<button data-mc class="pg-toggle${state.mc ? " on" : ""}" title="${esc(t.mcHint)}">± ${t.mcEnvelope}</button>`
    : "";
  const mcRow =
    tolerance && state.mc
      ? `<div class="pg-controls pg-small pg-mc">
  ${pct("tolR", "R")}${pct("tolC", "C")}${pct("tolL", "L")}
  <label>${t.tolOther}<input data-bind="tolOther" value="${esc(state.tolOther)}" placeholder="${esc(t.tolOtherHint)}" size="14"></label>
  <label><input data-bind="runs" value="${esc(state.runs)}" size="4"> ${t.runsLabel}</label>
</div>`
      : "";
  return `<div class="pg-controls pg-small">
  <label>${t.from}<input data-bind="fStart" placeholder="${t.auto}" value="${esc(state.fStart)}" size="7"> Hz</label>
  <label>${t.to}<input data-bind="fStop" placeholder="${t.auto}" value="${esc(state.fStop)}" size="7"> Hz</label>
  ${toggle}
</div>${mcRow}`;
}

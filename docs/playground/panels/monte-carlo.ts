/**
 * Monte-Carlo envelope of the Bode plot: tolerances read from the controls,
 * the controls themselves, and the envelope with the spread of the main
 * metrics. Pure: the state, the strings and the figure builder are passed in,
 * and every function returns HTML for the page to insert.
 */
import type {
  ElecMap,
  MonteCarlo,
  MonteCarloBode,
  TransferFunction,
  TransferOptions,
} from "../../../src";
import { bodePlot, frequencyRange, gainFloor, phaseTicks } from "../bode";
import type { ExtraControls, Figure, FrequencyInput } from "../bode";
import { attempt, esc, message, parseNumber, si } from "../format";
import type { Strings } from "../i18n";
import type { State } from "../state";

/** The tolerances typed by the user: percents for R, C and L, and free "id percent" entries. */
export type ToleranceInput = Pick<State, "tolR" | "tolC" | "tolL" | "tolOther">;

/** The state read by the Monte-Carlo toggle and controls. */
export type MonteCarloState = ToleranceInput & Pick<State, "mc" | "runs">;

/**
 * Relative tolerance per id: R, C and L by kind, then the "id[.field] percent"
 * entries, which win. Throws on an entry that does not parse.
 */
export function tolerances(
  c: Pick<ElecMap, "components">,
  input: ToleranceInput,
  t: Strings,
): Record<string, number> {
  const byKind: Record<string, string> = {
    resistor: input.tolR,
    capacitor: input.tolC,
    inductor: input.tolL,
  };
  const result: Record<string, number> = {};
  for (const comp of c.components()) {
    const pct = parseNumber(byKind[comp.type] ?? "");
    if (pct !== undefined && pct > 0) result[comp.id] = pct / 100;
  }
  for (const entry of input.tolOther.split(/[,;\n]+/)) {
    if (entry.trim() === "") continue;
    const m = /^\s*([\w.]+)\s*[=:\s]\s*±?\s*([^\s%]+)\s*%?\s*$/.exec(entry);
    const pct = m ? parseNumber(m[2] as string) : undefined;
    if (!m || pct === undefined || pct < 0) throw new Error(`${t.tolSyntax}: "${entry.trim()}"`);
    result[m[1] as string] = pct / 100;
  }
  return result;
}

/** The Monte-Carlo toggle, and the tolerance and run fields when it is on. */
export function monteCarloControls(state: MonteCarloState, t: Strings): ExtraControls {
  const pct = (key: "tolR" | "tolC" | "tolL", label: string) =>
    `<label>${label} ±<input data-bind="${key}" value="${esc(state[key])}" size="3"> %</label>`;
  const toggle = `<button data-mc class="pg-toggle${state.mc ? " on" : ""}" title="${esc(t.mcHint)}">± ${t.mcEnvelope}</button>`;
  const row = state.mc
    ? `<div class="pg-controls pg-small pg-mc">
  ${pct("tolR", "R")}${pct("tolC", "C")}${pct("tolL", "L")}
  <label>${t.tolOther}<input data-bind="tolOther" value="${esc(state.tolOther)}" placeholder="${esc(t.tolOtherHint)}" size="14"></label>
  <label><input data-bind="runs" value="${esc(state.runs)}" size="4"> ${t.runsLabel}</label>
</div>`
    : "";
  return { toggle, row };
}

/** Spread of the DC gain, cutoff, f0 and Q over the runs, as metric rows. */
function spreadRows(mc: MonteCarlo, spec: TransferOptions, t: Strings): string {
  const spread: [string, (h: TransferFunction) => number | undefined, string][] = [
    [t.dcGain, (h) => h.dcGain(), ""],
    [t.cutoff, (h) => attempt(() => h.cutoffFrequency()), "Hz"],
    [t.f0, (h) => h.naturalFrequency(), "Hz"],
    [t.q, (h) => h.qFactor(), ""],
  ];
  return spread
    .map(([label, f, unit]) => {
      const s = mc.statistics((x) => f(x.transferFunction(spec)));
      if (!Number.isFinite(s.nominal) || s.nominal === 0 || !Number.isFinite(s.min)) return "";
      if (s.max - s.min <= Math.abs(s.nominal) * 1e-9) return "";
      const num = (v: number) => (unit ? si(v, unit) : v.toPrecision(4));
      const rel = (v: number) =>
        `${v >= s.nominal ? "+" : "−"}${Math.abs((v / s.nominal - 1) * 100).toFixed(1)} %`;
      return `<div><dt>${label}</dt><dd>${num(s.min)} … ${num(s.max)}<small>${rel(s.min)} / ${rel(s.max)} · σ ${num(s.std)}</small></dd></div>`;
    })
    .join("");
}

/**
 * Bode envelope of `H` over `runs` random circuits (seeded, so the same inputs
 * give the same plot), with the spread of its metrics. On a tolerance or
 * analysis error, the error and the plain Bode plot.
 */
export function monteCarloBode(
  c: ElecMap,
  spec: TransferOptions,
  H: TransferFunction,
  state: MonteCarloState & FrequencyInput,
  t: Strings,
  figure: Figure,
): string {
  const [fStart, fStop] = frequencyRange(H, state);
  let mc: MonteCarlo;
  let bode: MonteCarloBode;
  try {
    const runs = Math.min(Math.max(Math.round(parseNumber(state.runs) ?? 100), 1), 2000);
    mc = c.monteCarlo({ tolerances: tolerances(c, state, t), runs });
    bode = mc.bode(spec, { fStart, fStop, points: 40 });
  } catch (err) {
    return `<p class="pg-error">${esc(message(err))}</p>${bodePlot(H, state, t, figure)}`;
  }
  const floor = gainFloor(bode.nominal.magnitudeDb);
  const clip = (v: readonly number[]) => v.map((x) => Math.max(x, floor));
  return `<dl class="pg-metrics pg-mc-stats">${spreadRows(mc, spec, t)}</dl>
${figure(
  {
    logX: true,
    xLabel: t.frequency,
    panels: [
      {
        bands: [
          {
            x: bode.freq,
            lo: clip(bode.magnitudeDb.min),
            hi: clip(bode.magnitudeDb.max),
            label: `${mc.length} ${t.runsLabel}`,
          },
        ],
        series: [{ x: bode.freq, y: clip(bode.nominal.magnitudeDb), label: t.nominal }],
        yLabel: t.gainDb,
      },
      {
        bands: [{ x: bode.freq, lo: bode.phase.min, hi: bode.phase.max }],
        series: [{ x: bode.freq, y: bode.nominal.phase, label: "φ" }],
        yLabel: t.phase,
        yTicks: phaseTicks([...bode.phase.min, ...bode.phase.max]),
      },
    ],
  },
  [
    ["dB", 4],
    ["°", 4],
  ],
)}`;
}

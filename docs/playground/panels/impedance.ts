/**
 * Impedance panel: the two node selects, Z(s) between them, its DC and
 * high-frequency values, the equivalent resistance and Thévenin equivalent
 * when they exist, and the Bode plot of |Z| and its phase. Pure: everything
 * comes from the circuit and the panel context, and the panel is returned as
 * HTML.
 */
import type { ElecMap } from "../../../src";
import { bodeControls, frequencyRange, phaseTicks } from "../bode";
import { attempt, esc, option, si, texName } from "../format";
import type { PanelContext } from "./context";

/**
 * The node selects: `zA` among the circuit nodes, `zB` among the other nodes
 * and the ground.
 */
export function impedanceControls(c: ElecMap, { state, t, ground }: PanelContext): string {
  const nodes = c.nodes();
  const all = [...nodes, ground];
  return `
<div class="pg-controls">
  <label>${t.between}<select data-bind="zA">${nodes.map((n) => option(n, n, state.zA)).join("")}</select></label>
  <label>${t.and}<select data-bind="zB">${all
    .filter((n) => n !== state.zA)
    .map((n) => option(n, n, state.zB))
    .join("")}</select></label>
</div>`;
}

/** The Impedance tab of `c`, between `state.zA` and `state.zB` (the ground when it is `ground`). */
export function impedancePanel(c: ElecMap, ctx: PanelContext): string {
  const { state, t, ground, figure } = ctx;
  const controls = impedanceControls(c, ctx);
  const b = state.zB === ground ? undefined : state.zB;
  const Z = c.impedance(state.zA, b);
  const items: [string, string][] = [
    [t.zDc, si(Z.dcGain(), "Ω")],
    [t.zHf, si(Z.highFrequencyGain(), "Ω")],
  ];
  const r = attempt(() => c.equivalentResistance(state.zA, b));
  items.push([
    t.equivalentR,
    r === undefined ? `<span class="pg-dim">${t.notResistive}</span>` : si(r, "Ω"),
  ]);
  const th = attempt(() => c.thevenin(state.zA, b));
  if (th) items.push([t.thevenin, `${si(th.voltage, "V")} · ${si(th.resistance, "Ω")}`]);
  const [fStart, fStop] = frequencyRange(Z, state);
  const bode = Z.bode({ fStart, fStop, points: 400 });
  const label = `Z_{${texName(state.zA)}${b ? `,${texName(b)}` : ""}}(s)`;
  return `${controls}
<div class="pg-math" data-tex="${esc(`${label} = ${Z.toLatex()}`)}"></div>
<dl class="pg-metrics">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
${bodeControls(state, t)}
${figure(
  {
    logX: true,
    xLabel: t.frequency,
    panels: [
      { series: [{ x: bode.freq, y: bode.magnitude, label: "|Z|" }], yLabel: t.zLabel, logY: true },
      {
        series: [{ x: bode.freq, y: bode.phase, label: "φ" }],
        yLabel: t.phase,
        yTicks: phaseTicks(bode.phase),
      },
    ],
  },
  [
    ["Ω", 4],
    ["°", 4],
  ],
)}`;
}

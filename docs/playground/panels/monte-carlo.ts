/**
 * Monte-Carlo envelope of the Bode plot: its toggle and tolerance controls.
 * Pure: the state and the strings are passed in, and every function returns
 * HTML for the page to insert.
 */
import type { ExtraControls } from "../bode";
import { esc } from "../format";
import type { Strings } from "../i18n";
import type { State } from "../state";

/** The tolerances typed by the user: percents for R, C and L, and free "id percent" entries. */
export type ToleranceInput = Pick<State, "tolR" | "tolC" | "tolL" | "tolOther">;

/** The state read by the Monte-Carlo toggle and controls. */
export type MonteCarloState = ToleranceInput & Pick<State, "mc" | "runs">;

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

/**
 * Playground state: the form values behind every panel, and the rules that keep
 * them valid against the compiled circuit. Pure: no access to `window`,
 * `location` or `navigator`; the page passes those values in.
 */
import type { ElecMap } from "../../src";
import type { Example, Tab } from "./examples";
import { spice } from "./format";
import type { Lang } from "./i18n";

export interface State {
  netlist: string;
  tab: Tab;
  /** Transfer function. */
  input: string;
  outKind: "voltage" | "current";
  output: string;
  reference: string;
  outCurrent: string;
  literal: boolean;
  fStart: string;
  fStop: string;
  /** Monte-Carlo envelope of the Bode plot (tolerances in %). */
  mc: boolean;
  tolR: string;
  tolC: string;
  tolL: string;
  tolOther: string;
  runs: string;
  /** Transient. */
  tStop: string;
  tStep: string;
  method: "gear2" | "trap" | "euler";
  traces: string[];
  currents: string[];
  /** Impedance. */
  zA: string;
  zB: string;
  /** Schematic. */
  style: "iec" | "ansi";
  /** Input: netlist text or block drawing. */
  mode: "text" | "draw";
}

/** State of a fresh page showing `example`. */
export function defaultState(example: Example): State {
  return {
    netlist: example.netlist,
    tab: example.tab,
    input: "",
    outKind: "voltage",
    output: example.output ?? "",
    reference: "",
    outCurrent: "",
    literal: false,
    fStart: "",
    fStop: "",
    mc: false,
    tolR: "5",
    tolC: "10",
    tolL: "10",
    tolOther: "",
    runs: "100",
    tStop: example.tStop !== undefined ? spice(example.tStop) : "",
    tStep: "",
    method: "gear2",
    traces: example.trace ?? [],
    currents: [],
    zA: "",
    zB: "",
    style: "iec",
    mode: "text",
  };
}

/**
 * Interface language: `?lang=fr` or `?lang=en` in `search` wins; without it,
 * French when the browser language (`navLang`) is French; English otherwise.
 */
export function detectLang(search: string, navLang: string): Lang {
  const asked = new URLSearchParams(search).get("lang");
  return asked === "fr" || (asked === null && navLang.toLowerCase().startsWith("fr")) ? "fr" : "en";
}

/** Prefix of an input that is a node voltage (`v:in`) rather than a source id. */
export const VOLTAGE = "v:";

/** Ids of the independent sources of `circuit` (none while it does not compile). */
export function sourceIds(circuit: ElecMap | undefined): string[] {
  return (circuit?.components() ?? [])
    .filter((c) => c.type === "vsource" || c.type === "isource")
    .map((c) => c.id);
}

/**
 * Keeps the selected nodes and components of `state` valid after an edit
 * (mutates `state`) and returns the selected component, cleared when it is gone.
 */
export function fixSelections(
  state: State,
  circuit: ElecMap,
  ground: string,
  selected: string | undefined,
): string | undefined {
  const nodes = circuit.nodes();
  const ids = circuit.components().map((c) => c.id);
  const sources = sourceIds(circuit);
  const guess = nodes.includes("out") ? "out" : (nodes[nodes.length - 1] ?? ground);
  if (!nodes.includes(state.output)) state.output = guess;
  if (state.reference !== "" && !nodes.includes(state.reference)) state.reference = "";
  if (!ids.includes(state.outCurrent)) state.outCurrent = ids[0] ?? "";
  const inputOk =
    sources.includes(state.input) ||
    (state.input.startsWith(VOLTAGE) && nodes.includes(state.input.slice(VOLTAGE.length)));
  if (state.input !== "" && !inputOk) state.input = "";
  state.traces = state.traces.filter((n) => nodes.includes(n));
  state.currents = state.currents.filter((id) => ids.includes(id));
  if (state.traces.length === 0 && state.currents.length === 0) {
    state.traces = nodes.includes("in") && guess !== "in" ? ["in", guess] : [guess];
  }
  if (!nodes.includes(state.zA)) state.zA = nodes[0] ?? "";
  if (state.zB !== ground && !nodes.includes(state.zB)) state.zB = ground;
  return selected !== undefined && !ids.includes(selected) ? undefined : selected;
}

/** Adds `value` to `list`, or removes it when already there (in place). */
export function toggle(list: string[], value: string): void {
  const i = list.indexOf(value);
  if (i >= 0) list.splice(i, 1);
  else list.push(value);
}

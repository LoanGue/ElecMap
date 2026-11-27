/**
 * Probing: what a click on a node or a component of the schematic does to the
 * playground state in each tab, and which nodes and components are marked. Pure:
 * the page applies the result to the DOM.
 */
import type { State } from "./state";
import { toggle } from "./state";

/** What was clicked: a node (a wire) or a component. */
export type ProbeKind = "node" | "part";

/**
 * Applies a click on `value` to `state` (mutated) and returns the selected
 * component afterwards. A node becomes a trace in the Transient tab, the first
 * terminal in the Impedance tab, and the voltage output of the transfer
 * function anywhere else (opening that tab). A component toggles the selection,
 * a current trace in the Transient tab, and the current output of the transfer
 * function when that output is a current.
 */
export function probe(
  state: State,
  selected: string | undefined,
  kind: ProbeKind,
  value: string,
): string | undefined {
  if (kind === "node") {
    if (state.tab === "transient") toggle(state.traces, value);
    else if (state.tab === "impedance") state.zA = value;
    else {
      state.tab = "transfer";
      state.outKind = "voltage";
      state.output = value;
    }
    return selected;
  }
  if (state.tab === "transient") toggle(state.currents, value);
  if (state.tab === "transfer" && state.outKind === "current") state.outCurrent = value;
  return selected === value ? undefined : value;
}

/** Nodes and components marked on the schematic and the drawing. */
export interface Highlights {
  nodes: Set<string>;
  parts: Set<string>;
}

/** What the open tab of `state` probes, plus the `selected` component. */
export function highlights(state: State, selected: string | undefined): Highlights {
  const nodes = new Set<string>();
  const parts = new Set<string>();
  if (selected) parts.add(selected);
  if (state.tab === "transfer") {
    if (state.outKind === "voltage") {
      nodes.add(state.output);
      if (state.reference) nodes.add(state.reference);
    } else parts.add(state.outCurrent);
  }
  if (state.tab === "transient") {
    state.traces.forEach((n) => nodes.add(n));
    state.currents.forEach((id) => parts.add(id));
  }
  if (state.tab === "impedance") [state.zA, state.zB].forEach((n) => nodes.add(n));
  return { nodes, parts };
}

/**
 * Transfer function panel: the input and output selects, H(s) (numeric or
 * literal), the transfer warnings, the metrics and the Bode plot (plain or
 * with its Monte-Carlo envelope). Pure: everything comes from the circuit and
 * the panel context, and the panel is returned as HTML.
 */
import type { ElecMap, OutputSpec, TransferOptions } from "../../../src";
import { bodeControls, bodePlot, metrics } from "../bode";
import { esc, message, option } from "../format";
import { sourceIds, VOLTAGE } from "../state";
import type { State } from "../state";
import type { PanelContext } from "./context";
import { monteCarloBode, monteCarloControls } from "./monte-carlo";

/** The state read to build the transfer specification. */
export type TransferInput = Pick<
  State,
  "input" | "outKind" | "output" | "outCurrent" | "reference"
>;

/** The output picked in the controls: a node (against a reference) or a branch current. */
export function outputSpec(state: TransferInput): OutputSpec {
  if (state.outKind === "current") return { current: state.outCurrent };
  return state.reference ? [state.output, state.reference] : state.output;
}

/**
 * The transfer specification: `spec` names the input source (for the literal
 * form), `full` also accepts a node voltage as input, and `node` is that node.
 */
export function transferSpec(state: TransferInput): {
  spec: { output: OutputSpec; input?: string };
  full: TransferOptions;
  node: string;
} {
  const node = state.input.startsWith(VOLTAGE) ? state.input.slice(VOLTAGE.length) : "";
  const source = node ? "" : state.input;
  const spec = { output: outputSpec(state), ...(source ? { input: source } : {}) };
  const full: TransferOptions = node ? { ...spec, input: { voltage: node } } : spec;
  return { spec, full, node };
}

/** Input, output and reference selects, and the numeric or literal switch. */
export function transferControls(c: ElecMap, ctx: PanelContext): string {
  const { state, t, ground } = ctx;
  const nodes = c.nodes();
  const ids = c.components().map((x) => x.id);
  return `
<div class="pg-controls">
  <label>${t.input}
    <select data-bind="input">${option("", `${t.auto}`, state.input)}${sourceIds(c)
      .map((id) => option(id, id, state.input))
      .join("")}${nodes
      .filter((n) => n !== state.output)
      .map((n) => option(`${VOLTAGE}${n}`, `V(${n})`, state.input))
      .join("")}</select></label>
  <label>${t.output}
    <select data-bind="outKind">${option("voltage", t.outputVoltage, state.outKind)}${option(
      "current",
      t.outputCurrent,
      state.outKind,
    )}</select>
    ${
      state.outKind === "voltage"
        ? `<select data-bind="output">${nodes.map((n) => option(n, n, state.output)).join("")}</select>`
        : `<select data-bind="outCurrent">${ids.map((n) => option(n, n, state.outCurrent)).join("")}</select>`
    }</label>
  ${
    state.outKind === "voltage"
      ? `<label>${t.reference}<select data-bind="reference">${option("", ground, state.reference)}${nodes
          .filter((n) => n !== state.output)
          .map((n) => option(n, n, state.reference))
          .join("")}</select></label>`
      : ""
  }
  <div class="pg-seg">
    <button data-literal="0" class="${state.literal ? "" : "on"}">${t.numeric}</button>
    <button data-literal="1" class="${state.literal ? "on" : ""}">${t.literal}</button>
  </div>
</div>`;
}

/** The whole Transfer tab for `c`. */
export function transferPanel(c: ElecMap, ctx: PanelContext): string {
  const { state, t, figure } = ctx;
  const { spec, full, node } = transferSpec(state);
  const H = c.transferFunction(full);
  const name = state.outKind === "current" ? "\\frac{I(s)}{V_{in}(s)}" : "H(s)";
  let latex = `${name} = ${H.toLatex()}`;
  let literalNote = "";
  if (state.literal && node) {
    literalNote = `<p class="pg-note">${t.literalUnavailable}: V(${esc(node)})</p>`;
  } else if (state.literal) {
    try {
      latex = `${name} = ${c.symbolicTransferFunction(spec).toLatex()}`;
    } catch (err) {
      literalNote = `<p class="pg-note">${t.literalUnavailable}: ${esc(message(err))}</p>`;
    }
  }
  const warnings = c.transferWarnings(full).map((w) => `<li>${esc(w.message)}</li>`);
  const warnBox = warnings.length
    ? `<div class="pg-warn"><strong>${t.warnings}</strong><ul>${warnings.join("")}</ul></div>`
    : "";
  return `${transferControls(c, ctx)}
<div class="pg-math" data-tex="${esc(latex)}"></div>${literalNote}${warnBox}
${metrics(H, t)}
${bodeControls(state, t, monteCarloControls(state, t))}
${state.mc ? monteCarloBode(c, full, H, state, t, figure) : bodePlot(H, state, t, figure)}`;
}

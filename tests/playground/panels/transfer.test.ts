import { describe, expect, it } from "vitest";
import { ElecMap } from "../../../src";
import type { PlotOptions } from "../../../docs/site/plot";
import type { PanelContext } from "../../../docs/playground/panels/context";
import { outputSpec, transferPanel, transferSpec } from "../../../docs/playground/panels/transfer";
import { EXAMPLES } from "../../../docs/playground/examples";
import { STRINGS } from "../../../docs/playground/i18n";
import { defaultState } from "../../../docs/playground/state";
import type { State } from "../../../docs/playground/state";

const t = STRINGS.en;
const RC = "V1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n";
const SCHMITT = "V1 n1 0 1\nR3 in n1 1k\nX1 n2 in out OPAMP\nR2 n2 out 1k\nR1 n2 0 1k\n";
const base: State = { ...defaultState(EXAMPLES[0] as (typeof EXAMPLES)[0]), output: "out" };

/** The Transfer tab of `netlist`, with the options given to the figure builder. */
function panel(over: Partial<State> = {}, netlist = RC, ground = "0") {
  const calls: PlotOptions[] = [];
  const ctx: PanelContext = {
    state: { ...base, ...over },
    t,
    selected: undefined,
    ground,
    figure: (o) => {
      calls.push(o);
      return "FIG";
    },
  };
  return { html: transferPanel(new ElecMap(netlist), ctx), calls };
}

/** The LaTeX given to KaTeX. */
const tex = (html: string) => /data-tex="([^"]*)"/.exec(html)?.[1];

describe("playground transfer panel", () => {
  it("reads the output as a node, a node pair or a branch current", () => {
    const pick = { input: "", output: "out", outCurrent: "R1", reference: "" };
    expect(outputSpec({ ...pick, outKind: "voltage" })).toBe("out");
    expect(outputSpec({ ...pick, outKind: "voltage", reference: "in" })).toEqual(["out", "in"]);
    expect(outputSpec({ ...pick, outKind: "current", reference: "in" })).toEqual({
      current: "R1",
    });
  });

  it("takes a source or a node voltage as input, the literal form only a source", () => {
    const pick = { outKind: "voltage", output: "out", outCurrent: "", reference: "" } as const;
    expect(transferSpec({ ...pick, input: "V1" })).toEqual({
      spec: { output: "out", input: "V1" },
      full: { output: "out", input: "V1" },
      node: "",
    });
    expect(transferSpec({ ...pick, input: "v:in" })).toEqual({
      spec: { output: "out" },
      full: { output: "out", input: { voltage: "in" } },
      node: "in",
    });
    expect(transferSpec({ ...pick, input: "" }).spec).toEqual({ output: "out" });
  });

  it("renders H(s), the input select and a Bode plot for an RC", () => {
    const { html, calls } = panel();
    expect(tex(html)).toBe("H(s) = \\frac{1}{1 + 0.001\\,s}");
    expect(html).toContain('<select data-bind="input">');
    expect(html).toContain('<option value="V1">V1</option>');
    expect(html).toContain('<option value="v:in">V(in)</option>');
    expect(html).not.toContain('value="v:out"');
    expect(html).toContain('<option value="out" selected>out</option>');
    expect(html).toContain('class="pg-metrics"');
    expect(html).toContain('data-bind="fStart"');
    expect(html).toContain("FIG");
    expect(calls).toHaveLength(1);
    expect(html).not.toContain("pg-warn");
  });

  it("names the reference select after the circuit ground", () => {
    const { html } = panel({}, RC, "gnd");
    expect(html).toMatch(/data-bind="reference"><option value="" selected>gnd<\/option>/);
  });

  it("switches to a branch current, without a reference", () => {
    const { html } = panel({ outKind: "current", outCurrent: "R1" });
    expect(tex(html)).toMatch(/^\\frac\{I\(s\)\}\{V_\{in\}\(s\)\} = /);
    expect(html).toContain('<select data-bind="outCurrent">');
    expect(html).not.toContain('data-bind="reference"');
  });

  it("shows the literal form, or why it is unavailable", () => {
    const literal = panel({ literal: true, input: "V1" }).html;
    expect(tex(literal)).toMatch(/^H\(s\) = .*R_\{1\}/);
    expect(literal).toContain('data-literal="1" class="on"');
    const node = panel({ literal: true, input: "v:in" }).html;
    expect(node).toContain(`${t.literalUnavailable}: V(in)`);
    expect(tex(node)).toBe(tex(panel({ input: "v:in" }).html));
  });

  it("lists the transfer warnings", () => {
    const { html } = panel({}, SCHMITT);
    expect(html).toContain(`<div class="pg-warn"><strong>${t.warnings}</strong><ul><li>`);
  });

  it("draws the Monte-Carlo envelope when it is on", () => {
    const { html, calls } = panel({ mc: true, runs: "5" });
    expect(html).toContain('data-bind="tolR"');
    expect(html).toContain("pg-mc-stats");
    expect(calls[0]?.panels[0]?.bands).toHaveLength(1);
  });
});

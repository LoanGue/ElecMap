import { describe, expect, it } from "vitest";
import { ElecMap } from "../../../src";
import type { ComponentJSON } from "../../../src";
import type { PanelContext } from "../../../docs/playground/panels/context";
import { dcPanel, typeName } from "../../../docs/playground/panels/dc";
import { EXAMPLES } from "../../../docs/playground/examples";
import { STRINGS } from "../../../docs/playground/i18n";
import type { Lang } from "../../../docs/playground/i18n";
import { defaultState } from "../../../docs/playground/state";

const DIVIDER = "V1 in 0 10\nR1 in out 1k\nR2 out 0 1k\n";
const DIODE = "V1 in 0 5\nR1 in a 1k\nD1 a 0 D\n.model D D\n";

/** The DC tab of `netlist`, with `selected` highlighted. */
function panel(netlist: string, selected?: string, lang: Lang = "en"): string {
  const ctx: PanelContext = {
    state: defaultState(EXAMPLES[0] as (typeof EXAMPLES)[0]),
    t: STRINGS[lang],
    selected,
    ground: "0",
    figure: () => "FIG",
  };
  return dcPanel(new ElecMap(netlist), ctx);
}

/** The cells of the row of component `id`. */
const row = (html: string, id: string) =>
  new RegExp(`<tr data-id="${id}"[^>]*>(.*?)</tr>`, "s").exec(html)?.[1] ?? "";

describe("playground DC panel", () => {
  it("lists the node voltages of a divider", () => {
    const html = panel(DIVIDER);
    expect(html).toContain(`<tr data-node="in"><td><code>in</code></td><td class="num">10 V</td>`);
    expect(html).toContain(`<tr data-node="out"><td><code>out</code></td><td class="num">5 V</td>`);
  });

  it("gives each component its current and power, and a balance of zero", () => {
    const html = panel(DIVIDER);
    expect(row(html, "V1")).toContain("-50 mW");
    expect(row(html, "R1")).toContain("5 mA");
    expect(row(html, "R2")).toContain("25 mW");
    expect(html).toMatch(/Power balance \(Σ P\)<\/td><td class="num">0 W<\/td>/);
  });

  it("shows a dash when a component has no current", () => {
    const coupled = "V1 a 0 1\nL1 a b 1m\nR1 b 0 1k\nL2 c 0 1m\nR2 c 0 1k\nK1 L1 L2 0.5\n";
    expect(row(panel(coupled), "K1")).toMatch(
      /<td class="num">—<\/td>\s*<td class="num">0 W<\/td>/,
    );
    expect(row(panel(coupled), "R1")).not.toContain("—");
  });

  it("shows the balance when gmin leaks power from a floating node", () => {
    const html = panel("I1 0 a 1m\nC1 a 0 1u\n");
    expect(html).toMatch(/\(Σ P\)<\/td><td class="num">-1 MW<\/td>/);
    expect(html).toContain(` · ${STRINGS.en.gmin}</p>`);
  });

  it("rounds a balance of numerical noise to zero", () => {
    for (const id of ["common-emitter", "wheatstone"]) {
      const example = EXAMPLES.find((e) => e.id === id);
      expect(panel(example?.netlist ?? "")).toMatch(/\(Σ P\)<\/td><td class="num">0 W<\/td>/);
    }
  });

  it("marks only the selected component's row", () => {
    expect(panel(DIVIDER, "R2").match(/class="sel"/g)).toHaveLength(1);
    expect(panel(DIVIDER, "R2")).toContain(`<tr data-id="R2" class="sel">`);
    expect(panel(DIVIDER, "R1")).toContain(`<tr data-id="R1" class="sel">`);
    expect(panel(DIVIDER)).not.toContain(`class="sel"`);
  });

  it("says how the operating point was solved", () => {
    expect(panel(DIVIDER)).toContain(`<p class="pg-note">${STRINGS.en.linear}</p>`);
    expect(panel(DIODE)).toMatch(/<p class="pg-note">Newton-Raphson: \d+ iterations<\/p>/);
  });

  it("translates the headers and component types", () => {
    const html = panel(DIVIDER, undefined, "fr");
    expect(html).toContain("<th>Nœud</th>");
    expect(row(html, "V1")).toContain("<td>source de tension</td>");
    expect(html).toContain("Bilan de puissance (Σ P)");
  });

  it("falls back to the raw type when it has no translation", () => {
    const t = STRINGS.en;
    expect(typeName({ type: "vsource" } as ComponentJSON, t)).toBe("voltage source");
    expect(typeName({ type: "resistor" } as ComponentJSON, STRINGS.fr)).toBe("résistance");
    expect(typeName({ type: "mystery" } as unknown as ComponentJSON, t)).toBe("mystery");
  });
});

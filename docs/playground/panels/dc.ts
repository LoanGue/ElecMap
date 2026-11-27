/**
 * DC panel: the node voltages, then the current and power of every component
 * with the power balance, and how the operating point was solved. Pure:
 * everything comes from the circuit and the panel context, and the panel is
 * returned as HTML.
 */
import type { ComponentJSON, ElecMap } from "../../../src";
import { attempt, esc, si } from "../format";
import type { Strings } from "../i18n";
import type { PanelContext } from "./context";

/** The translated name of a component type, else the raw type. */
export function typeName(comp: ComponentJSON, t: Strings): string {
  return t.types[comp.type] ?? comp.type;
}

/** The DC tab of `c`; the row of the selected component carries `sel`. */
export function dcPanel(c: ElecMap, { t, selected }: PanelContext): string {
  const op = c.operatingPoint();
  const nodes = c
    .nodes()
    .map(
      (n) =>
        `<tr data-node="${esc(n)}"><td><code>${esc(n)}</code></td><td class="num">${si(op.voltage(n), "V")}</td></tr>`,
    )
    .join("");
  let balance = 0;
  const rows = c
    .components()
    .map((comp) => {
      const current = attempt(() => op.current(comp.id));
      const power = attempt(() => op.power(comp.id));
      if (power !== undefined) balance += power;
      const cls = comp.id === selected ? ` class="sel"` : "";
      return `<tr data-id="${esc(comp.id)}"${cls}><td><code>${esc(comp.id)}</code></td><td>${esc(typeName(comp, t))}</td>
        <td class="num">${current === undefined ? "—" : si(current, "A")}</td>
        <td class="num">${power === undefined ? "—" : si(power, "W")}</td></tr>`;
    })
    .join("");
  const notes = [
    op.iterations > 0 ? t.newton(op.iterations) : t.linear,
    ...(op.gminUsed ? [t.gmin] : []),
  ];
  return `
<div class="pg-grid2">
  <table class="pg-table"><thead><tr><th>${t.node}</th><th class="num">${t.voltage}</th></tr></thead><tbody>${nodes}</tbody></table>
  <table class="pg-table"><thead><tr><th>${t.component}</th><th>${t.type}</th><th class="num">${t.current}</th><th class="num">${t.power}</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td colspan="3">${t.powerBalance} (Σ P)</td><td class="num">${si(Math.abs(balance) < 1e-12 ? 0 : balance, "W")}</td></tr></tfoot></table>
</div>
<p class="pg-note">${notes.join(" · ")}</p>`;
}

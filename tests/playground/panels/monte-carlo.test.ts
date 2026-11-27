import { describe, expect, it } from "vitest";
import { bodeControls } from "../../../docs/playground/bode";
import { monteCarloControls } from "../../../docs/playground/panels/monte-carlo";
import { EXAMPLES } from "../../../docs/playground/examples";
import { STRINGS } from "../../../docs/playground/i18n";
import { defaultState } from "../../../docs/playground/state";

const t = STRINGS.en;
const base = { ...defaultState(EXAMPLES[0] as (typeof EXAMPLES)[0]), mc: true };

describe("playground monte-carlo", () => {
  it("shows the tolerance fields only with the envelope on", () => {
    const off = monteCarloControls({ ...base, mc: false }, t);
    expect(off.toggle).toContain('class="pg-toggle"');
    expect(off.row).toBe("");
    const on = monteCarloControls({ ...base, tolOther: "<Q1>" }, t);
    expect(on.toggle).toContain('class="pg-toggle on"');
    for (const key of ["tolR", "tolC", "tolL", "tolOther", "runs"])
      expect(on.row).toContain(`data-bind="${key}"`);
    expect(on.row).toContain('value="&lt;Q1&gt;"');
    expect(bodeControls(base, t, on)).toMatch(
      /pg-toggle on[^\n]*\n<\/div><div class="pg-controls pg-small pg-mc">/,
    );
  });
});

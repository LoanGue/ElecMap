import { describe, expect, it } from "vitest";
import { ElecMap } from "../../../src";
import type { PlotOptions } from "../../../docs/site/plot";
import { bodeControls, gainFloor } from "../../../docs/playground/bode";
import {
  monteCarloBode,
  monteCarloControls,
  tolerances,
} from "../../../docs/playground/panels/monte-carlo";
import { EXAMPLES } from "../../../docs/playground/examples";
import { STRINGS } from "../../../docs/playground/i18n";
import { defaultState } from "../../../docs/playground/state";

const t = STRINGS.en;
const RC = "V1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n";
const TOL = { tolR: "5", tolC: "10", tolL: "20", tolOther: "" };
const base = { ...defaultState(EXAMPLES[0] as (typeof EXAMPLES)[0]), mc: true };

/** Monte-Carlo Bode to `out` (the RC by default), with the options given to the figure builder. */
function envelope(over: Partial<typeof base> = {}, netlist = RC) {
  const c = new ElecMap(netlist);
  const spec = { output: "out" };
  const calls: PlotOptions[] = [];
  const html = monteCarloBode(c, spec, c.transferFunction(spec), { ...base, ...over }, t, (o) => {
    calls.push(o);
    return "FIG";
  });
  return { html, options: calls[0] as PlotOptions };
}

describe("playground monte-carlo", () => {
  it("gives R, C and L their family tolerance", () => {
    const c = new ElecMap("V1 in 0 1\nR1 in a 1k\nL1 a b 1m\nC1 b 0 1u\nR2 b 0 10k\n");
    expect(tolerances(c, TOL, t)).toEqual({ R1: 0.05, L1: 0.2, C1: 0.1, R2: 0.05 });
    expect(tolerances(c, { ...TOL, tolR: "0", tolL: "" }, t)).toEqual({ C1: 0.1 });
  });

  it("reads free id percent entries, which override the family", () => {
    const c = new ElecMap(RC);
    const free = { ...TOL, tolOther: "R1 1%, V1.dc=±2 ; C1: 0\n" };
    expect(tolerances(c, free, t)).toEqual({ R1: 0.01, C1: 0, "V1.dc": 0.02 });
    expect(() => tolerances(c, { ...TOL, tolOther: "R1 five" }, t)).toThrow(
      `${t.tolSyntax}: "R1 five"`,
    );
    expect(() => tolerances(c, { ...TOL, tolOther: "R1 -3" }, t)).toThrow(t.tolSyntax);
  });

  it("shows the tolerance fields only with the envelope on", () => {
    const off = monteCarloControls({ ...base, mc: false }, t);
    expect(off.toggle).toContain('class="pg-toggle"');
    expect(off.row).toBe("");
    const on = monteCarloControls(
      { ...base, tolR: "<r>", tolC: "<c>", tolL: "<l>", tolOther: "<Q1>" },
      { ...t, mcHint: 'a "hint"' },
    );
    expect(on.toggle).toContain('class="pg-toggle on" title="a &quot;hint&quot;"');
    for (const v of ["r", "c", "l"]) expect(on.row).toContain(`value="&lt;${v}&gt;"`);
    for (const key of ["tolR", "tolC", "tolL", "tolOther", "runs"])
      expect(on.row).toContain(`data-bind="${key}"`);
    expect(on.row).toContain('value="&lt;Q1&gt;"');
    expect(bodeControls(base, t, on)).toMatch(
      /pg-toggle on[^\n]*\n<\/div><div class="pg-controls pg-small pg-mc">/,
    );
  });

  it("draws an RC envelope that contains the nominal curve", () => {
    const { html, options } = envelope({ runs: "50" });
    expect(html).toMatch(/^<dl class="pg-metrics pg-mc-stats">.*<\/dl>\nFIG$/s);
    // DC gain stays 1 whatever the tolerances: its row is left out.
    expect(html).not.toContain(`<dt>${t.dcGain}</dt>`);
    expect(html).toContain(
      `<dt>${t.cutoff}</dt><dd>140.4 Hz … 182.3 Hz<small>−11.8 % / +14.6 % · σ 11.87 Hz</small></dd>`,
    );
    const [gain, phase] = options.panels as [PlotOptions["panels"][0], PlotOptions["panels"][0]];
    const band = gain.bands?.[0];
    const nominal = gain.series[0]?.y ?? [];
    expect(band?.label).toBe(`50 ${t.runsLabel}`);
    // 1 Hz to 100 kHz at 40 points per decade.
    expect(nominal).toHaveLength(201);
    expect(nominal.every((v, i) => (band?.lo[i] ?? 0) <= v && v <= (band?.hi[i] ?? 0))).toBe(true);
    // Tolerances widen the band above the cutoff, where R and C move the gain.
    expect((band?.hi[200] ?? 0) - (band?.lo[200] ?? 0)).toBeGreaterThan(1);
    const p = phase.bands?.[0];
    const phi = phase.series[0]?.y ?? [];
    expect(phi.every((v, i) => (p?.lo[i] ?? 0) <= v && v <= (p?.hi[i] ?? 0))).toBe(true);
  });

  it("clips the envelope at the gain floor", () => {
    // A high-pass falls to about -164 dB at 1 µHz, below its floor near -120 dB.
    const hp = "V1 in 0 1\nC1 in out 1u\nR1 out 0 1k\n";
    const gain = envelope({ fStart: "1u", runs: "5" }, hp).options.panels[0];
    const band = gain?.bands?.[0];
    const floor = gainFloor(gain?.series[0]?.y ?? []);
    for (const curve of [gain?.series[0]?.y, band?.lo, band?.hi])
      expect(Math.min(...(curve ?? []))).toBe(floor);
  });

  it("shows the DC gain spread of a divider", () => {
    const divider = "V1 in 0 1\nR1 in out 1k\nR2 out 0 1k\n";
    const { html } = envelope({ fStart: "10", fStop: "1k", runs: "20" }, divider);
    expect(html).toContain(
      `<dt>${t.dcGain}</dt><dd>0.4830 … 0.5139<small>−3.4 % / +2.8 % · σ 0.009510</small></dd>`,
    );
    expect(html).not.toContain(`<dt>${t.cutoff}</dt>`);
  });

  it("is deterministic and clamps the run count", () => {
    // One decade (41 points) keeps the 100 default runs quick.
    const decade = { fStart: "100", fStop: "1k" };
    const runs = (n: string) =>
      envelope({ ...decade, runs: n }).options.panels[0]?.bands?.[0]?.label;
    expect(envelope({ ...decade, runs: "30" })).toEqual(envelope({ ...decade, runs: "30" }));
    expect(runs("0")).toBe(`1 ${t.runsLabel}`);
    expect(runs("2.6")).toBe(`3 ${t.runsLabel}`);
    expect(runs("x")).toBe(`100 ${t.runsLabel}`);
  });

  it("falls back to the plain Bode plot on a bad tolerance", () => {
    const { html, options } = envelope({ tolOther: "R1 five" });
    expect(html).toBe(`<p class="pg-error">${t.tolSyntax}: &quot;R1 five&quot;</p>FIG`);
    expect(options.panels[0]?.bands).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { ElecMap } from "../../../src";
import type { PlotOptions } from "../../../docs/site/plot";
import type { PanelContext } from "../../../docs/playground/panels/context";
import { impedanceControls, impedancePanel } from "../../../docs/playground/panels/impedance";
import { EXAMPLES } from "../../../docs/playground/examples";
import { STRINGS } from "../../../docs/playground/i18n";
import type { Lang } from "../../../docs/playground/i18n";
import { defaultState } from "../../../docs/playground/state";
import type { State } from "../../../docs/playground/state";

/** R parallel to C: Z = 1k / (1 + s·1ms), corner at 159 Hz. */
const PARALLEL_RC = "R1 a 0 1k\nC1 a 0 1u\n";
/** 1k in series with 2k, no source. */
const SERIES_R = "R1 a b 1k\nR2 b 0 2k\n";
/** A 5 V divider of two 1k. */
const DIVIDER = "V1 a 0 5\nR1 a b 1k\nR2 b 0 1k\n";
/** R in series with C: open at DC. */
const SERIES_RC = "R1 a b 1k\nC1 b 0 1u\n";
const base = defaultState(EXAMPLES[0] as (typeof EXAMPLES)[0]);

/** The Impedance tab of `netlist`, with the arguments given to the figure builder. */
function panel(netlist: string, over: Partial<State>, lang: Lang = "en") {
  const calls: { options: PlotOptions; units: [string, number][] }[] = [];
  const ctx: PanelContext = {
    state: { ...base, ...over },
    t: STRINGS[lang],
    selected: undefined,
    ground: "0",
    figure: (options, units) => {
      calls.push({ options, units });
      return "FIG";
    },
  };
  return { html: impedancePanel(new ElecMap(netlist), ctx), calls, ctx };
}

/** The LaTeX given to KaTeX. */
const tex = (html: string) => /data-tex="([^"]*)"/.exec(html)?.[1];

/** The metrics as [label, value] pairs. */
const metrics = (html: string) =>
  [...html.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map((m) => [m[1], m[2]]);

/** The options of the `name` select. */
const options = (html: string, name: string) =>
  [
    ...(new RegExp(`data-bind="${name}">(.*?)</select>`).exec(html)?.[1] ?? "").matchAll(
      /<option value="([^"]*)"( selected)?>/g,
    ),
  ].map((m) => (m[2] ? `${m[1]}*` : m[1]));

/** The first curve of plot panel `k` (0: |Z|, 1: phase). */
function curve(options: PlotOptions | undefined, k: number) {
  const series = options?.panels[k]?.series[0];
  return { x: [...(series?.x ?? [])], y: [...(series?.y ?? [])] };
}

describe("playground impedance panel", () => {
  it("renders Z(s), its metrics and Bode plot for a parallel RC against the ground", () => {
    const { html, calls } = panel(PARALLEL_RC, { zA: "a", zB: "0" });
    expect(tex(html)).toBe("Z_{\\mathrm{a}}(s) = \\frac{1000}{1 + 0.001\\,s}");
    expect(metrics(html)).toEqual([
      ["DC value", "1 kΩ"],
      ["High-frequency value", "0 Ω"],
      ["Equivalent resistance", '<span class="pg-dim">not purely resistive</span>'],
      ["Thévenin (DC)", "0 V · 1 kΩ"],
    ]);
    expect(html).toContain('data-bind="fStart"');
    expect(html.endsWith("FIG")).toBe(true);

    expect(calls).toHaveLength(1);
    const o = calls[0]?.options;
    expect(calls[0]?.units).toEqual([
      ["Ω", 4],
      ["°", 4],
    ]);
    expect(o?.logX).toBe(true);
    expect(o?.panels[0]?.logY).toBe(true);
    expect(o?.panels[0]?.yLabel).toBe(STRINGS.en.zLabel);
    expect(o?.panels[1]?.yTicks).toEqual([-90, -45, 0]);
    // At the corner frequency, |Z| = 1k/√2 and the phase is -45°.
    const mag = curve(o, 0);
    const phase = curve(o, 1);
    const fc = 1 / (2 * Math.PI * 1e-3);
    const gaps = mag.x.map((f) => Math.abs(Math.log(f / fc)));
    const i = gaps.indexOf(Math.min(...gaps));
    expect(gaps[i]).toBeLessThan(0.01);
    expect(mag.y[i]).toBeCloseTo(1000 / Math.SQRT2, -1);
    expect(phase.y[i]).toBeCloseTo(-45, 0);
  });

  it("measures between two nodes, the ground or not", () => {
    const pair = panel(SERIES_R, { zA: "a", zB: "b" }).html;
    expect(tex(pair)).toBe("Z_{\\mathrm{a},\\mathrm{b}}(s) = 1000");
    expect(metrics(pair)).toEqual([
      ["DC value", "1 kΩ"],
      ["High-frequency value", "1 kΩ"],
      ["Equivalent resistance", "1 kΩ"],
      ["Thévenin (DC)", "0 V · 1 kΩ"],
    ]);
    const toGround = panel(SERIES_R, { zA: "a", zB: "0" }).html;
    expect(tex(toGround)).toBe("Z_{\\mathrm{a}}(s) = 3000");
    expect(metrics(toGround)[0]).toEqual(["DC value", "3 kΩ"]);
  });

  it("zeroes the sources for Z and keeps them for Thévenin", () => {
    const { html } = panel(DIVIDER, { zA: "b", zB: "0" });
    expect(tex(html)).toBe("Z_{\\mathrm{b}}(s) = 500");
    expect(metrics(html)[3]).toEqual(["Thévenin (DC)", "2.5 V · 500 Ω"]);
  });

  it("shows a port open at DC as infinite", () => {
    const { html } = panel(SERIES_RC, { zA: "a", zB: "0" });
    expect(tex(html)).toBe("Z_{\\mathrm{a}}(s) = \\frac{10^{6} + 1000\\,s}{s}");
    expect(metrics(html)).toEqual([
      ["DC value", "∞"],
      ["High-frequency value", "1 kΩ"],
      ["Equivalent resistance", '<span class="pg-dim">not purely resistive</span>'],
      ["Thévenin (DC)", "0 V · ∞"],
    ]);
  });

  it("drops the Thévenin row when the equivalent cannot be computed", () => {
    class NoThevenin extends ElecMap {
      override thevenin(): never {
        throw new Error("no equivalent");
      }
    }
    const { ctx } = panel(SERIES_R, { zA: "a", zB: "0" });
    const html = impedancePanel(new NoThevenin(SERIES_R), ctx);
    expect(metrics(html).map(([k]) => k)).toEqual([
      "DC value",
      "High-frequency value",
      "Equivalent resistance",
    ]);
  });

  it("plots over the frequency range typed in the controls", () => {
    const { calls } = panel(PARALLEL_RC, { zA: "a", zB: "0", fStart: "10", fStop: "1meg" });
    const { x } = curve(calls[0]?.options, 0);
    expect(x[0]).toBeCloseTo(10);
    expect(x[x.length - 1]).toBeCloseTo(1e6);
  });

  it("offers every node first, then the other nodes and the ground", () => {
    const { ctx } = panel(SERIES_R, { zA: "b", zB: "0" });
    const html = impedanceControls(new ElecMap(SERIES_R), ctx);
    expect(options(html, "zA")).toEqual(["a", "b*"]);
    expect(options(html, "zB")).toEqual(["a", "0*"]);
    const other = impedanceControls(new ElecMap(SERIES_R), {
      ...ctx,
      state: { ...ctx.state, zA: "a", zB: "b" },
    });
    expect(options(other, "zA")).toEqual(["a*", "b"]);
    expect(options(other, "zB")).toEqual(["b*", "0"]);
  });

  it("speaks French", () => {
    const { html } = panel(PARALLEL_RC, { zA: "a", zB: "0" }, "fr");
    expect(html).toContain("Entre<select");
    expect(metrics(html).map(([k]) => k)).toEqual([
      "Valeur en continu",
      "Valeur en haute fréquence",
      "Résistance équivalente",
      "Thévenin (DC)",
    ]);
    expect(html).toContain("pas purement résistif");
  });
});

import { describe, expect, it } from "vitest";
import { ElecMap } from "../../src";
import type { PlotOptions } from "../../docs/site/plot";
import {
  bodeControls,
  bodePlot,
  frequencyRange,
  metrics,
  phaseTicks,
} from "../../docs/playground/bode";
import { EXAMPLES } from "../../docs/playground/examples";
import { STRINGS } from "../../docs/playground/i18n";
import { defaultState } from "../../docs/playground/state";

const t = STRINGS.en;
const AUTO = { fStart: "", fStop: "" };
const rc = (netlist = "V1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n") =>
  new ElecMap(netlist).transferFunction({ output: "out" });

describe("playground bode", () => {
  it("widens the range of an RC to whole decades", () => {
    expect(frequencyRange(rc(), AUTO)).toEqual([1, 100000]);
  });

  it("uses valid user bounds and ignores invalid ones", () => {
    expect(frequencyRange(rc(), { fStart: "20", fStop: "5k" })).toEqual([10, 10000]);
    expect(frequencyRange(rc(), { fStart: "-1", fStop: "1" })).toEqual([1, 100000]);
    expect(frequencyRange(rc(), { fStart: "1meg", fStop: "" })).toEqual([1e6, 1e7]);
  });

  it("puts phase ticks on 45°, 90° or 180° steps", () => {
    expect(phaseTicks([0, -90])).toEqual([-90, -45, 0]);
    expect(phaseTicks([0, -270])).toEqual([-270, -180, -90, 0]);
    expect(phaseTicks([10, -600])).toEqual([-720, -540, -360, -180, 0, 180]);
  });

  it("plots gain and phase through the given figure builder", () => {
    const calls: { options: PlotOptions; units: [string, number][] }[] = [];
    const html = bodePlot(rc(), AUTO, t, (options, units) => {
      calls.push({ options, units });
      return "FIG";
    });
    expect(html).toBe("FIG");
    const [{ options, units }] = calls as [(typeof calls)[0]];
    expect(units).toEqual([
      ["dB", 4],
      ["°", 4],
    ]);
    const [gain, phase] = options.panels as [PlotOptions["panels"][0], PlotOptions["panels"][0]];
    const freq = gain.series[0]?.x ?? [];
    expect(freq[0]).toBeCloseTo(1);
    expect(freq[freq.length - 1]).toBeCloseTo(100000);
    expect(phase.yTicks).toEqual([-90, -45, 0]);
    // The gain of a high-pass falls to -inf at DC: it is clipped at the floor.
    const hp = new ElecMap("V1 in 0 1\nC1 in out 1u\nR1 out 0 1k\n").transferFunction({
      output: "out",
    });
    bodePlot(hp, { fStart: "1m", fStop: "" }, t, (o) => {
      const y = o.panels[0]?.series[0]?.y ?? [];
      expect(Math.min(...y)).toBeGreaterThanOrEqual(-120);
      return "";
    });
  });

  it("lists the metrics of an RC low-pass", () => {
    const html = metrics(rc(), t);
    expect(html).toContain(`<dt>${t.dcGain}</dt><dd>1 (0.00 dB)</dd>`);
    expect(html).toContain(`<dt>${t.cutoff}</dt><dd>159.2 Hz</dd>`);
    expect(html).toContain(`<dt>${t.order}</dt><dd>1</dd>`);
    expect(html).toContain("(159.2 Hz)");
    expect(html).not.toContain(`<dt>${t.q}</dt>`);
  });

  it("shows the Monte-Carlo controls only with tolerances on", () => {
    const s = defaultState(EXAMPLES[0] as (typeof EXAMPLES)[0]);
    expect(bodeControls(s, t)).not.toContain("data-mc");
    expect(bodeControls({ ...s, mc: false }, t, true)).not.toContain('data-bind="tolR"');
    const on = bodeControls({ ...s, mc: true, fStart: "<1>" }, t, true);
    expect(on).toContain('data-bind="tolR"');
    expect(on).toContain('value="&lt;1&gt;"');
  });
});

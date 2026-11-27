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
/** Transfer function to `out`; an RC low-pass by default. */
const rc = (netlist = "V1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n") =>
  new ElecMap(netlist).transferFunction({ output: "out" });

describe("playground bode", () => {
  it("widens the range of an RC to whole decades", () => {
    expect(frequencyRange(rc(), AUTO)).toEqual([1, 100000]);
  });

  it("uses valid user bounds and ignores invalid ones", () => {
    expect(frequencyRange(rc(), { fStart: "20", fStop: "5k" })).toEqual([10, 10000]);
    expect(frequencyRange(rc(), { fStart: "50", fStop: "" })).toEqual([10, 100000]);
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
    expect(units.flat()).toEqual(["dB", 4, "°", 4]);
    const [gain, phase] = options.panels as [PlotOptions["panels"][0], PlotOptions["panels"][0]];
    const freq = gain.series[0]?.x ?? [];
    expect(freq[0]).toBeCloseTo(1);
    expect(freq[freq.length - 1]).toBeCloseTo(100000);
    expect(phase.yTicks).toEqual([-90, -45, 0]);
  });

  it("clips the gain 120 dB below its peak", () => {
    // A high-pass falls to about -164 dB at 1 µHz; its sampled peak is just under 0 dB.
    const hp = rc("V1 in 0 1\nC1 in out 1u\nR1 out 0 1k\n");
    let gain: readonly number[] = [];
    bodePlot(hp, { fStart: "1u", fStop: "" }, t, (o) => {
      gain = o.panels[0]?.series[0]?.y ?? [];
      return "";
    });
    const floor = Math.max(...gain) - 120;
    expect(floor).toBeCloseTo(-120, 3);
    expect(Math.min(...gain)).toBe(floor);
    expect(gain.filter((v) => v === floor).length).toBeGreaterThan(1);
  });

  it("lists the metrics of an RC low-pass", () => {
    const html = metrics(rc(), t);
    expect(html).toContain(`<dt>${t.dcGain}</dt><dd>1 (0.00 dB)</dd>`);
    expect(html).toContain(`<dt>${t.cutoff}</dt><dd>159.2 Hz</dd>`);
    expect(html).toContain(`<dt>${t.order}</dt><dd>1</dd>`);
    expect(html).toContain("(159.2 Hz)");
    expect(html).not.toContain(`<dt>${t.q}</dt>`);
    // A resistive divider has no cutoff: the row is left out.
    const divider = rc("V1 in 0 1\nR1 in out 1k\nR2 out 0 1k\n");
    expect(metrics(divider, t)).not.toContain(`<dt>${t.cutoff}</dt>`);
  });

  it("lists the metrics of a series RLC band-pass", () => {
    const H = rc("V1 in 0 1\nL1 in a 10m\nC1 a out 1u\nR1 out 0 10\n");
    const html = metrics(H, t);
    expect(html).toContain(`<dt>${t.cutoff}</dt><dd>1.514 kHz, 1.673 kHz</dd>`);
    expect(html).toContain(`<dt>${t.q}</dt><dd>10.00</dd>`);
    expect(html).toContain(`<dt>${t.zeta}</dt><dd>0.05000</dd>`);
    // The peak gain is 0.9999999999999993: its dB value reads 0.00, not -0.00.
    expect(html).toContain(`<dt>${t.peak}</dt><dd>1 (0.00 dB) @ 1.592 kHz</dd>`);
    expect(html).toContain(`<dt>${t.bandwidth}</dt><dd>159.2 Hz</dd>`);
  });

  it("shows the Monte-Carlo controls only with tolerances on", () => {
    const s = defaultState(EXAMPLES[0] as (typeof EXAMPLES)[0]);
    expect(bodeControls(s, t)).not.toContain("data-mc");
    expect(bodeControls({ ...s, mc: false }, t, true)).not.toContain('data-bind="tolR"');
    const on = bodeControls({ ...s, mc: true, fStart: "<1>" }, t, true);
    expect(on).toContain('data-bind="tolR"');
    expect(on).toContain('class="pg-toggle on"');
    expect(bodeControls({ ...s, mc: false }, t, true)).toContain('class="pg-toggle"');
    expect(on).toContain('value="&lt;1&gt;"');
  });
});

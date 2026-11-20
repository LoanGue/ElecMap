/**
 * Generates the figures of the documentation site with ElecMap itself:
 * schematics (`toSVG`), Bode plots and time responses.
 * Called by `docs/site/build.ts`; output in `docs/.build/figures/` (not committed).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ElecMap } from "../../src";
import { fmt, niceTicks, plot } from "./plot";

let out = "";
const save = (name: string, svg: string): void => writeFileSync(join(out, name), svg);

interface Bar {
  label: string;
  value: number;
}

/** Horizontal bar chart, centred on 0 (positive bars right, negative left). */
function bars(items: Bar[], xLabel: string, width = 640): string {
  const left = 70;
  const right = 60;
  const top = 10;
  const row = 30;
  const bottom = 40;
  const pw = width - left - right;
  const height = top + items.length * row + bottom;
  const m = Math.max(...items.map((b) => Math.abs(b.value))) * 1.1 || 1;
  const tx = (v: number) => left + ((v + m) / (2 * m)) * pw;
  const ticks = niceTicks(-m, m, 6).filter((t) => Math.abs(t) <= m);
  const parts: string[] = [];
  for (const t of ticks) {
    const x = tx(t).toFixed(1);
    parts.push(
      `<line class="grid" x1="${x}" x2="${x}" y1="${top}" y2="${top + items.length * row}"/>`,
      `<text class="tick" x="${x}" y="${top + items.length * row + 16}" text-anchor="middle">${fmt(t)}</text>`,
    );
  }
  items.forEach((b, i) => {
    const y = top + i * row;
    const x0 = tx(0);
    const x1 = tx(b.value);
    const cls = b.value >= 0 ? "pos" : "neg";
    parts.push(
      `<rect class="bar ${cls}" x="${Math.min(x0, x1).toFixed(1)}" y="${y + 6}" width="${Math.abs(x1 - x0).toFixed(1)}" height="${row - 12}" rx="3"/>`,
      `<text class="label" x="${left - 10}" y="${y + row / 2}" text-anchor="end" dy="0.32em">${b.label}</text>`,
      `<text class="value" x="${(b.value >= 0 ? x1 + 6 : x1 - 6).toFixed(1)}" y="${y + row / 2}" text-anchor="${b.value >= 0 ? "start" : "end"}" dy="0.32em">${(Math.abs(b.value) < 5e-4 ? 0 : b.value).toFixed(3)}</text>`,
    );
  });
  parts.push(
    `<line class="axis" x1="${tx(0).toFixed(1)}" x2="${tx(0).toFixed(1)}" y1="${top}" y2="${top + items.length * row}"/>`,
    `<text class="label" x="${left + pw / 2}" y="${height - 6}" text-anchor="middle">${xLabel}</text>`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" class="em-plot" viewBox="0 0 ${width} ${height}" role="img">
${parts.join("\n")}
</svg>`;
}

const clampDb = (values: readonly number[]): number[] => values.map((v) => Math.max(v, -80));

/** Writes every figure into `dir`. */
export function writeFigures(dir: string, lang: "en" | "fr" = "en"): void {
  out = dir;
  const t = (en: string, fr: string): string => (lang === "fr" ? fr : en);
  mkdirSync(out, { recursive: true });
  // ---------------------------------------------------------------- circuits

  const rc = new ElecMap(`
  V1 in 0 DC 5 AC 1
  R1 in out 1k
  C1 out 0 100n
  `);
  save("rc-lowpass.svg", rc.toSVG({ theme: "none", showValues: true, title: "RC low-pass" }));
  {
    const bode = rc.transferFunction("out").bode({ fStart: 10, fStop: 1e6, points: 30 });
    save(
      "rc-bode.svg",
      plot({
        logX: true,
        xLabel: t("Frequency (Hz)", "Fréquence (Hz)"),
        panels: [
          {
            series: [{ x: bode.freq, y: clampDb(bode.magnitudeDb) }],
            yLabel: t("Gain (dB)", "Gain (dB)"),
          },
          {
            series: [{ x: bode.freq, y: bode.phase }],
            yLabel: t("Phase (°)", "Phase (°)"),
            yTicks: [0, -45, -90],
          },
        ],
      }),
    );
  }

  const sallenKey = new ElecMap(`
  V1 in 0 AC 1
  R1 in a 10k
  R2 a b 10k
  C1 a out 22n
  C2 b 0 10n
  X1 b out out OPAMP
  `);
  save(
    "sallen-key.svg",
    sallenKey.toSVG({ theme: "none", showValues: true, title: "Sallen-Key low-pass" }),
  );
  {
    const options = { fStart: 10, fStop: 1e5, points: 30 };
    const q = (c1: number) => sallenKey.symbolicTransferFunction("out").substitute({ C1: c1 });
    const curves = [
      { c1: 10e-9, label: "C1 = 10 nF" },
      { c1: 20e-9, label: "C1 = 20 nF (Butterworth)" },
      { c1: 100e-9, label: "C1 = 100 nF" },
    ].map(({ c1, label }) => ({ bode: q(c1).bode(options), label }));
    save(
      "sallen-key-bode.svg",
      plot({
        logX: true,
        xLabel: t("Frequency (Hz)", "Fréquence (Hz)"),
        panels: [
          {
            series: curves.map(({ bode, label }) => ({
              x: bode.freq,
              y: clampDb(bode.magnitudeDb),
              label,
            })),
            yLabel: t("Gain (dB)", "Gain (dB)"),
          },
          {
            series: curves.map(({ bode }) => ({ x: bode.freq, y: bode.phase })),
            yLabel: t("Phase (°)", "Phase (°)"),
            yTicks: [0, -45, -90, -135, -180],
          },
        ],
      }),
    );
  }

  const rlc = new ElecMap(`
  V1 in 0 PULSE(0 1 0 1n 1n 0.5m 1m)
  R1 in a 20
  L1 a out 10m
  C1 out 0 1u
  `);
  save("rlc.svg", rlc.toSVG({ theme: "none", showValues: true, title: "Series RLC" }));
  {
    const tr = rlc.transient({ tStop: 2e-3, tStep: 2e-6 });
    const H = rlc.transferFunction({ input: "V1", output: "out" });
    const step = H.stepResponse({ tStop: 0.5e-3, points: 120 });
    const ms = (t: readonly number[]) => t.map((v) => v * 1e3);
    save(
      "rlc-transient.svg",
      plot({
        xLabel: t("Time (ms)", "Temps (ms)"),
        xFormat: (v) => String(Number(v.toPrecision(3))),
        panels: [
          {
            series: [
              { x: ms(tr.time), y: tr.voltage("in"), label: "V(in)" },
              {
                x: ms(tr.time),
                y: tr.voltage("out"),
                label: t("V(out) transient", "V(out) transitoire"),
              },
              {
                x: ms(step.time),
                y: step.value,
                label: t("exact step response", "réponse indicielle exacte"),
                dashed: true,
              },
            ],
            yLabel: t("Voltage (V)", "Tension (V)"),
          },
          {
            series: [{ x: ms(tr.time), y: tr.current("L1").map((i) => i * 1e3) }],
            yLabel: "I(L1) (mA)",
          },
        ],
      }),
    );
  }

  const amplifier = new ElecMap(`
  V1 in 0 AC 1
  R1 in n 1k
  Rf n out 10k
  X1 0 n out OPAMP
  RL out 0 10k
  `);
  save(
    "inverting-iec.svg",
    amplifier.toSVG({ theme: "none", showValues: true, title: "Inverting amplifier" }),
  );
  save(
    "inverting-ansi.svg",
    amplifier.toSVG({
      theme: "none",
      style: "ansi",
      showValues: true,
      title: "Inverting amplifier",
    }),
  );

  const bridge = new ElecMap(`
  V1 in 0 DC 10
  R1 in a 1k
  R2 a 0 1k
  R3 in b 1k
  R4 b 0 1.2k
  `);
  save("bridge.svg", bridge.toSVG({ theme: "none", showValues: true, title: "Wheatstone bridge" }));

  const transformer = new ElecMap(`
  V1 in 0 AC 1
  R1 in p 10
  L1 p 0 10m
  L2 s 0 40m
  K1 L1 L2 0.99
  RL s 0 100
  `);
  save(
    "transformer.svg",
    transformer.toSVG({ theme: "none", showValues: true, title: "Transformer" }),
  );
  save(
    "highlight.svg",
    sallenKey.toSVG({
      theme: "none",
      highlight: ["C1", "out"],
      nodeLabels: true,
      title: "Highlighting",
    }),
  );

  const ladder = new ElecMap(`
  V1 in 0 AC 1
  R1 in a 1k
  C1 a 0 100n
  R2 a out 1k
  C2 out 0 100n
  `);
  const diode = new ElecMap(`
  V1 in 0 5
  R1 in a 1k
  D1 a 0 D1N4148
  .model D1N4148 D(IS=2.52n N=1.752 RS=0.568)
  `);
  save("diode.svg", diode.toSVG({ theme: "none", showValues: true, title: "Diode" }));
  const zener = new ElecMap(`
  V1 in 0 12
  R1 in k 470
  DZ 0 k DZ51
  RL k 0 1k
  .model DZ51 D(BV=5.1 IBV=5m)
  `);
  save(
    "zener.svg",
    zener.toSVG({
      theme: "none",
      showValues: true,
      title: t("Zener regulator", "Régulateur Zener"),
    }),
  );
  const rectifier = new ElecMap(`
  V1 in 0 SIN(0 10 50)
  D1 in out DMOD
  R1 out 0 1k
  C1 out 0 100u
  .model DMOD D(IS=1e-14)
  `);
  save(
    "rectifier.svg",
    rectifier.toSVG({
      theme: "none",
      showValues: true,
      title: t("Half-wave rectifier", "Redresseur simple alternance"),
    }),
  );
  {
    const tr = rectifier.transient({ tStop: 60e-3, tStep: 50e-6 });
    const ms = tr.time.map((v) => v * 1e3);
    save(
      "rectifier-transient.svg",
      plot({
        xLabel: t("Time (ms)", "Temps (ms)"),
        xFormat: (v) => String(Number(v.toPrecision(3))),
        panels: [
          {
            series: [
              { x: ms, y: tr.voltage("in"), label: "V(in)" },
              { x: ms, y: tr.voltage("out"), label: "V(out)" },
            ],
            yLabel: t("Voltage (V)", "Tension (V)"),
          },
          {
            series: [{ x: ms, y: tr.current("D1").map((i) => i * 1e3) }],
            yLabel: "I(D1) (mA)",
          },
        ],
      }),
    );
  }

  const q2n2222 = ".model Q2N2222 NPN(IS=14.34f BF=255.9 VAF=74.03 CJE=22p CJC=7.3p)";
  const ceStage = new ElecMap(`
  VCC vcc 0 12
  RB1 vcc b 47k
  RB2 b 0 10k
  RC vcc c 2.2k
  RE e 0 470
  Q1 c b e Q2N2222
  ${q2n2222}
  `);
  save(
    "ce-stage.svg",
    ceStage.toSVG({
      theme: "none",
      showValues: true,
      title: t("Common-emitter bias", "Polarisation émetteur commun"),
    }),
  );
  {
    const amp = new ElecMap(`
    VCC vcc 0 12
    VS in 0 AC 1
    CIN in b 10u
    RB1 vcc b 47k
    RB2 b 0 10k
    RC vcc c 2.2k
    RE e 0 470
    CE e 0 100u
    Q1 c b e Q2N2222
    ${q2n2222}
    `);
    const bode = amp
      .transferFunction({ input: "VS", output: "c" })
      .bode({ fStart: 1, fStop: 1e9, points: 120 });
    save(
      "ce-bode.svg",
      plot({
        logX: true,
        xLabel: t("Frequency (Hz)", "Fréquence (Hz)"),
        panels: [
          {
            series: [{ x: bode.freq, y: clampDb(bode.magnitudeDb) }],
            yLabel: t("Gain (dB)", "Gain (dB)"),
          },
          {
            series: [{ x: bode.freq, y: bode.phase }],
            yLabel: t("Phase (°)", "Phase (°)"),
          },
        ],
      }),
    );
  }
  const csStage = new ElecMap(`
  VDD vdd 0 10
  VG g 0 DC 3 AC 1
  RD vdd d 4.7k
  M1 d g 0 0 NMOD W=100u L=10u
  .model NMOD NMOS(VTO=1.5 KP=50u LAMBDA=0.02)
  `);
  save(
    "cs-stage.svg",
    csStage.toSVG({
      theme: "none",
      showValues: true,
      title: t("Common-source stage", "Étage source commune"),
    }),
  );
  {
    const inv = new ElecMap(`
    VDD vdd 0 5
    VIN in 0 0
    MP out in vdd vdd PMOS VTO=-0.7 KP=50u W=20u L=1u
    MN out in 0 0 NMOS VTO=0.7 KP=110u W=10u L=1u
    `);
    save(
      "cmos-inverter.svg",
      inv.toSVG({ theme: "none", showValues: true, title: t("CMOS inverter", "Inverseur CMOS") }),
    );
    const vin: number[] = [];
    const vout: number[] = [];
    const idd: number[] = [];
    for (let k = 0; k <= 100; k++) {
      const v = (5 * k) / 100;
      const op = inv.setValue("VIN", v).operatingPoint();
      vin.push(v);
      vout.push(op.voltage("out"));
      idd.push(op.current("MN") * 1e6);
    }
    save(
      "cmos-transfer.svg",
      plot({
        xLabel: "V(in) (V)",
        xFormat: (v) => String(Number(v.toPrecision(3))),
        panels: [
          {
            series: [{ x: vin, y: vout, label: "V(out)" }],
            yLabel: t("Voltage (V)", "Tension (V)"),
          },
          { series: [{ x: vin, y: idd }], yLabel: "I(MN) (µA)" },
        ],
      }),
    );
  }

  for (const ground of ["rail", "symbols"] as const)
    save(
      `ground-${ground}.svg`,
      ladder.toSVG({ theme: "none", ground, title: t("RC ladder", "Échelle RC") }),
    );

  // ---------------------------------------------------------------- sensitivities
  const bias = new ElecMap(`
  VCC vcc 0 12
  RB1 vcc b 47k
  RB2 b 0 10k
  RC vcc c 2.2k
  RE e 0 470
  Q1 c b e QN
  .model QN NPN(BF=200 IS=1e-14)
  `);
  save(
    "bias-sensitivities.svg",
    bars(
      bias.sensitivities({ current: "RC" }).map((s) => ({
        label: s.field === "value" || s.field === "dc" ? s.id : `${s.id}.${s.field}`,
        value: s.normalized,
      })),
      t("Normalised sensitivity of Ic", "Sensibilité normalisée de Ic"),
    ),
  );
  {
    const beta = [50, 100, 150, 200, 300, 400, 600];
    const fixed = new ElecMap(`
  VCC vcc 0 12
  RB vcc b 1.2meg
  RC vcc c 2.2k
  Q1 c b e QN
  VE e 0 0
  .model QN NPN(BF=200 IS=1e-14)
  `);
    const ic = (c: ElecMap) => beta.map((bf) => c.setValue("Q1", bf, "bf").current("RC") * 1e3);
    save(
      "bias-beta.svg",
      plot({
        xLabel: "β (BF)",
        xFormat: (v) => String(Math.round(v)),
        panels: [
          {
            series: [
              { x: beta, y: ic(bias), label: t("divider + RE", "pont + RE") },
              {
                x: beta,
                y: ic(fixed),
                label: t("fixed base current", "courant de base fixe"),
                dashed: true,
              },
            ],
            yLabel: "Ic (mA)",
          },
        ],
      }),
    );
  }

  // Junction capacitance: a varactor-tuned RC filter and the reverse recovery of a diode.
  {
    const vco = new ElecMap(`
  V1 in 0 DC 0 AC 1
  R1 in a 10k
  D1 0 a DVAR
  .model DVAR D(CJO=30p VJ=0.7 M=0.5)
  `);
    const vr = Array.from({ length: 41 }, (_, i) => i * 0.25);
    const fc = vr.map(
      (v) => vco.setValue("V1", v, "dc").transferFunction("a").cutoffFrequency() as number,
    );
    save(
      "varactor.svg",
      plot({
        xLabel: t("Reverse voltage (V)", "Tension inverse (V)"),
        xFormat: (v) => String(Number(v.toPrecision(3))),
        panels: [
          {
            series: [{ x: vr, y: fc.map((f) => 1 / (2 * Math.PI * 1e4 * f) / 1e-12) }],
            yLabel: t("Capacitance (pF)", "Capacité (pF)"),
          },
          { series: [{ x: vr, y: fc }], yLabel: "fc (Hz)" },
        ],
      }),
    );

    const recovery = (tt: string) =>
      new ElecMap(`
  V1 in 0 PULSE(5 -5 100n 1n 1n 1u 2u)
  R1 in a 1k
  D1 a 0 DS
  .model DS D(IS=1e-14 TT=${tt})
  `).transient({ tStop: 250e-9, tStep: 0.5e-9 });
    const fast = recovery("0");
    const slow = recovery("50n");
    const ns = fast.time.map((x) => x * 1e9);
    save(
      "reverse-recovery.svg",
      plot({
        xLabel: t("Time (ns)", "Temps (ns)"),
        xFormat: (v) => String(Math.round(v)),
        panels: [
          {
            series: [
              { x: ns, y: fast.current("D1").map((i) => i * 1e3), label: "TT = 0" },
              { x: ns, y: slow.current("D1").map((i) => i * 1e3), label: "TT = 50 ns" },
            ],
            yLabel: "I(D1) (mA)",
          },
          {
            series: [
              { x: ns, y: fast.voltage("a"), label: "TT = 0" },
              { x: ns, y: slow.voltage("a"), label: "TT = 50 ns" },
            ],
            yLabel: "V(a) (V)",
          },
        ],
      }),
    );
  }
}

/**
 * RC low-pass filter: transfer function, Bode data, DC and AC values.
 * Run with `npx tsx examples/rc-lowpass.ts`.
 */
import { ElecMap } from "../src";

const circuit = new ElecMap(`
.title RC low-pass
V1 in 0 DC 5 AC 1
R1 in out 1k
C1 out 0 100n
`);

const H = circuit.transferFunction("out");
console.log("H(s) =", H.toLatex());
console.log("type:", H.filterType(), "| fc =", H.cutoffFrequency()?.toFixed(1), "Hz");
console.log(
  "poles:",
  H.poles().map((p) => p.toString()),
);

const bode = H.bode({ fStart: 10, fStop: 100e3, points: 1 });
bode.freq.forEach((f, i) => {
  const db = bode.magnitudeDb[i] ?? 0;
  const phase = bode.phase[i] ?? 0;
  console.log(
    `${f.toExponential(1).padStart(8)} Hz  ${db.toFixed(2).padStart(7)} dB  ${phase.toFixed(1).padStart(6)}°`,
  );
});

console.log("V(out) DC =", circuit.voltage("out"), "V");
const out = H.apply({ amplitude: 1, freq: 1e3 });
console.log(
  "1 kHz sine →",
  out.components[0]?.amplitude.toFixed(3),
  "V,",
  out.components[0]?.phase.toFixed(1),
  "°",
);

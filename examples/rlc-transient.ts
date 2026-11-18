/**
 * Series RLC driven by a square wave: transient simulation of the circuit
 * compared with the exact step response of its transfer function.
 * Run with `npx tsx examples/rlc-transient.ts`.
 */
import { ElecMap } from "../src";

const rlc = new ElecMap(`
.title Series RLC
V1 in 0 PULSE(0 1 0 1n 1n 0.5m 1m)
R1 in a 20
L1 a out 10m
C1 out 0 1u
`);

const tr = rlc.transient({ tStop: 1e-3, tStep: 1e-6 });
const H = rlc.transferFunction({ input: "V1", output: "out" });
const exact = H.stepResponse({ tStop: 0.5e-3, points: 501 });

console.log("   t (µs)   V(out) sim   V(out) exact   I(L1) (mA)");
for (let i = 0; i <= 500; i += 50) {
  const t = tr.time[i] ?? 0;
  const v = tr.voltage("out")[i] ?? 0;
  const ref = exact.value[i] ?? 0;
  const iL = (tr.current("L1")[i] ?? 0) * 1e3;
  console.log(
    `${(t * 1e6).toFixed(0).padStart(8)} ${v.toFixed(4).padStart(12)} ${ref.toFixed(4).padStart(14)} ${iL.toFixed(3).padStart(12)}`,
  );
}
const f0 = H.naturalFrequency() ?? NaN;
console.log(`f0 = ${f0.toFixed(1)} Hz, damping ratio ζ = ${H.dampingRatio()?.toFixed(3)}`);

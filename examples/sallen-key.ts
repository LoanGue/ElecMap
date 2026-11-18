/**
 * Unity-gain Sallen-Key low-pass: literal and numeric transfer functions,
 * filter characteristics and step response.
 * Run with `npx tsx examples/sallen-key.ts`.
 */
import { ElecMap } from "../src";

const filter = new ElecMap(`
.title Sallen-Key low-pass
V1 in 0 AC 1
R1 in a 10k
R2 a b 10k
C1 a out 22n
C2 b 0 10n
X1 b out out OPAMP
`);

// Literal expression, straight from the schematic.
const symbolic = filter.symbolicTransferFunction("out");
console.log("H(s) literal:", symbolic.toLatex());

// Numeric expression and filter characteristics.
const H = filter.transferFunction("out");
console.log("H(s) numeric:", H.toLatex());
console.log("type:", H.filterType());
console.log("f0 =", (H.naturalFrequency() ?? NaN).toFixed(1), "Hz, Q =", H.qFactor()?.toFixed(3));
console.log("-3 dB at", H.cutoffFrequency()?.toFixed(1), "Hz");

// The literal form can be re-evaluated with other values (here a Butterworth tuning).
const butterworth = symbolic.substitute({ C1: 20e-9 });
console.log("with C1 = 20 nF: Q =", butterworth.qFactor()?.toFixed(3));

// Step response (exact, matrix exponential).
const step = H.stepInfo();
console.log(
  `step: overshoot ${step.overshoot.toFixed(2)} %, rise ${((step.riseTime ?? NaN) * 1e6).toFixed(1)} µs, settling ${((step.settlingTime ?? NaN) * 1e6).toFixed(1)} µs`,
);

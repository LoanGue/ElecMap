/**
 * Wheatstone bridge: node voltages, branch currents, Thévenin equivalent
 * seen by the detector, equivalent resistance and power balance.
 * Run with `npx tsx examples/bridge-thevenin.ts`.
 */
import { ElecMap } from "../src";

const bridge = new ElecMap(`
.title Wheatstone bridge
V1 in 0 DC 10
R1 in a 1k
R2 a 0 1k
R3 in b 1k
R4 b 0 1.2k
`);

console.log("V(a) =", bridge.voltage("a").toFixed(4), "V");
console.log("V(b) =", bridge.voltage("b").toFixed(4), "V");
console.log("V(a, b) =", bridge.voltage("a", "b").toFixed(4), "V");
console.log("I(R1) =", (bridge.current("R1") * 1e3).toFixed(3), "mA");

// What a detector connected between a and b sees.
const th = bridge.thevenin("a", "b");
console.log(
  `Thévenin: ${th.voltage.toFixed(4)} V behind ${th.resistance.toFixed(1)} Ω (Norton ${(th.current * 1e3).toFixed(3)} mA)`,
);
console.log("R(a, b) =", bridge.equivalentResistance("a", "b").toFixed(1), "Ω");

// Literal unbalance voltage.
console.log(
  "V(a,b)/V1 =",
  bridge.symbolicTransferFunction({ input: "V1", output: ["a", "b"] }).toLatex(),
);

// Power balance (sources negative): the total is zero.
const power = bridge.power();
for (const [id, p] of Object.entries(power)) console.log(`P(${id}) = ${(p * 1e3).toFixed(3)} mW`);

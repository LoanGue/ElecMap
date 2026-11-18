/**
 * Building a circuit from the canonical JSON format, round-tripping to SPICE
 * and handling errors.
 * Run with `npx tsx examples/json-input.ts`.
 */
import { ElecMap, ElecMapError } from "../src";
import type { CircuitJSON } from "../src";

const doc: CircuitJSON = {
  version: 1,
  ground: "0",
  title: "RL high-pass",
  components: [
    { id: "V1", type: "vsource", nodes: ["in", "0"], ac: { mag: 1 } },
    { id: "R1", type: "resistor", nodes: ["in", "out"], value: 100 },
    { id: "L1", type: "inductor", nodes: ["out", "0"], value: 10e-3 },
  ],
};

const c = new ElecMap(doc);
const H = c.transferFunction("out");
console.log(H.filterType(), "| fc =", H.cutoffFrequency()?.toFixed(1), "Hz |", H.toLatex());
console.log("as SPICE:\n" + c.toSpice());

// Every error is an ElecMapError with a stable code.
try {
  // Two voltage sources in parallel form a loop: the circuit is rejected.
  new ElecMap(["V1 a 0 1", "V2 a 0 2", "R1 a 0 1k"].join("\n"));
} catch (e) {
  if (e instanceof ElecMapError) console.log("error:", e.code, "-", e.message);
}

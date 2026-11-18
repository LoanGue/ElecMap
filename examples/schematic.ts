/**
 * Draws a few circuits as SVG files (IEC and ANSI styles) in `examples/output/`.
 * Run with `npx tsx examples/schematic.ts`, then open the files in a browser.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ElecMap } from "../src";

const circuits: Record<string, string> = {
  "rc-ladder": `V1 in 0 AC 1
R1 in a 1k
C1 a 0 1u
R2 a b 1k
C2 b 0 1u
R3 b out 1k
C3 out 0 1u`,
  "inverting-amplifier": `V1 in 0 AC 1
R1 in n 1k
Rf n out 10k
X1 0 n out OPAMP
RL out 0 10k`,
  transformer: `V1 in 0 AC 1
R1 in p 10
L1 p 0 10m
L2 s 0 40m
K1 L1 L2 0.99
RL s 0 100`,
};

const dir = join(dirname(fileURLToPath(import.meta.url)), "output");
mkdirSync(dir, { recursive: true });
for (const [name, netlist] of Object.entries(circuits)) {
  const c = new ElecMap(netlist);
  for (const style of ["iec", "ansi"] as const) {
    const file = join(dir, `${name}-${style}.svg`);
    writeFileSync(file, c.toSVG({ style, title: name }));
    console.log("wrote", file);
  }
}

// The layout can also be used directly, e.g. to build an interactive UI.
const layout = new ElecMap(circuits["rc-ladder"] as string).layout();
console.log(
  "rc-ladder:",
  layout.components
    .map((p) => `${p.id}@(${p.pins[0]?.x},${p.pins[0]?.y}) ${p.orientation}`)
    .join(", "),
);

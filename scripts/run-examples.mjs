// Runs every example of `examples/` with tsx and fails if one of them throws.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";

const tsx = createRequire(import.meta.url).resolve("tsx/cli");
const files = readdirSync("examples")
  .filter((f) => f.endsWith(".ts"))
  .sort();
let failed = 0;
for (const file of files) {
  process.stdout.write(`▶ examples/${file}\n`);
  const run = spawnSync(process.execPath, [tsx, `examples/${file}`], { stdio: "inherit" });
  if (run.status !== 0) {
    failed++;
    process.stderr.write(`✖ examples/${file} exited with ${run.status}\n`);
  }
}
process.exit(failed === 0 ? 0 : 1);

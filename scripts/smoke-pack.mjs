// Packs the library, installs the tarball in a temporary project and imports
// it both as ESM and CommonJS, as a consumer would.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Under `npm run`, npm_execpath points to npm's JS entry: run it with node (no shell needed).
const npmCli = process.env.npm_execpath;
const run = (args, cwd) =>
  npmCli
    ? execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: "utf8" })
    : execFileSync("npm", args, { cwd, encoding: "utf8" });

const dir = mkdtempSync(join(tmpdir(), "elecmap-pack-"));
try {
  const out = JSON.parse(run(["pack", "--json", "--pack-destination", dir], process.cwd()));
  const { filename, files } = out[0];
  const names = files.map((f) => f.path);
  for (const required of [
    "dist/index.js",
    "dist/index.cjs",
    "dist/index.d.ts",
    "README.md",
    "LICENSE",
  ]) {
    if (!names.includes(required)) throw new Error(`missing ${required} in the package`);
  }
  const unexpected = names.filter((n) => /^(src|tests|examples|notes|playground)\//.test(n));
  if (unexpected.length > 0) throw new Error(`unexpected files: ${unexpected.join(", ")}`);
  console.log(`${filename}: ${names.length} files`);

  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "consumer", private: true }));
  run(["install", "--no-audit", "--no-fund", "--silent", resolve(dir, filename)], dir);
  const netlist = "V1 in 0 AC 1\nR1 in out 1k\nC1 out 0 100n";
  writeFileSync(
    join(dir, "esm.mjs"),
    `import { ElecMap, VERSION } from "elecmap";
const c = new ElecMap(${JSON.stringify(netlist)});
console.log("ESM", VERSION, c.transferFunction("out").toLatex(), c.toSVG().length > 0);`,
  );
  writeFileSync(
    join(dir, "cjs.cjs"),
    `const { ElecMap } = require("elecmap");
const c = new ElecMap(${JSON.stringify(netlist)});
console.log("CJS", c.symbolicTransferFunction("out").toLatex());`,
  );
  for (const file of ["esm.mjs", "cjs.cjs"]) {
    process.stdout.write(execFileSync(process.execPath, [file], { cwd: dir, encoding: "utf8" }));
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

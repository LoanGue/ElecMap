/**
 * Bundles the playground (`docs/playground/`) into a static page.
 *
 * - `buildPlayground(dir)` is called by `docs/site/build.ts`: the page is
 *   published with the documentation, at `playground/`.
 * - `npm run playground` serves it locally and rebuilds on every change.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const version = (
  JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf8")) as { version: string }
).version;

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ElecMap — Playground</title>
<meta name="description" content="Try ElecMap in the browser: write a SPICE netlist, see its schematic, operating point, transfer function, Bode plot and transient response.">
<script>try{document.documentElement.dataset.theme=localStorage.getItem("tsd-theme")||"os"}catch(e){document.documentElement.dataset.theme="os"}</script>
<link rel="stylesheet" href="playground.css">
</head>
<body>
<noscript>The ElecMap playground needs JavaScript.</noscript>
<script src="playground.js"></script>
</body>
</html>
`;

function options(outdir: string): esbuild.BuildOptions {
  return {
    entryPoints: { playground: join(here, "main.ts") },
    outdir,
    bundle: true,
    format: "iife",
    target: "es2020",
    minify: true,
    sourcemap: true,
    legalComments: "none",
    define: { __ELECMAP_VERSION__: JSON.stringify(version) },
    logLevel: "warning",
  };
}

/** Writes the playground (index.html, playground.js, playground.css) into `outdir`. */
export async function buildPlayground(outdir: string): Promise<void> {
  mkdirSync(outdir, { recursive: true });
  writeFileSync(join(outdir, "index.html"), HTML);
  await esbuild.build(options(outdir));
}

// `npm run playground`: local server with rebuild on change.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outdir = join(here, "..", "api", "playground");
  mkdirSync(outdir, { recursive: true });
  writeFileSync(join(outdir, "index.html"), HTML);
  const ctx = await esbuild.context({ ...options(outdir), minify: false });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: outdir, port: 5174 });
  console.log(`playground: http://localhost:${port}/`);
}

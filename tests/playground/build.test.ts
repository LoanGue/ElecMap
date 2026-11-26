import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPlayground } from "../../docs/playground/build";

// Builds into the OS temp directory: the repo tree is never written.
describe("playground build @smoke", () => {
  const outdir = join(mkdtempSync(join(tmpdir(), "elecmap-playground-")), "out");

  beforeAll(() => buildPlayground(outdir), 30_000);
  afterAll(() => rmSync(join(outdir, ".."), { recursive: true, force: true }));

  it("writes the page, the bundle and the style sheet", () => {
    for (const name of ["index.html", "playground.js", "playground.css"]) {
      expect(statSync(join(outdir, name)).size, name).toBeGreaterThan(0);
    }
  });

  it("links the bundle from the page", () => {
    const html = readFileSync(join(outdir, "index.html"), "utf8");
    expect(html).toContain('<script src="playground.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="playground.css">');
  });

  it("replaces the version placeholder", () => {
    const js = readFileSync(join(outdir, "playground.js"), "utf8");
    expect(js).not.toContain("__ELECMAP_VERSION__");
  });
});

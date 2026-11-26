import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../docs/playground/", import.meta.url));
const css = readFileSync(join(root, "style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `.ts` file under `dir`, subfolders included, so code moved out of main.ts stays scanned. */
function modules(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? modules(join(dir, e.name))
      : e.name.endsWith(".ts")
        ? [join(dir, e.name)]
        : [],
  );
}
const files = modules(root);
const source = files.map((f) => readFileSync(f, "utf8")).join("\n");

/** Rules outside any @media block, as [selector, declarations]. */
function topLevelRules(text: string): [string, string][] {
  const rules: [string, string][] = [];
  let depth = 0;
  let start = 0;
  let selector = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) selector = text.slice(start, i).trim();
      depth++;
      start = i + 1;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        if (!selector.startsWith("@")) rules.push([selector, text.slice(start, i)]);
        start = i + 1;
      }
    } else if (text[i] === ";" && depth === 0) start = i + 1;
  }
  return rules;
}

/** Selectors (#id and .class) of every element the playground toggles with `hidden`. */
function toggled(): string[] {
  const out = new Set<string>();
  for (const [, target] of source.matchAll(/\$\("([#.][\w-]+)"\)\.hidden\s*=/g)) {
    out.add(target as string);
    const id = (target as string).slice(1);
    const tag = source.match(new RegExp(`id="${id}"[^>]*class="([^"]+)"`));
    for (const c of tag?.[1]?.split(/\s+/) ?? []) out.add(`.${c}`);
  }
  return [...out];
}

describe("playground style sheet", () => {
  const rules = topLevelRules(css);
  const shows = (decls: string) => /display:\s*(?!none)[\w-]+/.test(decls);
  const hides = (decls: string) => /display:\s*none/.test(decls);

  it("scans every playground module", () => {
    expect(files.some((f) => f.endsWith("main.ts"))).toBe(true);
    expect(files.length).toBeGreaterThan(1);
  });

  it("hides every toggled element whose own rule sets a display", () => {
    const missing = toggled().filter((sel) => {
      const own = rules.some(([s, d]) => s.split(",").some((x) => x.trim() === sel) && shows(d));
      const hidden = rules.some(
        ([s, d]) => s.split(",").some((x) => x.trim() === `${sel}[hidden]`) && hides(d),
      );
      return own && !hidden;
    });
    expect(missing).toEqual([]);
    expect(toggled()).toContain(".pg-schematic");
  });

  it("keeps the side panel open on narrow screens", () => {
    expect(css).toMatch(/\.pg-side\[hidden\]\s*\{\s*display:\s*flex/);
    expect(css).not.toMatch(/\[hidden\][^{]*\{[^}]*!important/);
  });
});

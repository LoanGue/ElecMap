import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../docs/playground/style.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

describe("playground style sheet", () => {
  it("lets the hidden attribute override every display rule", () => {
    expect(css).toMatch(/^\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/m);
  });
});

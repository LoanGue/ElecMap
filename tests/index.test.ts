import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index";

describe("package entry", () => {
  it("exposes the version of package.json", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});

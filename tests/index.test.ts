import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index";

describe("package entry", () => {
  it("exposes a version string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

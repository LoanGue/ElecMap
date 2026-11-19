import { describe, expect, it, vi } from "vitest";

describe("examples", () => {
  it("rc-lowpass runs", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    await import("../examples/rc-lowpass");
    spy.mockRestore();
    expect(lines[0]).toBe(String.raw`H(s) = \frac{1}{1 + 10^{-4}\,s}`);
    expect(lines.join("\n")).toContain("type: lowpass | fc = 1591.5 Hz");
  }, 30_000); // the import compiles the whole source tree
});

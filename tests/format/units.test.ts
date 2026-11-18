import { describe, expect, it } from "vitest";
import { formatSI, formatSpice, parseValue } from "../../src/format/units";

describe("parseValue", () => {
  it.each([
    ["1k", 1e3],
    ["4.7u", 4.7e-6],
    ["100nF", 100e-9],
    ["1e-3", 1e-3],
    ["2MEG", 2e6],
    ["2meg", 2e6],
    ["10m", 10e-3],
    ["1mH", 1e-3],
    ["5pF", 5e-12],
    ["3f", 3e-15],
    ["1G", 1e9],
    ["1T", 1e12],
    ["10µ", 10e-6],
    ["-5", -5],
    [".5", 0.5],
    ["1kohm", 1e3],
    ["100Ω", 100],
    ["1000Hz", 1000],
    ["4k7", 4700],
    ["1R5", 1.5],
    ["2u2", 2.2e-6],
    ["1mil", 25.4e-6],
  ])("parses %s", (text, expected) => {
    expect(parseValue(text)).toBeCloseTo(expected, 20);
    expect((parseValue(text) as number) / expected).toBeCloseTo(1, 12);
  });

  it.each(["", "abc", "1..2", "k1"])("rejects %j", (text) => {
    expect(parseValue(text)).toBeUndefined();
  });
});

describe("formatSI", () => {
  it("formats with SI prefixes", () => {
    expect(formatSI(4700, "Ω")).toBe("4.7 kΩ");
    expect(formatSI(1e-7, "F")).toBe("100 nF");
    expect(formatSI(0.001, "H")).toBe("1 mH");
    expect(formatSI(1, "V")).toBe("1 V");
    expect(formatSI(0, "A")).toBe("0 A");
    expect(formatSI(-2.2e6, "Hz")).toBe("-2.2 MHz");
    expect(formatSI(1e-18, "F")).toBe("0.001 fF");
  });
});

describe("formatSpice", () => {
  it.each([4700, 1e6, 1e-7, 3.3e-12, 1, 0, -15e3, 2.2e9])("round-trips %d", (v) => {
    const back = parseValue(formatSpice(v)) as number;
    expect(back === v || Math.abs(back / v - 1) < 1e-12).toBe(true);
  });

  it("uses meg for mega", () => {
    expect(formatSpice(1e6)).toBe("1meg");
    expect(formatSpice(4700)).toBe("4.7k");
  });
});

import { describe, expect, it } from "vitest";
import { Complex, ElecMapError } from "../../src";
import {
  attempt,
  complexText,
  esc,
  message,
  option,
  parseNumber,
  si,
  spice,
  texName,
} from "../../docs/playground/format";

describe("playground format helpers", () => {
  it("spice writes SPICE-style numbers", () => {
    expect(spice(0.002)).toBe("2m");
    expect(spice(1e6)).toBe("1meg");
    expect(spice(-4700)).toBe("-4.7k");
    expect(spice(0)).toBe("0");
  });

  it("parseNumber reads SPICE suffixes", () => {
    expect(parseNumber("10meg")).toBe(1e7);
    expect(parseNumber("2m")).toBe(0.002);
    expect(parseNumber("1.5k")).toBe(1500);
    expect(parseNumber("3e-6")).toBe(3e-6);
    expect(parseNumber("4.7µ")).toBeCloseTo(4.7e-6, 18);
    expect(parseNumber("10M")).toBe(0.01);
    expect(parseNumber("")).toBeUndefined();
    expect(parseNumber("abc")).toBeUndefined();
  });

  it("si formats finite values and names the infinite ones", () => {
    expect(si(1500, "Hz")).toBe("1.5 kHz");
    expect([si(Infinity, "Ω"), si(-Infinity, "Ω"), si(NaN, "Ω")]).toEqual(["∞", "−∞", "—"]);
  });

  it("complexText drops a negligible imaginary part", () => {
    expect(complexText(new Complex(1000, 0), "Ω")).toBe("1 kΩ");
    expect(complexText(new Complex(1000, -2000), "Ω")).toBe("1 k − j2 k Ω");
    expect(complexText(new Complex(1, 2))).toBe("1 + j2");
  });

  it("esc escapes HTML special characters", () => {
    expect(esc(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });

  it("message joins ElecMapError issues and falls back to the text", () => {
    const issues = [{ message: "a" }, {}, { message: "b" }];
    expect(message(new ElecMapError("PARSE_ERROR", "top", { issues }))).toBe("a\nb");
    expect(message(new ElecMapError("PARSE_ERROR", "top"))).toBe("top");
    expect(message(new Error("boom"))).toBe("boom");
    expect(message(42)).toBe("42");
  });

  it("option escapes and marks the current value", () => {
    expect(option('a"b', "<L>", 'a"b')).toBe(
      '<option value="a&quot;b" selected>&lt;L&gt;</option>',
    );
    expect(option("x", "X", "y")).toBe('<option value="x">X</option>');
  });

  it("texName escapes LaTeX specials", () => {
    expect(texName("v_out#1")).toBe(String.raw`\mathrm{v\_out\#1}`);
  });

  it("attempt returns undefined when the call throws", () => {
    expect(attempt(() => 3)).toBe(3);
    expect(
      attempt(() => {
        throw new Error("no");
      }),
    ).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { CIRCUIT_FORMATS, ElecMap, compile } from "../../src";
import { detectFormat, readCircuit, writeCircuit } from "../../src/format/exchange";

const net = `V1 in 0 DC 5 AC 1
R1 in out 1k
C1 out 0 100n
Q1 c out 0 QM
RC in c 2.2k
.model QM NPN(BF=150)`;

describe("circuit exchange formats", () => {
  const c = new ElecMap(net);

  it("lists its formats", () => {
    expect(CIRCUIT_FORMATS).toEqual(["json", "netlist", "base64"]);
  });

  it("round-trips through every format", () => {
    for (const format of CIRCUIT_FORMATS) {
      const copy = new ElecMap(c.export(format), { format });
      expect(copy.toJSON()).toEqual(c.toJSON());
      // Detection gives the same result without the format.
      expect(new ElecMap(c.export(format)).toJSON()).toEqual(c.toJSON());
    }
  });

  it("exports JSON as a detached document", () => {
    const doc = c.export("json");
    doc.components.pop();
    expect(c.toJSON().components).toHaveLength(5);
  });

  it("exports a netlist with model cards", () => {
    expect(c.export("netlist")).toBe(c.toSpice());
  });

  it("exports URL-safe base64 of the compact JSON", () => {
    const token = c.export("base64");
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    const std = token.replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(std + "=".repeat((4 - (std.length % 4)) % 4)), (ch) => ch.charCodeAt(0)),
    );
    expect(JSON.parse(json)).toEqual(c.toJSON());
  });

  it("keeps non-ASCII text through base64", () => {
    const doc = c.toJSON();
    doc.title = "Résistance Ω µ ⏚";
    const token = writeCircuit(doc, "base64");
    expect(readCircuit(token).doc).toEqual(doc);
  });

  it("also reads standard base64 with padding", () => {
    const doc = { version: 1, components: [] };
    const std = btoa(JSON.stringify(doc));
    expect(std).toMatch(/[+/=]|^[A-Za-z0-9]+$/);
    expect(readCircuit(std, "base64").doc).toEqual(doc);
  });

  it("detects the format of an input", () => {
    expect(detectFormat(c.toJSON())).toBe("json");
    expect(detectFormat('  {"version":1}')).toBe("json");
    expect(detectFormat(c.export("base64"))).toBe("base64");
    expect(detectFormat("V1 a 0 1")).toBe("netlist");
    expect(detectFormat(net)).toBe("netlist");
  });

  it("solves a circuit read from base64 like the original", () => {
    const copy = new ElecMap(c.export("base64"));
    expect(copy.voltage("c")).toBe(c.voltage("c"));
  });

  it("reports bad inputs", () => {
    expect(() => new ElecMap("not*base64!", { format: "base64" })).toThrow(
      expect.objectContaining({ code: "PARSE_ERROR" }),
    );
    expect(() => new ElecMap(btoa("nope"), { format: "base64" })).toThrow(/Invalid JSON/);
    expect(() => new ElecMap(c.toJSON(), { format: "netlist" })).toThrow(
      expect.objectContaining({ code: "INVALID_ARGUMENT" }),
    );
    expect(() => c.export("xml" as "json")).toThrow(/Unknown circuit format "xml"/);
    expect(() => compile(net, { format: "yaml" as "json" })).toThrow(
      expect.objectContaining({ code: "INVALID_ARGUMENT" }),
    );
  });
});

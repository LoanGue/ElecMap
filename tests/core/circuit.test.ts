import { describe, expect, it } from "vitest";
import { compile } from "../../src/core/circuit";
import { ElecMapError } from "../../src/core/errors";
import type { CircuitJSON } from "../../src/format/types";

const RC = `RC low-pass
V1 in 0 AC 1
R1 in out 1k
C1 out gnd 100n
`;

describe("compile", () => {
  it("compiles a SPICE netlist", () => {
    const c = compile(RC);
    expect(c.title).toBe("RC low-pass");
    expect(c.ground).toBe("0");
    expect(c.nodes).toEqual(["in", "out"]);
    expect(c.nodeIndex("in")).toBe(0);
    expect(c.nodeIndex("out")).toBe(1);
    expect(c.nodeIndex("0")).toBe(-1);
    expect(c.nodeIndex("gnd")).toBe(-1);
    expect(c.hasNode("GND")).toBe(true);
    expect(c.nodeCount).toBe(2);
    expect(c.warnings).toEqual([]);
  });

  it("rewrites ground aliases", () => {
    expect(compile(RC).component("C1")).toMatchObject({ nodes: ["out", "0"] });
  });

  it("compiles JSON text and objects identically", () => {
    const json = compile(RC).toJSON();
    expect(compile(JSON.stringify(json)).toJSON()).toEqual(json);
    expect(compile(json).toJSON()).toEqual(json);
    expect(json.version).toBe(1);
  });

  it("round-trips through SPICE", () => {
    const c = compile(RC);
    expect(compile(c.toSpice()).toJSON()).toEqual(c.toJSON());
  });

  it("freezes its document but returns mutable copies", () => {
    const c = compile(RC);
    expect(Object.isFrozen(c.document)).toBe(true);
    expect(Object.isFrozen(c.components[0])).toBe(true);
    const copy = c.toJSON();
    copy.components.pop();
    expect(c.components).toHaveLength(3);
  });

  it("does not mutate its input", () => {
    const doc: CircuitJSON = {
      version: 1,
      components: [
        { id: "V1", type: "vsource", nodes: ["a", "GND"], dc: 1 },
        { id: "R1", type: "resistor", nodes: ["a", "GND"], value: 1 },
      ],
    };
    compile(doc);
    expect(doc.components[0]).toMatchObject({ nodes: ["a", "GND"] });
  });

  it("supports a custom ground", () => {
    const c = compile("V1 a ref 1\nR1 a ref 1k", { ground: "ref" });
    expect(c.nodes).toEqual(["a"]);
    expect(c.toJSON().ground).toBe("ref");
  });

  it("exposes warnings and parser remarks", () => {
    const c = compile("V1 a 0 1\nC1 a b 1u\nC2 b 0 1u\n.op");
    expect(c.warnings.map((w) => w.code)).toEqual(["NO_DC_PATH"]);
    expect(c.parserWarnings).toHaveLength(1);
  });

  it("throws INVALID_CIRCUIT with all issues", () => {
    try {
      compile("R1 a b 1k\nR2 a b 1k");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ElecMapError);
      const err = e as ElecMapError;
      expect(err.code).toBe("INVALID_CIRCUIT");
      expect((err.details?.["issues"] as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it("throws PARSE_ERROR on invalid JSON", () => {
    expect(() => compile("{ not json")).toThrowError(/Invalid JSON/);
  });

  it("rejects newer format versions", () => {
    expect(() =>
      compile({
        version: 99,
        components: [{ id: "R1", type: "resistor", nodes: ["a", "0"], value: 1 }],
      }),
    ).toThrowError(/newer/);
  });

  it("looks up components and nodes", () => {
    const c = compile(RC);
    expect(c.hasComponent("R1")).toBe(true);
    expect(() => c.component("R9")).toThrowError(/Unknown component/);
    expect(() => c.nodeIndex("zz")).toThrowError(/Unknown node/);
  });
});

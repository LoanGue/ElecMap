import { describe, expect, it } from "vitest";
import { parseSpice } from "../../src/format/spice";
import { validateCircuit } from "../../src/format/validate";

const issues = (src: string) => validateCircuit(parseSpice(src, { titleLine: false }).circuit);
const codes = (src: string) => issues(src).map((i) => `${i.severity}:${i.code}`);

describe("validateCircuit", () => {
  it("accepts a valid RC circuit", () => {
    expect(issues("V1 in 0 AC 1\nR1 in out 1k\nC1 out 0 100n")).toEqual([]);
  });

  it("accepts gnd / GND as ground aliases", () => {
    expect(issues("V1 in gnd 1\nR1 in GND 1k")).toEqual([]);
  });

  it("rejects malformed documents", () => {
    expect(validateCircuit(null)[0]?.code).toBe("MALFORMED");
    expect(validateCircuit({ components: [] })[0]?.code).toBe("EMPTY_CIRCUIT");
    expect(validateCircuit({ components: [42] })[0]?.code).toBe("MALFORMED");
    expect(validateCircuit({ components: [{ id: "Q1", type: "bjt" }] })[0]?.code).toBe(
      "UNKNOWN_TYPE",
    );
    expect(
      validateCircuit({ components: [{ id: "R1", type: "resistor", nodes: ["a"], value: 1 }] })[0]
        ?.code,
    ).toBe("INVALID_NODES");
    expect(
      validateCircuit({
        components: [{ id: "R1", type: "resistor", nodes: ["a", "0"], value: -1 }],
      })[0],
    ).toMatchObject({
      code: "INVALID_VALUE",
      componentId: "R1",
    });
    expect(
      validateCircuit({ components: [{ id: "R1", type: "resistor", nodes: ["a", "0"] }] })[0]?.code,
    ).toBe("INVALID_VALUE");
    expect(
      validateCircuit({
        components: [{ id: "K1", type: "coupling", inductors: ["L1"], k: 0.5 }],
      })[0]?.code,
    ).toBe("MALFORMED");
    expect(
      validateCircuit({
        components: [{ id: "V1", type: "vsource", nodes: ["a", "0"], ac: { mag: "1" } }],
      })[0]?.code,
    ).toBe("INVALID_VALUE");
  });

  it("detects duplicate ids", () => {
    expect(codes("R1 a 0 1k\nR1 a 0 2k")).toContain("error:DUPLICATE_ID");
  });

  it("detects a missing ground", () => {
    expect(codes("R1 a b 1k\nR2 a b 1k")).toEqual(["error:NO_GROUND"]);
  });

  it("detects floating nodes", () => {
    expect(codes("V1 a 0 1\nR1 a 0 1k\nR2 x y 1k\nR3 x y 1k")).toEqual([
      "error:FLOATING_NODE",
      "error:FLOATING_NODE",
    ]);
  });

  it("warns about nodes without DC path (series capacitor)", () => {
    expect(codes("V1 a 0 1\nC1 a b 1u\nC2 b 0 1u")).toEqual(["warning:NO_DC_PATH"]);
  });

  it("detects voltage-source loops", () => {
    expect(codes("V1 a 0 1\nV2 a 0 2\nR1 a 0 1k")).toContain("error:VOLTAGE_SOURCE_LOOP");
    expect(codes("V1 a 0 1\nS1 a 0 ON\nR1 a 0 1")).toContain("error:VOLTAGE_SOURCE_LOOP");
    expect(codes("V1 a 0 1\nS1 a 0 ON RON=1\nR1 a 0 1")).not.toContain("error:VOLTAGE_SOURCE_LOOP");
  });

  it("warns about inductor loops", () => {
    expect(codes("V1 a 0 1\nL1 a 0 1m")).toContain("warning:INDUCTOR_LOOP");
  });

  it("warns about dangling nodes and shorted components", () => {
    expect(codes("V1 a 0 1\nR1 a 0 1k\nR2 a x 1k")).toContain("warning:DANGLING_NODE");
    expect(codes("V1 a 0 1\nR1 a 0 1k\nR2 a a 1k")).toContain("warning:SHORTED_COMPONENT");
  });

  it("checks references of controlled sources and couplings", () => {
    expect(codes("V1 a 0 1\nR1 a 0 1\nF1 a 0 Vx 2")).toContain("error:UNKNOWN_REFERENCE");
    expect(codes("V1 a 0 1\nR1 a 0 1\nF1 a 0 R1 2")).toContain("error:UNKNOWN_REFERENCE");
    expect(codes("V1 a 0 1\nR1 a 0 1\nF1 a 0 V1 2")).not.toContain("error:UNKNOWN_REFERENCE");
    expect(codes("V1 a 0 1\nL1 a b 1m\nR1 b 0 1\nK1 L1 R1 0.5")).toContain(
      "error:UNKNOWN_REFERENCE",
    );
    expect(codes("V1 a 0 1\nL1 a b 1m\nR1 b 0 1\nK1 L1 L1 0.5")).toContain(
      "error:UNKNOWN_REFERENCE",
    );
    expect(codes("V1 a 0 1\nR1 a 0 1\nE1 b 0 zz 0 2\nR2 b 0 1")).toContain(
      "error:UNKNOWN_REFERENCE",
    );
  });

  it("treats the op-amp output as driven from ground", () => {
    // Non-inverting amplifier: no floating node.
    expect(issues("V1 in 0 1\nXU1 in fb out OPAMP\nR1 out fb 9k\nR2 fb 0 1k")).toEqual([]);
  });

  it("supports a custom ground name", () => {
    const c = parseSpice("V1 a ref 1\nR1 a ref 1k", { titleLine: false }).circuit;
    expect(validateCircuit(c, "ref")).toEqual([]);
    expect(validateCircuit(c)[0]?.code).toBe("NO_GROUND");
  });
});

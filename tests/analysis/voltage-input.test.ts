import { describe, expect, it } from "vitest";
import { ElecMap } from "../../src";

describe("transfer function between two voltages", () => {
  it("divides out the source path: an RC after a resistor still gives 1/(1+RCs)", () => {
    const c = ElecMap.fromSpice("V1 s 0 AC 1\nR0 s in 470\nR1 in out 1k\nC1 out 0 100n\n");
    const H = c.transferFunction({ input: { voltage: "in" }, output: "out" });
    expect(H.toString()).toMatch(/^V\(out\)\/V\(in\)/);
    expect(H.dcGain()).toBeCloseTo(1, 9);
    expect(H.cutoffFrequency()).toBeCloseTo(1 / (2 * Math.PI * 1e3 * 100e-9), 3);
    expect(H.poles()).toHaveLength(1);
  });

  it("gives the gain of an op-amp stage from its input node", () => {
    const c = ElecMap.fromSpice(
      "V1 n1 0 DC 5 AC 1\nR3 in n1 1k\nX1 n2 in out OPAMP\nR2 n2 out 1k\nR1 n2 0 1k\nR4 out 0 1k\n",
    );
    expect(c.transferFunction({ input: { voltage: "in" }, output: "out" }).dcGain()).toBeCloseTo(
      2,
      9,
    );
  });

  it("accepts a differential input and drives from the source it is given", () => {
    // Two AC sources, both reaching b: the one given decides which ratio is measured.
    const net = "V1 a 0 AC 1\nV2 x 0 AC 1\nR1 a b 1k\nR2 b 0 1k\nR3 x b 3k";
    const c = ElecMap.fromSpice(net);
    const H1 = c.transferFunction({ input: { voltage: ["a", "b"], source: "V1" }, output: "b" });
    // V1 alone: b = a·(R2‖R3)/(R1 + R2‖R3) = 3/7·a, so V(b)/V(a,b) = 3/4.
    expect(H1.dcGain()).toBeCloseTo(3 / 4, 9);
    const H2 = c.transferFunction({ input: { voltage: "b", source: "V2" }, output: "x" });
    // V2 alone: b = x·(R1‖R2)/(R3 + R1‖R2) = x/7.
    expect(H2.dcGain()).toBeCloseTo(7, 9);
    expect(() => c.transferFunction({ input: { voltage: "b" }, output: "x" })).toThrow(/input/);
  });

  it("cancels repeated poles shared by both voltages", () => {
    // Three identical RC stages, each buffered by a unity-gain VCVS.
    const net = [
      "V1 s 0 AC 1",
      "R1 s a 1k",
      "C1 a 0 100n",
      "E1 a1 0 a 0 1",
      "R2 a1 b 1k",
      "C2 b 0 100n",
      "E2 b1 0 b 0 1",
      "R3 b1 c 1k",
      "C3 c 0 100n",
      "E3 c1 0 c 0 1",
      "R4 c1 out 1k",
      "C4 out 0 100n",
    ].join("\n");
    const c = ElecMap.fromSpice(net);
    const last = c.transferFunction({ input: { voltage: "c" }, output: "out" });
    expect(last.order).toBe(1);
    expect(last.cutoffFrequency()).toBeCloseTo(1 / (2 * Math.PI * 1e-4), 1);
    expect(last.dcGain()).toBeCloseTo(1, 4);
    const three = c.transferFunction({ input: { voltage: "a" }, output: "out" });
    expect(three.order).toBe(3);
    // A quadruple pole is only known to about 1e-4 (root spread of an ill-conditioned
    // polynomial), so the gain cannot be tighter than that.
    expect(three.dcGain()).toBeCloseTo(1, 4);
  });

  it("picks the source by itself when sources in series all give the same ratio", () => {
    // Two harmonics in series build ve; V3 feeds an unrelated branch and never reaches ve.
    const net = [
      "V1 ve m SIN(0 1 1k) AC 1",
      "V2 m 0 SIN(0 0.33 3k) AC 1",
      "V3 z 0 DC 5 AC 1",
      "R1 ve out 1k",
      "C1 out 0 1u",
      "R2 z 0 1k",
    ].join("\n");
    const H = ElecMap.fromSpice(net).transferFunction({ input: { voltage: "ve" }, output: "out" });
    expect(H.dcGain()).toBeCloseTo(1, 9);
    expect(H.cutoffFrequency()).toBeCloseTo(1 / (2 * Math.PI * 1e-3), 3);
  });

  it("names the sources when the ratio depends on which one drives", () => {
    const c = ElecMap.fromSpice("V1 a 0 AC 1\nV2 x 0 AC 1\nR1 a b 1k\nR2 b 0 1k\nR3 x b 3k");
    expect(() => c.transferFunction({ input: { voltage: "b" }, output: "x" })).toThrow(
      /depends on which source drives \(V1, V2\)/,
    );
  });

  it("refuses a voltage the source does not reach", () => {
    const c = ElecMap.fromSpice("V1 a 0 AC 1\nR1 a out 1k\nR2 out 0 1k\nR3 z 0 1k\n");
    expect(() => c.transferFunction({ input: { voltage: "z" }, output: "out" })).toThrow(
      /does not depend on V1/,
    );
  });
});

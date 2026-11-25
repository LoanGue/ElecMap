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

  it("accepts a differential input and an explicit source", () => {
    const c = ElecMap.fromSpice("V1 a 0 AC 1\nV2 x 0 DC 1\nR1 a b 1k\nR2 b 0 1k\nR3 x 0 1k\n");
    const H = c.transferFunction({ input: { voltage: ["a", "b"], source: "V1" }, output: "b" });
    expect(H.dcGain()).toBeCloseTo(1, 9);
  });

  it("refuses a voltage the source does not reach", () => {
    const c = ElecMap.fromSpice("V1 a 0 AC 1\nR1 a out 1k\nR2 out 0 1k\nR3 z 0 1k\n");
    expect(() => c.transferFunction({ input: { voltage: "z" }, output: "out" })).toThrow(
      /does not depend on V1/,
    );
  });
});

import { describe, expect, it } from "vitest";
import { ElecMap } from "../../src";

const schmitt = (opamp: string) => `V1 n1 0 1
R3 in n1 1k
X1 n2 in out OPAMP ${opamp}
R2 n2 out 1k
R1 n2 0 1k`;

describe("positive-feedback warning", () => {
  it("flags an ideal op-amp in positive feedback, whose linear result looks stable", () => {
    const c = new ElecMap(schmitt(""));
    expect(c.transferFunction("out").dcGain()).toBeCloseTo(2, 9);
    const [w, ...rest] = c.transferWarnings("out");
    expect(rest).toEqual([]);
    expect(w).toMatchObject({ severity: "warning", code: "POSITIVE_FEEDBACK", componentId: "X1" });
  });

  it("checks the linear loop even when the op-amp has rails", () => {
    const c = new ElecMap(schmitt("VSAT=15"));
    expect(c.transferWarnings({ input: "V1", output: "out" }).map((w) => w.code)).toEqual([
      "POSITIVE_FEEDBACK",
    ]);
  });

  it("stays quiet in negative feedback and without ideal op-amps", () => {
    // Same circuit with the inputs swapped: a non-inverting amplifier.
    const amp = new ElecMap("V1 p 0 1\nX1 p m out OPAMP\nR2 m out 1k\nR1 m 0 1k");
    expect(amp.transferWarnings("out")).toEqual([]);
    expect(new ElecMap(schmitt("GAIN=1e5")).transferWarnings("out")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { ElecMap, ElecMapError, MPoly, symbolicDeterminant } from "../../src";
import type { OutputSpec } from "../../src";

const RC = "V1 in 0 AC 1\nR1 in out 1k\nC1 out 0 100n";

describe("MPoly", () => {
  it("adds, multiplies and cancels", () => {
    const x = MPoly.variable(3, 1);
    const y = MPoly.variable(3, 2);
    const p = x.add(y).mul(x.sub(y)); // x² − y²
    expect(p.size).toBe(2);
    expect(p.evaluate([0, 3, 2])).toBe(5);
    expect(p.sub(x.mul(x)).add(y.mul(y)).isZero()).toBe(true);
    expect(p.degreeIn(1)).toBe(2);
    expect(MPoly.variable(3, 0).mul(x).coefficientsIn(0)).toHaveLength(2);
  });

  it("computes exact determinants by expansion", () => {
    const k = (c: number) => MPoly.constant(2, c);
    const a = MPoly.variable(2, 1);
    // det [[a, 1, 0], [1, a, 1], [0, 1, a]] = a³ − 2a
    const det = symbolicDeterminant(
      [
        [a, k(1), k(0)],
        [k(1), a, k(1)],
        [k(0), k(1), a],
      ],
      2,
    );
    expect(det.evaluate([0, 2])).toBe(4);
    expect(det.evaluate([0, 3])).toBe(21);
  });
});

describe("symbolic transfer functions", () => {
  const cases: [string, string, OutputSpec, string][] = [
    ["RC low-pass", RC, "out", "\\frac{1}{1 + R_{1} C_{1} s}"],
    ["divider", "V1 in 0 1\nR1 in out 1k\nR2 out 0 3k", "out", "\\frac{R_{2}}{R_{1} + R_{2}}"],
    [
      "RLC",
      "V1 in 0 AC 1\nR1 in a 50\nL1 a out 10m\nC1 out 0 1u",
      "out",
      "\\frac{1}{1 + R_{1} C_{1} s + L_{1} C_{1} s^{2}}",
    ],
    [
      "inverting amplifier",
      "V1 in 0 AC 1\nR1 in n 1k\nRf n out 10k\nX1 0 n out OPAMP",
      "out",
      "-\\frac{R_{f}}{R_{1}}",
    ],
    [
      "non-inverting amplifier",
      "V1 in 0 AC 1\nX1 in n out OPAMP\nR1 n 0 1k\nRf n out 9k",
      "out",
      "\\frac{R_{1} + R_{f}}{R_{1}}",
    ],
    [
      "Sallen-Key",
      "V1 in 0 AC 1\nR1 in a 10k\nR2 a b 10k\nC1 a out 10n\nC2 b 0 10n\nX1 b out out OPAMP",
      "out",
      "\\frac{1}{1 + C_{2} \\left(R_{1} + R_{2}\\right) s + R_{1} R_{2} C_{1} C_{2} s^{2}}",
    ],
    [
      "transformer",
      "V1 in 0 AC 1\nR1 in p 10\nL1 p 0 10m\nL2 s 0 40m\nK1 L1 L2 0.99\nRL s 0 100",
      "s",
      "\\frac{R_{L} M_{K1} s}{R_{1} R_{L} + \\left(R_{1} L_{2} + R_{L} L_{1}\\right) s + \\left(L_{1} L_{2} - M_{K1}^{2}\\right) s^{2}}",
    ],
  ];
  for (const [name, netlist, output, latex] of cases) {
    it(`derives the ${name}`, () => {
      const c = new ElecMap(netlist);
      const H = c.symbolicTransferFunction(output);
      expect(H.toLatex()).toBe(latex);
      // Substituting the values gives back the numeric transfer function.
      for (const f of [10, 1234, 1e5]) {
        const a = H.substitute().evaluate(f);
        const b = c.transferFunction(output).evaluate(f);
        expect(a.sub(b).abs()).toBeLessThan(1e-9 * Math.max(1, b.abs()));
      }
    });
  }

  it("matches the numeric engine on circuits with every component type", () => {
    const netlists: [string, OutputSpec][] = [
      ["V1 in 0 1\nR1 in c 1k\nE1 a 0 c 0 10\nR2 a out 1k\nF1 out 0 V1 2\nR3 out 0 1k", "out"],
      ["V1 in 0 1\nR1 in a 1k\nG1 0 out a 0 2m\nR2 out 0 3k\nC1 out 0 1u", "out"],
      ["V1 in 0 1\nR1 in a 1k\nH1 out 0 V1 500\nR2 out 0 1k\nL1 a 0 1m", "out"],
      ["V1 in 0 AC 1\nR1 in n 1k\nRf n out 10k\nX1 0 n out OPAMP GAIN=1e4 GBW=1meg", "out"],
      ["I1 0 a 1m\nR1 a b 1k\nC1 b 0 1u\nS1 a b ON RON=10\nR2 a 0 2k", ["a", "b"]],
      ["V1 in 0 1\nR1 in a 1k\nC1 a 0 1u\nR2 a 0 2k", { current: "C1" }],
      ["I1 0 a 1\nR1 a 0 1k\nC1 a 0 1u", { current: "I1" }],
    ];
    for (const [netlist, output] of netlists) {
      const c = new ElecMap(netlist);
      const S = c.symbolicTransferFunction(output);
      for (const f of [3, 300, 3e4]) {
        const a = S.substitute().evaluate(f);
        const b = c.transferFunction(output).evaluate(f);
        expect(a.sub(b).abs(), netlist).toBeLessThan(1e-9 * Math.max(1, b.abs()));
      }
    }
  });

  it("keeps only the requested symbols literal", () => {
    const H = new ElecMap(RC).symbolicTransferFunction({ output: "out", symbols: ["C1"] });
    expect(H.symbols.map((s) => s.id)).toEqual(["C1"]);
    expect(H.toLatex()).toBe("\\frac{1}{1 + 1000 C_{1} s}");
  });

  it("substitutes new values", () => {
    const H = new ElecMap(RC).symbolicTransferFunction("out");
    const tf = H.substitute({ R1: 2000 });
    expect(tf.cutoffFrequency()).toBeCloseTo(1 / (2 * Math.PI * 2000 * 100e-9), 6);
    expect(() => H.substitute({ R9: 1 })).toThrow(ElecMapError);
  });

  it("formats names, order and text", () => {
    const H = new ElecMap(RC).symbolicTransferFunction({
      output: "out",
      names: { R1: "R", C1: "C" },
    });
    expect(H.toLatex({ name: "H(s)", order: "descending" })).toBe("H(s) = \\frac{1}{R C s + 1}");
    expect(H.toString()).toBe("V(out)/V1 = (1) / (1 + s*R1*C1)");
    expect(H.order).toBe(1);
    expect(H.denominatorCoefficients).toHaveLength(2);
  });

  it("derives literal impedances", () => {
    const c = new ElecMap("V1 in 0 1\nR1 in out 1k\nC1 out 0 1u\nR2 out 0 2k");
    const Z = c.symbolicImpedance("out");
    expect(Z.toLatex()).toBe("\\frac{R_{1} R_{2}}{R_{1} + R_{2} + R_{1} R_{2} C_{1} s}");
    const a = Z.substitute().evaluate(500);
    const b = c.impedance("out").evaluate(500);
    expect(a.sub(b).abs()).toBeLessThan(1e-9 * b.abs());
  });

  it("rejects unknown symbols", () => {
    expect(() =>
      new ElecMap(RC).symbolicTransferFunction({ output: "out", symbols: ["X9"] }),
    ).toThrow(ElecMapError);
  });
});

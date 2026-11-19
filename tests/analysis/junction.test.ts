import { describe, expect, it } from "vitest";
import { ElecMap, parseSpice } from "../../src";
import { depletionCharge } from "../../src/mna/devices";

describe("depletion charge", () => {
  it("integrates C(v) = cj0 / (1 − v/vj)^m and continues it linearly above fc·vj", () => {
    const at = (v: number) => depletionCharge(v, 1e-12, 0.8, 0.4, 0.5);
    for (const v of [-5, -1, 0, 0.2, 0.39, 0.41, 0.7, 1.5]) {
      const h = 1e-6;
      const numeric = (at(v + h).q - at(v - h).q) / (2 * h);
      expect(at(v).c / numeric).toBeCloseTo(1, 6);
    }
    expect(at(0)).toEqual({ q: 0, c: 1e-12 });
    expect(at(-2).c).toBeCloseTo(1e-12 / Math.pow(1 + 2 / 0.8, 0.4), 20);
    // Continuous at fc·vj.
    expect(at(0.4 - 1e-12).q).toBeCloseTo(at(0.4 + 1e-12).q, 20);
    expect(at(0.4 - 1e-12).c / at(0.4 + 1e-12).c).toBeCloseTo(1, 9);
  });

  it("handles m = 1 and m = 0", () => {
    const log = depletionCharge(-1, 1e-12, 1, 1, 0.5);
    expect(log.q).toBeCloseTo(-1e-12 * Math.log(2), 20);
    expect(log.c).toBeCloseTo(0.5e-12, 20);
    expect(depletionCharge(-3, 2e-12, 1, 0, 0.5)).toEqual({ q: -6e-12, c: 2e-12 });
  });
});

describe("bias-dependent junction capacitance", { timeout: 60_000 }, () => {
  it("uses C(V) at the operating point in small-signal analyses", () => {
    const rev = new ElecMap(`
V1 in 0 DC -5 AC 1
R1 in a 10k
D1 a 0 DV
.model DV D(CJO=10p)
`);
    const c = 10e-12 / Math.sqrt(6);
    expect(
      (rev.transferFunction("a").cutoffFrequency() as number) / (1 / (2 * Math.PI * 10e3 * c)),
    ).toBeCloseTo(1, 6);
    // M = 0: the constant capacitance of a linear model.
    const flat = new ElecMap(`
V1 in 0 DC -5 AC 1
R1 in a 10k
D1 a 0 DV
.model DV D(CJO=10p M=0)
`);
    expect(
      (flat.transferFunction("a").cutoffFrequency() as number) / (1 / (2 * Math.PI * 1e-7)),
    ).toBeCloseTo(1, 6);
  });

  it("integrates the junction charge in transient analysis", () => {
    // 1 µA discharges the junction: Q(v) = 2·CJO·(1 − √(1 − v)) = −I·t.
    const chg = new ElecMap(`
I1 a 0 1u
D1 a 0 DV
.model DV D(CJO=1n)
`);
    const v = chg.transient({ tStop: 2e-3, tStep: 1e-5, initial: "ic" }).voltage("a");
    expect(v[100]).toBeCloseTo(-1.25, 3);
    expect(v[200]).toBeCloseTo(-3, 2);
  });

  it("counts the capacitive current in the diode current", () => {
    const chg = new ElecMap(`
I1 a 0 1u
D1 a 0 DV
.model DV D(CJO=1n)
`);
    const i = chg.transient({ tStop: 1e-3, tStep: 1e-5, initial: "ic" }).current("D1");
    expect(i[50]).toBeCloseTo(-1e-6, 10);
  });

  it("adds the diffusion capacitance TT·gd", () => {
    const fwd = new ElecMap(`
I1 0 a DC 1m AC 1
D1 a 0 DT
.model DT D(TT=10n)
`);
    const [pole] = fwd.transferFunction({ input: "I1", output: "a" }).poles();
    expect(pole?.re).toBeCloseTo(-1e8, -1);
  });

  it("shows the reverse recovery of a diode with transit time", () => {
    const sw = (tt: string) =>
      new ElecMap(`
V1 in 0 PULSE(5 -5 100n 1n 1n 1u 2u)
R1 in a 1k
D1 a 0 DS
.model DS D(IS=1e-14 TT=${tt})
`)
        .transient({ tStop: 300e-9, tStep: 0.5e-9 })
        .current("D1");
    const fast = sw("0");
    const slow = sw("50n");
    const at = (t: number) => Math.round(t / 0.5e-9);
    // Without transit time the diode blocks at once; with it, it conducts ≈ −5 mA
    // during the storage time TT·ln(1 + IF/IR) ≈ 31 ns.
    expect(fast[at(120e-9)]).toBeGreaterThan(-1e-6);
    expect(slow[at(120e-9)]).toBeCloseTo(-5.6e-3, 3);
    expect(slow[at(250e-9)]).toBeGreaterThan(-1e-4);
  });

  it("models the BJT base-emitter diffusion capacitance TF·gm", () => {
    const q = new ElecMap(`
VCC vcc 0 5
IB 0 b DC 10u AC 1
Q1 vcc b 0 QN
.model QN NPN(IS=1e-16 BF=100 TF=1n)
`);
    const [pole] = q.transferFunction({ input: "IB", output: "b" }).poles();
    // 1 / (rπ·TF·gm) = 1 / (β·TF)
    expect(pole?.re).toBeCloseTo(-1e7, -2);
  });

  it("keeps constant-capacitance results when M = 0", () => {
    const amp = (m: string) =>
      new ElecMap(`
VCC vcc 0 12
V1 in 0 AC 1
C1 in b 10u
RB1 vcc b 47k
RB2 b 0 10k
RC vcc c 2.2k
RE e 0 470
CE e 0 100u
Q1 c b e QN
.model QN NPN(IS=1e-14 BF=200 CJE=22p CJC=7p ${m})
`)
        .transferFunction("c")
        .evaluate(10e6)
        .abs();
    expect(amp("MJE=0 MJC=0")).not.toBeCloseTo(amp(""), 3);
    expect(amp("MJE=0 MJC=0")).toBeGreaterThan(0);
  });
});

describe("netlist parameters", () => {
  it("reads the capacitance and transit-time parameters and their aliases", () => {
    const { circuit, warnings } = parseSpice(`
D1 a 0 DX 2
Q1 c b 0 QX
V1 a 0 1
V2 c 0 1
V3 b 0 1
.model DX D(CJ0=1p PB=0.7 MJ=0.4 TT=5n FC=0.6)
.model QX PNP(CJE=1p PE=0.8 ME=0.3 CJC=2p PC=0.6 MC=0.5 TF=0.4n TR=10n FC=0.4)
`);
    expect(warnings).toEqual([]);
    expect(circuit.components[0]).toMatchObject({ cjo: 2e-12, vj: 0.7, m: 0.4, tt: 5e-9, fc: 0.6 });
    expect(circuit.components[1]).toMatchObject({
      cje: 1e-12,
      vje: 0.8,
      mje: 0.3,
      cjc: 2e-12,
      vjc: 0.6,
      mjc: 0.5,
      tf: 0.4e-9,
      tr: 10e-9,
      fc: 0.4,
    });
  });

  it("rejects FC outside [0, 1)", () => {
    expect(() => new ElecMap("D1 a 0 DX\nV1 a 0 1\n.model DX D(FC=1)")).toThrow(/fc.*\[0, 1\)/);
  });
});

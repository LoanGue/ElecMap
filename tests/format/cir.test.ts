import { describe, expect, it } from "vitest";
import { ElecMap } from "../../src";
import { EXAMPLES } from "../../docs/playground/examples";

/** Node voltages of the operating point, by original node name. */
const voltages = (c: ElecMap) => Object.fromEntries(c.nodes().map((n) => [n, c.voltage(n)]));

/** The `.cir` read back by ElecMap gives the same operating point. */
function sameOperatingPoint(netlist: string): string {
  const c = new ElecMap(netlist);
  const cir = c.toCir();
  const back = new ElecMap(cir);
  const v = voltages(c);
  for (const [n, x] of Object.entries(v)) {
    const name = n.replace(/[^A-Za-z0-9_]/g, "_");
    // Ideal op-amps become a gain of 10⁶.
    const err = Math.abs(back.voltage(name) - x);
    expect(
      err,
      `${n} in
${cir}`,
    ).toBeLessThan(1e-4 * Math.max(1, Math.abs(x)));
  }
  return cir;
}

describe("toCir", () => {
  it.each(EXAMPLES.map((e) => [e.id, e.netlist]))("round-trips the %s example", (_, netlist) => {
    const cir = sameOperatingPoint(netlist);
    expect(cir).not.toMatch(/OPAMP\b(?!_)|STEP\(| ON\b| OFF\b/);
    expect(cir.trimEnd().endsWith(".op\n.end")).toBe(true);
  });

  it("names elements after their type and keeps references", () => {
    const cir = sameOperatingPoint(`
.subckt BUF in out
R1 in out 1k
E1 x 0 in 0 2
R2 x 0 1k
.ends
V1 a 0 DC 2
Vs a b 0
X1 b c BUF
R9 c gnd 1k
F1 0 d Vs 2
R3 d 0 1k
B1 e 0 V=V(c)^2 + I(Vs)*1k
R4 e 0 1k
`);
    expect(cir).toContain("RX1_R1 b c 1k");
    expect(cir).toContain("EX1_E1 X1_x 0 b 0 2");
    expect(cir).toContain("R9 c 0 1k");
    expect(cir).toContain("F1 0 d Vs 2");
    expect(cir).toContain("B1 e 0 V=V(c)**2 + I(Vs)*1000");
  });

  it("translates op-amps, switches, steps and device parameters", () => {
    const cir = new ElecMap(`
V1 in 0 STEP(0 1 1m)
R1 in m 10k
R2 m out 100k
X1 0 m out OPAMP GAIN=1e5 GBW=1meg
S1 out o2 ON
S2 o2 o3 OFF
R5 o3 0 1k
S3 o2 0 OFF ROFF=1meg
D1 o2 k IS=1e-12
D2 k 0 IS=1e-12
D3 k 0 D1N4148
Q1 k o2 0 Q2N2222
M1 k o2 0 0 NMOS VTO=1 W=2u L=1u
.model D1N4148 D(IS=2.5n N=1.8)
.model Q2N2222 NPN(BF=200)
`).toCir({ analysis: [".tran 5m", ".ac dec 10 1 1meg"] });
    expect(cir).toContain("V1 in 0 PWL(0 0 1m 0 1.000001m 1)");
    expect(cir).toContain("\nX1 0 m out OPAMP_X1\n");
    expect(cir).toContain(".subckt OPAMP_X1 inp inn out");
    expect(cir).toContain("VS1 out o2 0");
    expect(cir).toContain("* S2: open switch, not connected");
    expect(cir).toContain("RS3 o2 0 1meg");
    expect(cir).toContain("D1 o2 k DMOD\nD2 k 0 DMOD\nD3 k 0 D1N4148");
    expect(cir).toContain(".model DMOD D(IS=1p)");
    expect(cir).toContain(".model D1N4148 D(IS=2.5n N=1.8)");
    expect(cir).toContain(".model Q2N2222 NPN(BF=200)");
    expect(cir).toContain("M1 k o2 0 0 NMOSMOD W=2u L=1u");
    expect(cir).toContain(".model NMOSMOD NMOS(VTO=1)");
    expect(cir).toContain(".tran 5m\n.ac dec 10 1 1meg\n.end");
  });

  it("writes the waveform before AC, as LTspice does", () => {
    const cir = new ElecMap("V1 in 0 DC 1 AC 2 90 SIN(0 1 1k)\nR1 in 0 1k").toCir();
    expect(cir).toContain("V1 in 0 DC 1 SIN(0 1 1k) AC 2 90\n");
    expect(new ElecMap(cir).toJSON().components[0]).toMatchObject({
      dc: 1,
      ac: { mag: 2, phase: 90 },
    });
  });

  it("keeps the single-pole op-amp response", () => {
    const src = "V1 in 0 AC 1\nR1 in m 1k\nR2 m out 9k\nX1 0 m out OPAMP GAIN=1e5 GBW=1meg";
    const a = new ElecMap(src).transferFunction({ input: "V1", output: "out" });
    const b = new ElecMap(new ElecMap(src).toCir()).transferFunction({
      input: "V1",
      output: "out",
    });
    for (const f of [10, 1e4, 1e5, 1e6])
      expect(b.evaluate(f).abs()).toBeCloseTo(a.evaluate(f).abs(), 6);
  });
});

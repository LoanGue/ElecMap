import { describe, expect, it } from "vitest";
import { ElecMap } from "../../src";

/** Inverting Schmitt trigger around a railed op-amp. */
const schmitt = (opamp: string) =>
  new ElecMap(`V1 n1 0 5
R3 in n1 1k
X1 n2 in out OPAMP ${opamp}
R2 n2 out 1k
R1 n2 0 1k`);

describe("op-amp rails: .cir and .asc exports", () => {
  it("writes a railed op-amp as a tanh subcircuit in .cir", () => {
    const cir = schmitt("VPOS=12 VNEG=-3 GBW=1Meg").toCir();
    expect(cir).toMatch(/B1 y 0 V=4\.5\+7\.5\*tanh\(133\.3\d*k\*\(V\(inp\)-V\(inn\)\)\)/);
    expect(cir).toMatch(/^X1 n2 in out OPAMP_X1$/m);
    // Pole at 2π·GBW/A with the ideal op-amp's A = 1e6: R = 1, C = A / (2π·GBW).
    expect(cir).toMatch(/^R1 y x 1$/m);
    expect(cir).toMatch(/^C1 x 0 159\.15\d*m$/m);
    expect(cir).toMatch(/^E1 out 0 x 0 1$/m);
  });

  it("writes an ideal railed op-amp without a pole", () => {
    const cir = schmitt("VSAT=15").toCir();
    expect(cir).toMatch(/B1 y 0 V=0\+15\*tanh\(66\.6\d*k\*\(V\(inp\)-V\(inn\)\)\)/);
    expect(cir).not.toMatch(/^C1 x 0 /m);
    expect(cir).not.toMatch(/^EX1 /m);
  });

  it("keeps the subcircuit in .asc instead of LTspice's rail-less opamp", () => {
    const asc = schmitt("VPOS=12 VNEG=-3 GBW=1Meg").toAsc();
    expect(asc).toMatch(/SYMATTR Value OPAMP_X1/);
    expect(asc).toMatch(/\.subckt OPAMP_X1/);
    expect(asc).not.toMatch(/opamp\.sub/);
  });
});

import { describe, expect, it } from "vitest";
import { displayName, nextId, rename, subscript } from "../../../docs/playground/edit/naming";
import { emptyDrawing } from "../../../docs/playground/model";
import type { Drawing, Part } from "../../../docs/playground/model";
import { toNetlist } from "../../../docs/playground/netlist";

const part = (id: string, kind: Part["kind"], x: number, value: string): Part => ({
  id,
  kind,
  x,
  y: 0,
  dir: "down",
  value,
});

/** A source, a capacitor and a resistor in parallel, each grounded. */
const circuit = (): Drawing => ({
  ...emptyDrawing(),
  parts: [
    part("V1", "vsource", 0, "DC 5"),
    part("C1", "capacitor", 4, "1u"),
    part("R1", "resistor", 8, "1k"),
  ],
  wires: [{ x1: 0, y1: 0, x2: 8, y2: 0 }],
  grounds: [
    { x: 0, y: 4 },
    { x: 4, y: 4 },
    { x: 8, y: 4 },
  ],
});

const lines = (d: Drawing): string[] => toNetlist(d).split("\n").slice(1, 4);

describe("subscript", () => {
  it("writes the digits after the letters as subscripts", () => {
    expect(subscript("C1")).toBe("C₁");
    expect(subscript("C12")).toBe("C₁₂");
    expect(subscript("Q0")).toBe("Q₀");
  });

  it("leaves text that is not letters then digits unchanged", () => {
    for (const id of ["R_load", "X1A", "12", "", "Rload"]) expect(subscript(id)).toBe(id);
  });
});

describe("displayName", () => {
  it("is the id with a subscript by default, the chosen name otherwise", () => {
    expect(displayName(part("C12", "capacitor", 0, "1u"))).toBe("C₁₂");
    expect(displayName({ ...part("C12", "capacitor", 0, "1u"), name: "Cin" })).toBe("Cin");
  });
});

describe("rename", () => {
  it("sets a trimmed display name and keeps the SPICE id", () => {
    const d = rename(circuit(), "C1", "  R_load ");
    const c = d.parts[1] as Part;
    expect(c.id).toBe("C1");
    expect(c.name).toBe("R_load");
    expect(displayName(c)).toBe("R_load");
  });

  it("goes back to the default name on empty or blank text", () => {
    const named = rename(circuit(), "C1", "Cin");
    for (const text of ["", "   "]) {
      const c = rename(named, "C1", text).parts[1] as Part;
      expect("name" in c).toBe(false);
      expect(displayName(c)).toBe("C₁");
    }
  });

  it("does not change the drawing it is given", () => {
    const d = circuit();
    rename(d, "C1", "Cin");
    expect(d.parts[1]).toEqual(part("C1", "capacitor", 4, "1u"));
  });

  it("allows the same display name on several parts", () => {
    const d = rename(rename(circuit(), "C1", "X"), "R1", "X");
    expect(d.parts.map(displayName)).toEqual(["V₁", "X", "X"]);
  });

  it("leaves the drawing as it was for an unknown id", () => {
    expect(rename(circuit(), "L9", "Lx")).toEqual(circuit());
  });
});

describe("netlist with display names", () => {
  it("still uses the SPICE ids", () => {
    const before = lines(circuit());
    expect(before).toEqual(["V1 n1 0 DC 5", "C1 n1 0 1u", "R1 n1 0 1k"]);
    expect(lines(rename(circuit(), "C1", "R_load"))).toEqual(before);
    expect(lines(rename(rename(circuit(), "C1", "R_load"), "R1", "R_load"))).toEqual(before);
  });
});

describe("nextId", () => {
  it("gives the first free number for the prefix", () => {
    expect(nextId(circuit(), "R")).toBe("R2");
    expect(nextId(circuit(), "L")).toBe("L1");
    expect(nextId(emptyDrawing(), "C")).toBe("C1");
  });

  it("compares ids without case", () => {
    const d = circuit();
    d.parts.push(part("r2", "resistor", 12, "1k"));
    expect(nextId(d, "R")).toBe("R3");
    expect(nextId(d, "r")).toBe("r3");
  });

  it("fills a gap left by a removed part", () => {
    const d = circuit();
    d.parts.push(part("R3", "resistor", 12, "1k"));
    expect(nextId(d, "R")).toBe("R2");
  });

  it("does not depend on display names", () => {
    expect(nextId(rename(circuit(), "C1", "R2"), "R")).toBe("R2");
  });
});

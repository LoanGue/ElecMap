import { describe, expect, it } from "vitest";
import { setName, setValue } from "../../../docs/playground/edit/properties";
import { emptyDrawing } from "../../../docs/playground/model";
import type { Drawing } from "../../../docs/playground/model";
import { toNetlist } from "../../../docs/playground/netlist";

/** Two grounded resistors in parallel, their top node carrying the label `in`. */
const circuit = (): Drawing => ({
  ...emptyDrawing(),
  parts: [
    { id: "R1", kind: "resistor", x: 0, y: 0, dir: "down", value: "1k" },
    { id: "R2", kind: "resistor", x: 4, y: 0, dir: "down", value: "10k" },
  ],
  wires: [{ x1: 0, y1: 0, x2: 4, y2: 0 }],
  grounds: [
    { x: 0, y: 4 },
    { x: 4, y: 4 },
  ],
  labels: [{ x: 0, y: 0, name: "in" }],
});

describe("setName", () => {
  it("changes the display name and keeps the SPICE id", () => {
    const d = circuit();
    const next = setName(d, "R1", " R_load ");
    expect(next.parts[0]).toEqual({ ...d.parts[0], name: "R_load" });
    expect(toNetlist(next)).toContain("R1 in 0 1k");
  });

  it("leaves the other parts as the same objects", () => {
    const d = circuit();
    expect(setName(d, "R1", "R_load").parts[1]).toBe(d.parts[1]);
  });

  it("brings back the default name on blank text", () => {
    const d = setName(setName(circuit(), "R1", "R_load"), "R1", "  ");
    expect(d.parts[0]).toEqual(circuit().parts[0]);
  });

  it("gives back the same drawing when nothing changes", () => {
    const named = setName(circuit(), "R1", "R_load");
    expect(setName(named, "R1", "R_load ")).toBe(named);
    const d = circuit();
    expect(setName(d, "R1", "")).toBe(d);
    expect(setName(d, "C9", "x")).toBe(d);
  });
});

describe("setValue", () => {
  it("stores the trimmed value without touching the input", () => {
    const d = circuit();
    const next = setValue(d, "R1", " 2k2 ");
    expect(next.parts[0]).toEqual({ ...d.parts[0], value: "2k2" });
    expect(d.parts[0]?.value).toBe("1k");
    expect(toNetlist(next)).toContain("R1 in 0 2k2");
  });

  it("leaves the other parts as the same objects", () => {
    const d = circuit();
    expect(setValue(d, "R1", "2k2").parts[1]).toBe(d.parts[1]);
  });

  it("gives back the same drawing for the same value or an unknown id", () => {
    const d = circuit();
    expect(setValue(d, "R1", "1k ")).toBe(d);
    expect(setValue(d, "C9", "1u")).toBe(d);
  });
});

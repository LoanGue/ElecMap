import { describe, expect, it } from "vitest";
import { setName, setValue } from "../../../docs/playground/edit/properties";
import { emptyDrawing } from "../../../docs/playground/model";
import type { Drawing } from "../../../docs/playground/model";
import { toNetlist } from "../../../docs/playground/netlist";

/** A grounded resistor whose top pin carries the label `in`. */
const circuit = (): Drawing => ({
  ...emptyDrawing(),
  parts: [{ id: "R1", kind: "resistor", x: 0, y: 0, dir: "down", value: "1k" }],
  grounds: [{ x: 0, y: 4 }],
  labels: [{ x: 0, y: 0, name: "in" }],
});

describe("setName", () => {
  it("changes the display name and keeps the SPICE id", () => {
    const d = setName(circuit(), "R1", " R_load ");
    expect(d.parts[0]).toMatchObject({ id: "R1", name: "R_load" });
    expect(toNetlist(d)).toContain("R1 in 0 1k");
  });

  it("brings back the default name on blank text", () => {
    const d = setName(setName(circuit(), "R1", "R_load"), "R1", "  ");
    expect(d.parts[0]).not.toHaveProperty("name");
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
    expect(next.parts[0]).toMatchObject({ id: "R1", value: "2k2" });
    expect(d.parts[0]?.value).toBe("1k");
    expect(toNetlist(next)).toContain("R1 in 0 2k2");
  });

  it("gives back the same drawing for the same value or an unknown id", () => {
    const d = circuit();
    expect(setValue(d, "R1", "1k ")).toBe(d);
    expect(setValue(d, "C9", "1u")).toBe(d);
  });
});

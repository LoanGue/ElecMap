import { describe, expect, it } from "vitest";
import { EXAMPLES } from "../../docs/playground/examples";
import { highlights, probe } from "../../docs/playground/probe";
import { defaultState } from "../../docs/playground/state";
import type { State } from "../../docs/playground/state";

const fresh = (patch: Partial<State> = {}): State => ({
  ...defaultState(EXAMPLES[0] as (typeof EXAMPLES)[0]),
  traces: [],
  currents: [],
  ...patch,
});

describe("playground probe", () => {
  it("toggles a voltage trace when a node is clicked in Transient", () => {
    const s = fresh({ tab: "transient", traces: ["out"] });
    expect(probe(s, undefined, "node", "in")).toBeUndefined();
    expect(s.traces).toEqual(["out", "in"]);
    probe(s, undefined, "node", "out");
    expect(s.traces).toEqual(["in"]);
  });

  it("sets the first terminal when a node is clicked in Impedance", () => {
    const s = fresh({ tab: "impedance", zA: "in" });
    expect(probe(s, "R1", "node", "out")).toBe("R1");
    expect(s.zA).toBe("out");
  });

  it("opens the transfer function on a node clicked in another tab", () => {
    const s = fresh({ tab: "dc", outKind: "current", output: "in" });
    probe(s, undefined, "node", "out");
    expect([s.tab, s.outKind, s.output]).toEqual(["transfer", "voltage", "out"]);
  });

  it("toggles the selection and the current trace of a component", () => {
    const s = fresh({ tab: "transient" });
    const sel = probe(s, undefined, "part", "R1");
    expect([sel, s.currents]).toEqual(["R1", ["R1"]]);
    expect(probe(s, sel, "part", "R1")).toBeUndefined();
    expect(s.currents).toEqual([]);
    expect(probe(s, "C1", "part", "R1")).toBe("R1");
  });

  it("adds a current trace only in Transient", () => {
    for (const tab of ["dc", "transfer", "impedance"] as const) {
      const s = fresh({ tab, currents: ["C1"] });
      probe(s, undefined, "part", "R1");
      expect(s.currents).toEqual(["C1"]);
    }
  });

  it("picks the output current only when the output is a current", () => {
    const s = fresh({ tab: "transfer", outKind: "current", outCurrent: "C1" });
    probe(s, undefined, "part", "R1");
    expect(s.outCurrent).toBe("R1");
    const v = fresh({ tab: "transfer", outKind: "voltage", outCurrent: "C1" });
    probe(v, undefined, "part", "R1");
    expect(v.outCurrent).toBe("C1");
    for (const tab of ["dc", "transient", "impedance"] as const) {
      const o = fresh({ tab, outKind: "current", outCurrent: "C1" });
      probe(o, undefined, "part", "R1");
      expect(o.outCurrent).toBe("C1");
    }
  });

  it("marks what the open tab probes, plus the selection", () => {
    const sets = (s: State, sel?: string) => {
      const h = highlights(s, sel);
      return [[...h.nodes], [...h.parts]];
    };
    expect(sets(fresh({ tab: "transfer", output: "out", reference: "in" }), "R1")).toEqual([
      ["out", "in"],
      ["R1"],
    ]);
    expect(sets(fresh({ tab: "transfer", outKind: "current", outCurrent: "C1" }))).toEqual([
      [],
      ["C1"],
    ]);
    expect(sets(fresh({ tab: "transient", traces: ["in"], currents: ["R1"] }))).toEqual([
      ["in"],
      ["R1"],
    ]);
    expect(sets(fresh({ tab: "impedance", zA: "out", zB: "0" }))).toEqual([["out", "0"], []]);
    expect(sets(fresh({ tab: "dc", traces: ["in"], currents: ["R1"] }), "V1")).toEqual([
      [],
      ["V1"],
    ]);
  });
});

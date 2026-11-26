import { describe, expect, it } from "vitest";
import { ElecMap } from "../../src";
import { EXAMPLES } from "../../docs/playground/examples";
import {
  defaultState,
  detectLang,
  fixSelections,
  sourceIds,
  toggle,
  VOLTAGE,
} from "../../docs/playground/state";

const RC = "V1 in 0 1\nR1 in out 1k\nC1 out 0 1u\n";
const first = EXAMPLES[0] as (typeof EXAMPLES)[0];

describe("playground state", () => {
  it("starts from an example", () => {
    const s = defaultState(first);
    expect(s.netlist).toBe(first.netlist);
    expect(s.tab).toBe(first.tab);
    expect(s.mode).toBe("text");
    expect(defaultState({ ...first, tStop: 0.002 }).tStop).toBe("2m");
  });

  it("detects the language from the query, then the browser", () => {
    expect(detectLang("?lang=fr", "en-US")).toBe("fr");
    expect(detectLang("?lang=en", "fr-FR")).toBe("en");
    expect(detectLang("", "fr-FR")).toBe("fr");
    expect(detectLang("", "FR")).toBe("fr");
    expect(detectLang("", "de-DE")).toBe("en");
    expect(detectLang("?lang=xx", "fr-FR")).toBe("en");
  });

  it("lists the independent sources", () => {
    expect(sourceIds(new ElecMap(RC))).toEqual(["V1"]);
    expect(sourceIds(undefined)).toEqual([]);
  });

  it("replaces selections that no longer exist in the circuit", () => {
    const s = defaultState(first);
    Object.assign(s, {
      output: "gone",
      reference: "gone",
      input: `${VOLTAGE}gone`,
      outCurrent: "X9",
      traces: ["gone"],
      currents: ["X9"],
      zA: "gone",
      zB: "gone",
    });
    const selected = fixSelections(s, new ElecMap(RC), "0", "R9");
    expect(selected).toBeUndefined();
    expect(s).toMatchObject({
      output: "out",
      reference: "",
      input: "",
      outCurrent: "V1",
      traces: ["in", "out"],
      currents: [],
      zA: "in",
      zB: "0",
    });
  });

  it("keeps selections that are still valid", () => {
    const s = defaultState(first);
    Object.assign(s, {
      output: "in",
      input: `${VOLTAGE}out`,
      outCurrent: "C1",
      traces: [],
      currents: ["R1"],
      zA: "out",
      zB: "in",
    });
    expect(fixSelections(s, new ElecMap(RC), "0", "R1")).toBe("R1");
    expect(s).toMatchObject({
      output: "in",
      input: `${VOLTAGE}out`,
      outCurrent: "C1",
      traces: [],
      currents: ["R1"],
      zA: "out",
      zB: "in",
    });
    s.input = "V1";
    fixSelections(s, new ElecMap(RC), "0", undefined);
    expect(s.input).toBe("V1");
  });

  it("toggles a value in a list in place", () => {
    const list = ["a"];
    toggle(list, "b");
    expect(list).toEqual(["a", "b"]);
    toggle(list, "a");
    expect(list).toEqual(["b"]);
  });
});

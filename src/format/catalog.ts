import type { ComponentType } from "./types";

/** Constraint applied to a numeric field. */
export type NumberConstraint = "any" | "positive" | "nonNegative" | "coupling" | "fraction";

/** Static description of a component type (used for validation, docs and tooling). */
export interface ComponentSpec {
  type: ComponentType;
  /** SPICE element letter. */
  letter: string;
  /** Human-readable name. */
  name: string;
  /** Port names, in the order of the `nodes` array. */
  ports: readonly string[];
  /** Name of the controlling node pair field, if any. */
  control?: "control";
  /** Numeric fields: name → [required, constraint]. */
  numbers: Readonly<Record<string, readonly [boolean, NumberConstraint]>>;
  /** Unit of the main value, for display. */
  unit?: string;
}

/** Catalogue of every component type supported by the canonical format. */
export const COMPONENT_CATALOG: Readonly<Record<ComponentType, ComponentSpec>> = {
  resistor: {
    type: "resistor",
    letter: "R",
    name: "Resistor",
    ports: ["a", "b"],
    numbers: { value: [true, "positive"] },
    unit: "Ω",
  },
  capacitor: {
    type: "capacitor",
    letter: "C",
    name: "Capacitor",
    ports: ["a", "b"],
    numbers: { value: [true, "positive"], ic: [false, "any"] },
    unit: "F",
  },
  inductor: {
    type: "inductor",
    letter: "L",
    name: "Inductor",
    ports: ["a", "b"],
    numbers: { value: [true, "positive"], ic: [false, "any"] },
    unit: "H",
  },
  vsource: {
    type: "vsource",
    letter: "V",
    name: "Voltage source",
    ports: ["p", "n"],
    numbers: { dc: [false, "any"] },
    unit: "V",
  },
  isource: {
    type: "isource",
    letter: "I",
    name: "Current source",
    ports: ["p", "n"],
    numbers: { dc: [false, "any"] },
    unit: "A",
  },
  vcvs: {
    type: "vcvs",
    letter: "E",
    name: "Voltage-controlled voltage source",
    ports: ["p", "n"],
    control: "control",
    numbers: { gain: [true, "any"] },
  },
  vccs: {
    type: "vccs",
    letter: "G",
    name: "Voltage-controlled current source",
    ports: ["p", "n"],
    control: "control",
    numbers: { gain: [true, "any"] },
    unit: "S",
  },
  cccs: {
    type: "cccs",
    letter: "F",
    name: "Current-controlled current source",
    ports: ["p", "n"],
    numbers: { gain: [true, "any"] },
  },
  ccvs: {
    type: "ccvs",
    letter: "H",
    name: "Current-controlled voltage source",
    ports: ["p", "n"],
    numbers: { gain: [true, "any"] },
    unit: "Ω",
  },
  opamp: {
    type: "opamp",
    letter: "X",
    name: "Operational amplifier",
    ports: ["in+", "in-", "out"],
    numbers: {
      gain: [false, "positive"],
      gbw: [false, "positive"],
      vpos: [false, "any"],
      vneg: [false, "any"],
    },
  },
  coupling: {
    type: "coupling",
    letter: "K",
    name: "Inductive coupling",
    ports: [],
    numbers: { k: [true, "coupling"] },
  },
  switch: {
    type: "switch",
    letter: "S",
    name: "Switch",
    ports: ["a", "b"],
    numbers: { ron: [false, "nonNegative"], roff: [false, "positive"] },
  },
  bsource: {
    type: "bsource",
    letter: "B",
    name: "Behavioural source",
    ports: ["p", "n"],
    numbers: {},
  },
  diode: {
    type: "diode",
    letter: "D",
    name: "Diode",
    ports: ["anode", "cathode"],
    numbers: {
      is: [false, "positive"],
      n: [false, "positive"],
      rs: [false, "nonNegative"],
      bv: [false, "positive"],
      ibv: [false, "positive"],
      nbv: [false, "positive"],
      cjo: [false, "nonNegative"],
      vj: [false, "positive"],
      m: [false, "nonNegative"],
      tt: [false, "nonNegative"],
      fc: [false, "fraction"],
    },
  },
  bjt: {
    type: "bjt",
    letter: "Q",
    name: "Bipolar transistor",
    ports: ["collector", "base", "emitter"],
    numbers: {
      is: [false, "positive"],
      bf: [false, "positive"],
      br: [false, "positive"],
      nf: [false, "positive"],
      nr: [false, "positive"],
      vaf: [false, "positive"],
      var: [false, "positive"],
      cje: [false, "nonNegative"],
      vje: [false, "positive"],
      mje: [false, "nonNegative"],
      cjc: [false, "nonNegative"],
      vjc: [false, "positive"],
      mjc: [false, "nonNegative"],
      tf: [false, "nonNegative"],
      tr: [false, "nonNegative"],
      fc: [false, "fraction"],
    },
  },
  mosfet: {
    type: "mosfet",
    letter: "M",
    name: "MOSFET",
    ports: ["drain", "gate", "source", "bulk"],
    numbers: {
      vto: [false, "any"],
      kp: [false, "positive"],
      lambda: [false, "nonNegative"],
      gamma: [false, "nonNegative"],
      phi: [false, "positive"],
      cgso: [false, "nonNegative"],
      cgdo: [false, "nonNegative"],
      w: [false, "positive"],
      l: [false, "positive"],
    },
  },
};

/**
 * JSON Schema (draft 2020-12) of the canonical circuit format, for editors,
 * external validators and code generators. ElecMap itself validates with
 * {@link validateCircuit}, which also performs electrical checks.
 *
 * @module
 */

const node = { type: "string", minLength: 1 } as const;
const twoNodes = { type: "array", items: node, minItems: 2, maxItems: 2 } as const;
const finite = { type: "number" } as const;
const positive = { type: "number", exclusiveMinimum: 0 } as const;

const base = {
  id: { type: "string", minLength: 1 },
  label: { type: "string" },
} as const;

const waveform = {
  oneOf: [
    {
      type: "object",
      required: ["kind", "offset", "amplitude", "freq"],
      properties: {
        kind: { const: "sine" },
        offset: finite,
        amplitude: finite,
        freq: finite,
        delay: finite,
        damping: finite,
        phase: finite,
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["kind", "v1", "v2"],
      properties: {
        kind: { const: "pulse" },
        v1: finite,
        v2: finite,
        delay: finite,
        rise: finite,
        fall: finite,
        width: finite,
        period: finite,
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["kind", "points"],
      properties: {
        kind: { const: "pwl" },
        points: {
          type: "array",
          minItems: 1,
          items: { type: "array", items: finite, minItems: 2, maxItems: 2 },
        },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["kind", "v2"],
      properties: { kind: { const: "step" }, v1: finite, v2: finite, delay: finite },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["kind", "v1", "v2"],
      properties: {
        kind: { const: "exp" },
        v1: finite,
        v2: finite,
        td1: finite,
        tau1: finite,
        td2: finite,
        tau2: finite,
      },
      additionalProperties: false,
    },
  ],
} as const;

function component(type: string, required: string[], properties: Record<string, unknown>) {
  return {
    type: "object",
    required: ["id", "type", ...required],
    properties: { ...base, type: { const: type }, ...properties },
    additionalProperties: false,
  };
}

const source = (type: string) =>
  component(type, ["nodes"], {
    nodes: twoNodes,
    dc: finite,
    ac: {
      type: "object",
      required: ["mag"],
      properties: { mag: finite, phase: finite },
      additionalProperties: false,
    },
    waveform,
  });

/** JSON Schema of {@link CircuitJSON}. */
export const CIRCUIT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://github.com/LoanGue/ElecMap/schema/circuit.v1.json",
  title: "ElecMap circuit",
  type: "object",
  required: ["version", "components"],
  properties: {
    version: { const: 1 },
    title: { type: "string" },
    ground: node,
    components: {
      type: "array",
      minItems: 1,
      items: {
        oneOf: [
          component("resistor", ["nodes", "value"], { nodes: twoNodes, value: positive }),
          component("capacitor", ["nodes", "value"], {
            nodes: twoNodes,
            value: positive,
            ic: finite,
          }),
          component("inductor", ["nodes", "value"], {
            nodes: twoNodes,
            value: positive,
            ic: finite,
          }),
          source("vsource"),
          source("isource"),
          component("vcvs", ["nodes", "control", "gain"], {
            nodes: twoNodes,
            control: twoNodes,
            gain: finite,
          }),
          component("vccs", ["nodes", "control", "gain"], {
            nodes: twoNodes,
            control: twoNodes,
            gain: finite,
          }),
          component("cccs", ["nodes", "controlSource", "gain"], {
            nodes: twoNodes,
            controlSource: { type: "string" },
            gain: finite,
          }),
          component("ccvs", ["nodes", "controlSource", "gain"], {
            nodes: twoNodes,
            controlSource: { type: "string" },
            gain: finite,
          }),
          component("opamp", ["nodes"], {
            nodes: { type: "array", items: node, minItems: 3, maxItems: 3 },
            gain: positive,
            gbw: positive,
          }),
          component("coupling", ["inductors", "k"], {
            inductors: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
            k: { type: "number", exclusiveMinimum: 0, maximum: 1 },
          }),
          component("switch", ["nodes", "closed"], {
            nodes: twoNodes,
            closed: { type: "boolean" },
            ron: { type: "number", minimum: 0 },
            roff: positive,
          }),
          component("diode", ["nodes"], {
            nodes: twoNodes,
            model: { type: "string" },
            is: positive,
            n: positive,
            rs: { type: "number", minimum: 0 },
            bv: positive,
            ibv: positive,
            nbv: positive,
            cjo: { type: "number", minimum: 0 },
            vj: positive,
            m: { type: "number", minimum: 0 },
            tt: { type: "number", minimum: 0 },
            fc: { type: "number", minimum: 0, exclusiveMaximum: 1 },
          }),
          component("bjt", ["nodes", "polarity"], {
            nodes: { type: "array", items: node, minItems: 3, maxItems: 3 },
            polarity: { enum: ["npn", "pnp"] },
            model: { type: "string" },
            is: positive,
            bf: positive,
            br: positive,
            nf: positive,
            nr: positive,
            vaf: positive,
            var: positive,
            cje: { type: "number", minimum: 0 },
            vje: positive,
            mje: { type: "number", minimum: 0 },
            cjc: { type: "number", minimum: 0 },
            vjc: positive,
            mjc: { type: "number", minimum: 0 },
            tf: { type: "number", minimum: 0 },
            tr: { type: "number", minimum: 0 },
            fc: { type: "number", minimum: 0, exclusiveMaximum: 1 },
          }),
          component("mosfet", ["nodes", "polarity"], {
            nodes: { type: "array", items: node, minItems: 4, maxItems: 4 },
            polarity: { enum: ["nmos", "pmos"] },
            model: { type: "string" },
            vto: finite,
            kp: positive,
            lambda: { type: "number", minimum: 0 },
            gamma: { type: "number", minimum: 0 },
            phi: positive,
            cgso: { type: "number", minimum: 0 },
            cgdo: { type: "number", minimum: 0 },
            w: positive,
            l: positive,
          }),
        ],
      },
    },
  },
  additionalProperties: false,
} as const;

/**
 * Portable SPICE netlist (`.cir`): the circuit written for LTspice, ngspice
 * and KiCad (which simulates with ngspice), without ElecMap's extensions.
 *
 * - element names start with the letter of their type (`X1.R1` → `RX1_R1`);
 * - node names keep letters, digits and `_`; the ground is `0`;
 * - an op-amp becomes a voltage-controlled source (ideal: gain 10⁶), or a
 *   subcircuit with a single pole when it has a gain-bandwidth product;
 * - a fixed-state switch becomes a resistor, a 0 V source (closed, `ron` = 0)
 *   or nothing (open, `roff` = ∞);
 * - `STEP` becomes `PWL`;
 * - device parameters go into `.model` cards (one per distinct set);
 * - powers in behavioural expressions are written `**`.
 *
 * @module
 */
import { formatExpression, parseExpression, renameProbes } from "./expression";
import { componentToSpice, FAMILY_PARAMS } from "./spice";
import type { Family } from "./spice";
import { formatSpice } from "./units";
import type { CircuitJSON, ComponentJSON, NodeName } from "./types";
import { GROUND_ALIASES } from "./validate";

/** Options of {@link toCir}. */
export interface CirOptions {
  /**
   * Analysis and control lines written before `.end`, e.g.
   * `[".ac dec 100 1 1meg"]` or `".tran 10m"`. Default `".op"`.
   */
  analysis?: string | readonly string[];
  /** Open-loop gain of the ideal op-amps (default 10⁶). */
  idealGain?: number;
}

const LETTER: Record<ComponentJSON["type"], string> = {
  resistor: "R",
  capacitor: "C",
  inductor: "L",
  vsource: "V",
  isource: "I",
  vcvs: "E",
  vccs: "G",
  cccs: "F",
  ccvs: "H",
  coupling: "K",
  bsource: "B",
  opamp: "X",
  switch: "R",
  diode: "D",
  bjt: "Q",
  mosfet: "M",
};

/** Name of the element written for `c` (the letter of the type it becomes). */
function letterOf(c: ComponentJSON): string {
  if (c.type === "switch") return c.closed && !c.ron ? "V" : "R";
  if (c.type === "opamp" && c.gbw === undefined && c.vpos === undefined) return "E";
  return LETTER[c.type];
}

type Device = Extract<ComponentJSON, { type: Family }>;

/** One component as a portable SPICE element. */
export interface PortableElement {
  component: ComponentJSON;
  /** Element name, or `undefined` when nothing is written (open switch). */
  name: string | undefined;
  /** Nodes on the line (control nodes included), SPICE names. */
  nodes: string[];
  /** Rest of the line: value, model, waveform… */
  value: string;
  /** Full line (a comment when nothing is written). */
  line: string;
}

/** A circuit translated for SPICE: elements, `.model` cards and subcircuits. */
export interface PortableCircuit {
  title: string;
  elements: PortableElement[];
  /** `.model` cards and `.subckt` definitions. */
  directives: string[];
  /** SPICE name of an original node. */
  node(name: NodeName): string;
}

/** Number of nodes on the SPICE line of a component. */
function nodeCount(c: ComponentJSON): number {
  switch (c.type) {
    case "coupling":
      return 0;
    case "vcvs":
    case "vccs":
      return 4;
    case "opamp":
      return c.gbw === undefined && c.vpos === undefined ? 4 : 3;
    default:
      return c.nodes.length;
  }
}

/** Translates a circuit into portable SPICE elements (see the module). */
export function portableCircuit(circuit: CircuitJSON, options: CirOptions = {}): PortableCircuit {
  const ground = circuit.ground ?? "0";
  // Elements, nodes and models have separate name spaces; SPICE ignores case.
  const spaces = {
    element: new Set<string>(),
    node: new Set<string>(["0"]),
    model: new Set<string>(),
  };
  const unique = (space: keyof typeof spaces, base: string): string => {
    const used = spaces[space];
    let name = base;
    for (let k = 2; used.has(name.toUpperCase()); k++) name = `${base}_${k}`;
    used.add(name.toUpperCase());
    return name;
  };
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_");

  const nodes = new Map<NodeName, string>();
  const node = (n: NodeName): string => {
    if (n === ground || GROUND_ALIASES.includes(n)) return "0";
    let m = nodes.get(n);
    if (m === undefined) {
      m = unique("node", clean(n) || "n");
      nodes.set(n, m);
    }
    return m;
  };
  const ids = new Map<string, string>();
  for (const c of circuit.components) {
    const letter = letterOf(c);
    const base = clean(c.id);
    ids.set(c.id, unique("element", base[0]?.toUpperCase() === letter ? base : `${letter}${base}`));
  }
  const id = (x: string) => ids.get(x) ?? x;

  const lines = [""];
  const subckts: string[] = [];
  const cards = new Map<string, string>();
  /** `.model` name of a device's parameter set. */
  const model = (c: Device): string => {
    const type = c.type === "diode" ? "D" : c.polarity.toUpperCase();
    const values = c as unknown as Record<string, number | undefined>;
    const params = FAMILY_PARAMS[c.type]
      .filter(([f]) => values[f] !== undefined)
      .map(([f, key]) => `${key}=${formatSpice(values[f] as number)}`);
    const card = `${type}${params.length ? `(${params.join(" ")})` : ""}`;
    for (const [name, text] of cards) if (text === card) return name;
    const name = unique("model", clean(c.model ?? (c.type === "diode" ? "DMOD" : `${type}MOD`)));
    cards.set(name, card);
    return name;
  };

  for (const c of circuit.components) {
    const name = id(c.id);
    const n = "nodes" in c ? c.nodes.map(node) : [];
    switch (c.type) {
      case "opamp": {
        const [inp, inn, out] = n as [string, string, string];
        const gain = c.gain ?? options.idealGain ?? 1e6;
        if (c.gbw === undefined && c.vpos === undefined) {
          lines.push(`${name} ${out} 0 ${inp} ${inn} ${formatSpice(gain)}`);
        } else {
          const sub = unique("model", `OPAMP_${clean(c.id)}`);
          subckts.push(...opampSubckt(sub, c, gain));
          lines.push(`${name} ${inp} ${inn} ${out} ${sub}`);
        }
        break;
      }
      case "switch": {
        const r = c.closed ? c.ron : c.roff;
        if (c.closed && !r) lines.push(`${name} ${n.join(" ")} 0`);
        else if (r === undefined || !Number.isFinite(r))
          lines.push(`* ${c.id}: open switch, not connected`);
        else lines.push(`${name} ${n.join(" ")} ${formatSpice(r)}`);
        break;
      }
      case "diode":
        lines.push(`${name} ${n.join(" ")} ${model(c)}`);
        break;
      case "bjt":
        lines.push(`${name} ${n.join(" ")} ${model(c)}`);
        break;
      case "mosfet":
        lines.push(
          [
            name,
            ...n,
            model(c),
            ...(c.w === undefined ? [] : [`W=${formatSpice(c.w)}`]),
            ...(c.l === undefined ? [] : [`L=${formatSpice(c.l)}`]),
          ].join(" "),
        );
        break;
      case "bsource": {
        const e = renameProbes(
          parseExpression(
            c.expression,
            (m) => {
              throw new Error(m);
            },
            { probes: true },
          ),
          node,
          id,
        );
        lines.push(
          `${name} ${n.join(" ")} ${c.kind === "voltage" ? "V" : "I"}=${formatExpression(e, { power: "**" })}`,
        );
        break;
      }
      case "vsource":
      case "isource": {
        let w = c.waveform;
        if (w?.kind === "step") {
          const v1 = w.v1 ?? 0;
          const t0 = w.delay ?? 0;
          // An ideal step, given a 1 ns rise: SPICE needs increasing times.
          const rise = 1e-9;
          w = {
            kind: "pwl",
            points: [...(t0 > 0 ? [[0, v1] as [number, number]] : []), [t0, v1], [t0 + rise, w.v2]],
          };
        }
        const copy = { ...c, id: name, nodes: n as [string, string] };
        if (w) copy.waveform = w;
        // Waveform before AC, as LTspice writes it (ngspice takes any order).
        let line = componentToSpice(copy);
        const ac = / AC \S+(?: (?![A-Z]+\()\S+)?/.exec(line);
        if (ac && w) line = `${line.replace(ac[0], "")}${ac[0]}`;
        lines.push(line);
        break;
      }
      case "cccs":
      case "ccvs":
        lines.push(
          componentToSpice({
            ...c,
            id: name,
            nodes: n as [string, string],
            controlSource: id(c.controlSource),
          }),
        );
        break;
      case "coupling":
        lines.push(
          componentToSpice({ ...c, id: name, inductors: [id(c.inductors[0]), id(c.inductors[1])] }),
        );
        break;
      case "vcvs":
      case "vccs":
        lines.push(
          componentToSpice({
            ...c,
            id: name,
            nodes: n as [string, string],
            control: [node(c.control[0]), node(c.control[1])],
          }),
        );
        break;
      default:
        lines.push(componentToSpice({ ...c, id: name, nodes: n } as ComponentJSON));
    }
  }
  const directives = [...[...cards].map(([name, card]) => `.model ${name} ${card}`), ...subckts];
  const elements = circuit.components.map((c, i): PortableElement => {
    const line = lines[i + 1] as string;
    if (line.startsWith("*")) return { component: c, name: undefined, nodes: [], value: "", line };
    const words = line.split(" ");
    const k = nodeCount(c);
    return {
      component: c,
      name: words[0] as string,
      nodes: words.slice(1, 1 + k),
      value: words.slice(1 + k).join(" "),
      line,
    };
  });
  return { title: circuit.title ?? "ElecMap circuit", elements, directives, node };
}

/** Writes a circuit as a portable SPICE netlist. */
export function toCir(circuit: CircuitJSON, options: CirOptions = {}): string {
  const p = portableCircuit(circuit, options);
  const analysis = options.analysis ?? ".op";
  return (
    [
      // The first line of a netlist is its title, whatever it holds.
      `* ${p.title}`,
      ...p.elements.map((e) => e.line),
      ...p.directives,
      ...(typeof analysis === "string" ? [analysis] : analysis),
      ".end",
    ].join("\n") + "\n"
  );
}

/**
 * Subcircuit of a finite op-amp: the gain stage (a transconductance into a
 * resistor, or a `tanh` behavioural source between the rails), then the pole.
 */
function opampSubckt(
  sub: string,
  c: Extract<ComponentJSON, { type: "opamp" }>,
  gain: number,
): string[] {
  const f = formatSpice;
  const pole = c.gbw === undefined ? "" : `, gain-bandwidth ${f(c.gbw)} Hz: one pole at GBW/gain`;
  if (c.vpos === undefined || c.vneg === undefined) {
    const cap = `C1 x 0 ${f(1 / (2 * Math.PI * (c.gbw as number)))}`;
    const stage = ["G1 0 x inp inn 1", `R1 x 0 ${f(gain)}`, cap];
    return [
      `.subckt ${sub} inp inn out`,
      `* gain ${f(gain)}${pole}`,
      ...stage,
      "E1 out 0 x 0 1",
      ".ends",
    ];
  }
  const [mid, half] = [(c.vpos + c.vneg) / 2, (c.vpos - c.vneg) / 2];
  const tau = c.gbw === undefined ? [] : [`C1 x 0 ${f(gain / (2 * Math.PI * c.gbw))}`];
  return [
    `.subckt ${sub} inp inn out`,
    `* gain ${f(gain)}${pole}, output between ${f(c.vneg)} V and ${f(c.vpos)} V`,
    `B1 y 0 V=${f(mid)}+${f(half)}*tanh(${f(gain / half)}*(V(inp)-V(inn)))`,
    "R1 y x 1",
    ...tau,
    "E1 out 0 x 0 1",
    ".ends",
  ];
}

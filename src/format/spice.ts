/**
 * SPICE netlist parser and serialiser.
 *
 * Supported subset (case-insensitive element letters and keywords):
 *
 * | Line | Component |
 * | --- | --- |
 * | `Rname n1 n2 value` | resistor |
 * | `Cname n1 n2 value [IC=v]` | capacitor |
 * | `Lname n1 n2 value [IC=i]` | inductor |
 * | `Vname n+ n- [DC v] [AC mag [phase]] [SIN(…)/PULSE(…)/PWL(…)/EXP(…)]` | voltage source |
 * | `Iname n+ n- …` (same as V) | current source |
 * | `Ename n+ n- nc+ nc- gain` | VCVS |
 * | `Gname n+ n- nc+ nc- gm` | VCCS |
 * | `Fname n+ n- Vctrl gain` | CCCS |
 * | `Hname n+ n- Vctrl r` | CCVS |
 * | `Kname L1 L2 k` | coupled inductors |
 * | `Xname in+ in- out OPAMP [GAIN=a] [GBW=f]` | op-amp (ElecMap extension) |
 * | `Sname n1 n2 ON\|OFF [RON=r] [ROFF=r]` | fixed switch (ElecMap extension) |
 *
 * Comments start with `*` (whole line) or `;` / `$ ` (inline). Lines starting
 * with `+` continue the previous line. `.title`, `.end` are understood; other
 * dot-directives are ignored with a warning.
 *
 * @module
 */

import { ElecMapError } from "../core/errors";
import type {
  AcSpec,
  CircuitJSON,
  ComponentJSON,
  CurrentSourceJSON,
  NodeName,
  VoltageSourceJSON,
  Waveform,
} from "./types";
import { FORMAT_VERSION } from "./types";
import { formatSpice, parseValue } from "./units";

/** Options for {@link parseSpice}. */
export interface SpiceParseOptions {
  /**
   * Whether the first line is a title, as in classic SPICE.
   * `"auto"` (default) treats it as a title only if it does not look like an element line.
   */
  titleLine?: boolean | "auto";
  /** Ground node name (default `"0"`). `gnd` / `GND` are always aliases of the ground. */
  ground?: NodeName;
}

/** Result of {@link parseSpice}. */
export interface SpiceParseResult {
  circuit: CircuitJSON;
  /** Non-fatal remarks (ignored directives…). */
  warnings: string[];
}

interface Line {
  text: string;
  line: number;
}

type Token = { kind: "word"; value: string } | { kind: "group"; name: string; args: string[] };

function fail(message: string, line: number): never {
  throw new ElecMapError("PARSE_ERROR", `Line ${line}: ${message}`, { line });
}

/** Joins continuation lines and strips comments. */
function logicalLines(source: string): Line[] {
  const out: Line[] = [];
  source.split(/\r?\n/).forEach((raw, i) => {
    const lineNo = i + 1;
    let text = raw
      .replace(/;.*$/, "")
      .replace(/\s\$\s.*$/, "")
      .trim();
    if (text === "" || text.startsWith("*")) return;
    if (text.startsWith("+")) {
      const prev = out[out.length - 1];
      if (!prev) fail("continuation line without a preceding line", lineNo);
      prev.text += " " + text.slice(1).trim();
      return;
    }
    text = text.replace(/\s+/g, " ");
    out.push({ text, line: lineNo });
  });
  return out;
}

/** Splits a line into words, `NAME(args…)` groups and `key=value` pairs. */
function tokenize(text: string, line: number): Token[] {
  const tokens: Token[] = [];
  // Normalise "SIN (" → "SIN(" and spaces around "=".
  const src = text
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)/g, ")")
    .replace(/\s*=\s*/g, "=");
  let i = 0;
  while (i < src.length) {
    if (src[i] === " ") {
      i++;
      continue;
    }
    let j = i;
    while (j < src.length && src[j] !== " " && src[j] !== "(") j++;
    const word = src.slice(i, j);
    if (src[j] === "(") {
      const close = src.indexOf(")", j);
      if (close === -1) fail(`missing ")" after ${word}`, line);
      const args = src
        .slice(j + 1, close)
        .split(/[\s,]+/)
        .filter((a) => a !== "");
      tokens.push({ kind: "group", name: word.toUpperCase(), args });
      i = close + 1;
    } else {
      tokens.push({ kind: "word", value: word });
      i = j;
    }
  }
  return tokens;
}

function num(text: string | undefined, what: string, line: number): number {
  if (text === undefined) fail(`missing ${what}`, line);
  const v = parseValue(text);
  if (v === undefined) fail(`invalid ${what}: "${text}"`, line);
  return v;
}

function words(tokens: Token[], line: number): string[] {
  return tokens.map((t) => {
    if (t.kind !== "word") fail(`unexpected "${t.name}(…)"`, line);
    return t.value;
  });
}

/** Extracts `KEY=value` parameters (keys upper-cased) and returns the remaining words. */
function splitParams(ws: string[]): { positional: string[]; params: Map<string, string> } {
  const params = new Map<string, string>();
  const positional: string[] = [];
  for (const w of ws) {
    const eq = w.indexOf("=");
    if (eq > 0) params.set(w.slice(0, eq).toUpperCase(), w.slice(eq + 1));
    else positional.push(w);
  }
  return { positional, params };
}

function parseWaveform(name: string, args: string[], line: number): Waveform {
  const v = (k: number, what: string) => num(args[k], what, line);
  const opt = (k: number) =>
    args[k] === undefined ? undefined : num(args[k], `argument ${k + 1}`, line);
  const defined = (o: Record<string, unknown>): Waveform =>
    Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined)) as unknown as Waveform;
  switch (name) {
    case "SIN": {
      const phase = opt(5);
      return defined({
        kind: "sine",
        offset: v(0, "SIN offset"),
        amplitude: v(1, "SIN amplitude"),
        freq: v(2, "SIN frequency"),
        delay: opt(3),
        damping: opt(4),
        phase,
      });
    }
    case "PULSE":
      return defined({
        kind: "pulse",
        v1: v(0, "PULSE v1"),
        v2: v(1, "PULSE v2"),
        delay: opt(2),
        rise: opt(3),
        fall: opt(4),
        width: opt(5),
        period: opt(6),
      });
    case "PWL": {
      if (args.length === 0 || args.length % 2 !== 0) fail("PWL needs time/value pairs", line);
      const points: [number, number][] = [];
      for (let k = 0; k < args.length; k += 2)
        points.push([v(k, "PWL time"), v(k + 1, "PWL value")]);
      return { kind: "pwl", points };
    }
    case "EXP":
      return defined({
        kind: "exp",
        v1: v(0, "EXP v1"),
        v2: v(1, "EXP v2"),
        td1: opt(2),
        tau1: opt(3),
        td2: opt(4),
        tau2: opt(5),
      });
    case "STEP":
      return defined({ kind: "step", v1: opt(0), v2: v(1, "STEP v2"), delay: opt(2) });
    default:
      return fail(`unknown waveform "${name}"`, line);
  }
}

function parseSource(
  id: string,
  type: "vsource" | "isource",
  tokens: Token[],
  line: number,
): ComponentJSON {
  const [n1, n2, ...rest] = tokens;
  if (n1?.kind !== "word" || n2?.kind !== "word") fail(`${id}: expected two nodes`, line);
  const comp: VoltageSourceJSON | CurrentSourceJSON = { id, type, nodes: [n1.value, n2.value] };
  for (let k = 0; k < rest.length; k++) {
    const t = rest[k] as Token;
    if (t.kind === "group") {
      if (t.name === "AC") {
        comp.ac = acSpec(t.args, line);
      } else {
        comp.waveform = parseWaveform(t.name, t.args, line);
      }
      continue;
    }
    const kw = t.value.toUpperCase();
    const next = rest[k + 1];
    const nextWord = next?.kind === "word" ? next.value : undefined;
    if (kw === "DC") {
      comp.dc = num(nextWord, `${id} DC value`, line);
      k++;
    } else if (kw === "AC") {
      const args: string[] = [];
      while (k + 1 < rest.length) {
        const a = rest[k + 1] as Token;
        if (a.kind !== "word" || parseValue(a.value) === undefined || args.length === 2) break;
        args.push(a.value);
        k++;
      }
      comp.ac = acSpec(args.length ? args : ["1"], line);
    } else if (parseValue(t.value) !== undefined && comp.dc === undefined) {
      comp.dc = parseValue(t.value) as number;
    } else {
      fail(`${id}: unexpected "${t.value}"`, line);
    }
  }
  return comp;
}

function acSpec(args: string[], line: number): AcSpec {
  const mag = num(args[0] ?? "1", "AC magnitude", line);
  const phase = args[1] === undefined ? undefined : num(args[1], "AC phase", line);
  return phase === undefined ? { mag } : { mag, phase };
}

function parseElement(text: string, line: number): ComponentJSON {
  const tokens = tokenize(text, line);
  const first = tokens.shift();
  if (first?.kind !== "word") fail("expected an element name", line);
  const id = first.value;
  const letter = id[0]?.toUpperCase();

  if (letter === "V" || letter === "I") {
    return parseSource(id, letter === "V" ? "vsource" : "isource", tokens, line);
  }

  const { positional: p, params } = splitParams(words(tokens, line));
  const need = (count: number, what: string) => {
    if (p.length < count) fail(`${id}: expected ${what}`, line);
  };
  const two = (): [NodeName, NodeName] => [p[0] as string, p[1] as string];
  const icParam = () => {
    const ic = params.get("IC");
    return ic === undefined ? {} : { ic: num(ic, `${id} IC`, line) };
  };

  switch (letter) {
    case "R":
      need(3, "2 nodes and a value");
      return { id, type: "resistor", nodes: two(), value: num(p[2], `${id} value`, line) };
    case "C":
      need(3, "2 nodes and a value");
      return {
        id,
        type: "capacitor",
        nodes: two(),
        value: num(p[2], `${id} value`, line),
        ...icParam(),
      };
    case "L":
      need(3, "2 nodes and a value");
      return {
        id,
        type: "inductor",
        nodes: two(),
        value: num(p[2], `${id} value`, line),
        ...icParam(),
      };
    case "E":
    case "G":
      need(5, "4 nodes and a gain");
      return {
        id,
        type: letter === "E" ? "vcvs" : "vccs",
        nodes: two(),
        control: [p[2] as string, p[3] as string],
        gain: num(p[4], `${id} gain`, line),
      };
    case "F":
    case "H":
      need(4, "2 nodes, a controlling source and a gain");
      return {
        id,
        type: letter === "F" ? "cccs" : "ccvs",
        nodes: two(),
        controlSource: p[2] as string,
        gain: num(p[3], `${id} gain`, line),
      };
    case "K":
      need(3, "2 inductors and a coupling factor");
      return {
        id,
        type: "coupling",
        inductors: [p[0] as string, p[1] as string],
        k: num(p[2], `${id} coupling factor`, line),
      };
    case "S": {
      need(3, "2 nodes and ON/OFF");
      const state = (p[2] as string).toUpperCase();
      if (state !== "ON" && state !== "OFF") fail(`${id}: switch state must be ON or OFF`, line);
      const comp: ComponentJSON = { id, type: "switch", nodes: two(), closed: state === "ON" };
      const ron = params.get("RON");
      const roff = params.get("ROFF");
      if (ron !== undefined) comp.ron = num(ron, `${id} RON`, line);
      if (roff !== undefined) comp.roff = num(roff, `${id} ROFF`, line);
      return comp;
    }
    case "X": {
      const model = p[p.length - 1]?.toUpperCase();
      if (model !== "OPAMP") {
        throw new ElecMapError(
          "UNSUPPORTED",
          `Line ${line}: subcircuit "${p[p.length - 1] ?? ""}" is not supported (only OPAMP)`,
          { line },
        );
      }
      if (p.length !== 4) fail(`${id}: OPAMP expects 3 nodes (in+ in- out)`, line);
      const comp: ComponentJSON = {
        id,
        type: "opamp",
        nodes: [p[0] as string, p[1] as string, p[2] as string],
      };
      const gain = params.get("GAIN");
      const gbw = params.get("GBW");
      if (gain !== undefined) comp.gain = num(gain, `${id} GAIN`, line);
      if (gbw !== undefined) comp.gbw = num(gbw, `${id} GBW`, line);
      return comp;
    }
    default:
      return fail(`unknown element "${id}"`, line);
  }
}

/** True if the line parses as a valid element (used to detect a SPICE title line). */
function looksLikeElement({ text, line }: Line): boolean {
  try {
    parseElement(text, line);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parses a SPICE netlist into the canonical {@link CircuitJSON} format.
 *
 * @throws {@link ElecMapError} `PARSE_ERROR` (with `details.line`) or `UNSUPPORTED`
 */
export function parseSpice(source: string, options: SpiceParseOptions = {}): SpiceParseResult {
  const lines = logicalLines(source);
  const warnings: string[] = [];
  const circuit: CircuitJSON = { version: FORMAT_VERSION, components: [] };
  if (options.ground !== undefined) circuit.ground = options.ground;

  const titleMode = options.titleLine ?? "auto";
  const firstLine = lines[0];
  if (firstLine && !firstLine.text.startsWith(".")) {
    if (titleMode === true || (titleMode === "auto" && !looksLikeElement(firstLine))) {
      circuit.title = firstLine.text;
      lines.shift();
    }
  }

  for (const { text, line } of lines) {
    if (text.startsWith(".")) {
      const [directive, ...rest] = text.split(" ");
      const d = (directive as string).toLowerCase();
      if (d === ".end") break;
      if (d === ".title") circuit.title = rest.join(" ");
      else if (d === ".subckt") {
        throw new ElecMapError("UNSUPPORTED", `Line ${line}: .subckt is not supported yet`, {
          line,
        });
      } else warnings.push(`Line ${line}: directive ${directive} ignored`);
      continue;
    }
    circuit.components.push(parseElement(text, line));
  }
  return { circuit, warnings };
}

function sourceToSpice(c: Extract<ComponentJSON, { type: "vsource" | "isource" }>): string {
  const parts = [c.id, ...c.nodes];
  if (c.dc !== undefined) parts.push("DC", formatSpice(c.dc));
  if (c.ac) {
    parts.push("AC", formatSpice(c.ac.mag));
    if (c.ac.phase !== undefined) parts.push(formatSpice(c.ac.phase));
  }
  const w = c.waveform;
  if (w) {
    const f = (xs: (number | undefined)[]) => {
      let end = xs.length;
      while (end > 0 && xs[end - 1] === undefined) end--;
      return xs
        .slice(0, end)
        .map((x) => formatSpice(x ?? 0))
        .join(" ");
    };
    switch (w.kind) {
      case "sine":
        parts.push(`SIN(${f([w.offset, w.amplitude, w.freq, w.delay, w.damping, w.phase])})`);
        break;
      case "pulse":
        parts.push(`PULSE(${f([w.v1, w.v2, w.delay, w.rise, w.fall, w.width, w.period])})`);
        break;
      case "pwl":
        parts.push(
          `PWL(${w.points.map(([t, v]) => `${formatSpice(t)} ${formatSpice(v)}`).join(" ")})`,
        );
        break;
      case "exp":
        parts.push(`EXP(${f([w.v1, w.v2, w.td1, w.tau1, w.td2, w.tau2])})`);
        break;
      case "step":
        parts.push(`STEP(${f([w.v1 ?? 0, w.v2, w.delay])})`);
        break;
    }
  }
  return parts.join(" ");
}

/** Serialises one component as a SPICE line. */
export function componentToSpice(c: ComponentJSON): string {
  switch (c.type) {
    case "resistor":
      return `${c.id} ${c.nodes.join(" ")} ${formatSpice(c.value)}`;
    case "capacitor":
    case "inductor":
      return `${c.id} ${c.nodes.join(" ")} ${formatSpice(c.value)}${c.ic === undefined ? "" : ` IC=${formatSpice(c.ic)}`}`;
    case "vsource":
    case "isource":
      return sourceToSpice(c);
    case "vcvs":
    case "vccs":
      return `${c.id} ${c.nodes.join(" ")} ${c.control.join(" ")} ${formatSpice(c.gain)}`;
    case "cccs":
    case "ccvs":
      return `${c.id} ${c.nodes.join(" ")} ${c.controlSource} ${formatSpice(c.gain)}`;
    case "coupling":
      return `${c.id} ${c.inductors.join(" ")} ${formatSpice(c.k)}`;
    case "opamp":
      return [
        c.id,
        ...c.nodes,
        "OPAMP",
        ...(c.gain === undefined ? [] : [`GAIN=${formatSpice(c.gain)}`]),
        ...(c.gbw === undefined ? [] : [`GBW=${formatSpice(c.gbw)}`]),
      ].join(" ");
    case "switch":
      return [
        c.id,
        ...c.nodes,
        c.closed ? "ON" : "OFF",
        ...(c.ron === undefined ? [] : [`RON=${formatSpice(c.ron)}`]),
        ...(c.roff === undefined ? [] : [`ROFF=${formatSpice(c.roff)}`]),
      ].join(" ");
  }
}

/** Serialises a circuit as a SPICE netlist (`.title` first, `.end` last). */
export function toSpice(circuit: CircuitJSON): string {
  const lines = [circuit.title === undefined ? "* ElecMap circuit" : `.title ${circuit.title}`];
  for (const c of circuit.components) lines.push(componentToSpice(c));
  lines.push(".end");
  return lines.join("\n") + "\n";
}

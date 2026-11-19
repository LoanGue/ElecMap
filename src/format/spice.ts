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
 * | `Dname anode cathode [model] [area] [IS=… N=… RS=… BV=…]` | diode / zener |
 *
 * Device parameters come from `.model name D(IS=… N=… RS=… BV=… IBV=… NBV=… CJO=…)`
 * cards (anywhere in the netlist, names case-insensitive); parameters written on
 * the element line override them (ElecMap extension). Unsupported model
 * parameters are ignored with a warning.
 *
 * Comments start with `*` (whole line) or `;` / `$ ` (inline). Lines starting
 * with `+` continue the previous line. `.title`, `.model`, `.end` are understood;
 * other dot-directives are ignored with a warning.
 *
 * @module
 */

import { ElecMapError } from "../core/errors";
import type {
  AcSpec,
  CircuitJSON,
  ComponentJSON,
  CurrentSourceJSON,
  DiodeJSON,
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

/** A `.model` card. */
interface ModelCard {
  /** Name as written. */
  name: string;
  /** Device type, upper-cased (`D`…). */
  type: string;
  /** Parameters, upper-cased keys. */
  params: Map<string, string>;
  line: number;
}

type Models = ReadonlyMap<string, ModelCard>;

/** Diode fields and their SPICE parameter names. */
const DIODE_PARAMS = [
  ["is", "IS"],
  ["n", "N"],
  ["rs", "RS"],
  ["bv", "BV"],
  ["ibv", "IBV"],
  ["nbv", "NBV"],
  ["cjo", "CJO"],
] as const;

type DiodeField = (typeof DIODE_PARAMS)[number][0];
type DiodeCard = Partial<Record<DiodeField, number>>;

const MODEL_ALIASES: Record<string, string> = { CJ0: "CJO" };

function parseModel(text: string, line: number, warnings: string[]): ModelCard {
  const tokens = tokenize(text, line).slice(1);
  const name = tokens[0];
  if (name?.kind !== "word") fail(".model expects a name and a type", line);
  const typeToken = tokens[1];
  let type: string;
  let raw: string[];
  if (typeToken?.kind === "group") {
    type = typeToken.name;
    raw = [...typeToken.args, ...words(tokens.slice(2), line)];
  } else if (typeToken?.kind === "word") {
    type = typeToken.value.toUpperCase();
    raw = words(tokens.slice(2), line);
  } else {
    return fail(`.model ${name.value}: missing device type`, line);
  }
  const { positional, params } = splitParams(raw);
  if (positional.length > 0)
    fail(`.model ${name.value}: unexpected "${positional[0] as string}"`, line);
  if (type !== "D") {
    throw new ElecMapError(
      "UNSUPPORTED",
      `Line ${line}: .model type "${type}" is not supported (only D)`,
      { line },
    );
  }
  const known = new Set<string>(DIODE_PARAMS.map(([, k]) => k));
  const out = new Map<string, string>();
  for (const [k, v] of params) {
    const key = MODEL_ALIASES[k] ?? k;
    if (known.has(key)) out.set(key, v);
    else warnings.push(`Line ${line}: model ${name.value}: parameter ${k} ignored`);
  }
  return { name: name.value, type, params: out, line };
}

function parseDiode(
  id: string,
  p: string[],
  params: Map<string, string>,
  models: Models,
  line: number,
): DiodeJSON {
  if (p.length < 2 || p.length > 4) fail(`${id}: expected anode, cathode [model] [area]`, line);
  const comp: DiodeJSON = { id, type: "diode", nodes: [p[0] as string, p[1] as string] };
  let rest = p.slice(2);
  if (rest[0] !== undefined && parseValue(rest[0]) === undefined) {
    const card = models.get(rest[0].toUpperCase());
    if (!card) fail(`${id}: unknown model "${rest[0]}"`, line);
    comp.model = card.name;
    for (const [field, key] of DIODE_PARAMS) {
      const v = card.params.get(key);
      if (v !== undefined) comp[field] = num(v, `${card.name} ${key}`, card.line);
    }
    rest = rest.slice(1);
  }
  if (rest.length > 1) fail(`${id}: unexpected "${rest[1] as string}"`, line);
  const area = rest[0] === undefined ? 1 : num(rest[0], `${id} area`, line);
  const fields = new Map<string, DiodeField>(DIODE_PARAMS.map(([field, key]) => [key, field]));
  for (const [k, v] of params) {
    const field = fields.get(MODEL_ALIASES[k] ?? k);
    if (!field) fail(`${id}: unknown diode parameter "${k}"`, line);
    comp[field] = num(v, `${id} ${k}`, line);
  }
  if (area !== 1) {
    if (!(area > 0)) fail(`${id}: area must be > 0`, line);
    comp.is = (comp.is ?? 1e-14) * area;
    if (comp.rs !== undefined) comp.rs /= area;
    if (comp.cjo !== undefined) comp.cjo *= area;
    if (comp.bv !== undefined) comp.ibv = (comp.ibv ?? 1e-3) * area;
  }
  return comp;
}

function parseElement(text: string, line: number, models: Models = new Map()): ComponentJSON {
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
    case "D":
      return parseDiode(id, p, params, models, line);
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
function looksLikeElement({ text, line }: Line, models: Models): boolean {
  try {
    parseElement(text, line, models);
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

  // Model cards first: elements may use a model defined further down.
  const models = new Map<string, ModelCard>();
  for (const l of lines) {
    if (l === firstLine && titleMode === true) continue;
    if (/^\.end\b/i.test(l.text)) break;
    if (!/^\.model\b/i.test(l.text)) continue;
    const card = parseModel(l.text, l.line, warnings);
    const key = card.name.toUpperCase();
    if (models.has(key)) fail(`duplicate model "${card.name}"`, l.line);
    models.set(key, card);
  }

  if (firstLine && !firstLine.text.startsWith(".")) {
    if (titleMode === true || (titleMode === "auto" && !looksLikeElement(firstLine, models))) {
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
      else if (d === ".model") continue;
      else if (d === ".subckt") {
        throw new ElecMapError("UNSUPPORTED", `Line ${line}: .subckt is not supported yet`, {
          line,
        });
      } else warnings.push(`Line ${line}: directive ${directive} ignored`);
      continue;
    }
    circuit.components.push(parseElement(text, line, models));
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

/** `KEY=value` list of the diode fields of `c` that differ from `card`. */
function diodeParamsText(c: DiodeJSON, card: DiodeCard = {}): string[] {
  return DIODE_PARAMS.filter(([field]) => c[field] !== undefined && c[field] !== card[field]).map(
    ([field, key]) => `${key}=${formatSpice(c[field] as number)}`,
  );
}

/** Model cards of the diodes, by model name (parameters of the first diode using it). */
function diodeCards(circuit: CircuitJSON): Map<string, DiodeCard> {
  const cards = new Map<string, DiodeCard>();
  for (const c of circuit.components) {
    if (c.type !== "diode" || c.model === undefined || cards.has(c.model)) continue;
    const card: DiodeCard = {};
    for (const [field] of DIODE_PARAMS) if (c[field] !== undefined) card[field] = c[field];
    cards.set(c.model, card);
  }
  return cards;
}

/**
 * Serialises one component as a SPICE line. A diode refers to its `model` when
 * `cards` holds it (as written by {@link toSpice}); parameters that differ from
 * the card are written on the line.
 */
export function componentToSpice(
  c: ComponentJSON,
  cards: ReadonlyMap<string, DiodeCard> = new Map(),
): string {
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
    case "diode": {
      const card = c.model === undefined ? undefined : cards.get(c.model);
      return [
        c.id,
        ...c.nodes,
        ...(card ? [c.model as string] : []),
        ...diodeParamsText(c, card),
      ].join(" ");
    }
  }
}

/** Serialises a circuit as a SPICE netlist (`.title` first, `.end` last). */
export function toSpice(circuit: CircuitJSON): string {
  const lines = [circuit.title === undefined ? "* ElecMap circuit" : `.title ${circuit.title}`];
  const cards = diodeCards(circuit);
  for (const c of circuit.components) lines.push(componentToSpice(c, cards));
  for (const [name, card] of cards) {
    const list = DIODE_PARAMS.filter(([f]) => card[f] !== undefined).map(
      ([f, key]) => `${key}=${formatSpice(card[f] as number)}`,
    );
    lines.push(`.model ${name} D${list.length ? `(${list.join(" ")})` : ""}`);
  }
  lines.push(".end");
  return lines.join("\n") + "\n";
}

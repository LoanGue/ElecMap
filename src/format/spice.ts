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
 * | `Bname n+ n- V=expression` / `I=expression` | behavioural source |
 * | `Kname L1 L2 k` | coupled inductors |
 * | `Xname in+ in- out OPAMP [GAIN=a] [GBW=f]` | op-amp (ElecMap extension) |
 * | `Sname n1 n2 ON\|OFF [RON=r] [ROFF=r]` | fixed switch (ElecMap extension) |
 * | `Dname anode cathode [model] [area] [IS=… N=… RS=… BV=…]` | diode / zener |
 * | `Qname c b e [substrate] model [area]` | bipolar transistor (`NPN` / `PNP` cards) |
 * | `Mname d g s [b] model [W=…] [L=…]` | MOSFET level 1 (`NMOS` / `PMOS` cards) |
 *
 * Device parameters come from `.model` cards (anywhere in the netlist, names
 * case-insensitive): `D(IS N RS BV IBV NBV CJO)`, `NPN`/`PNP(IS BF BR NF NR VAF VAR
 * CJE CJC)`, `NMOS`/`PMOS(VTO KP LAMBDA GAMMA PHI CGSO CGDO)`. Parameters written
 * on the element line override them, and the bare names `NPN`, `PNP`, `NMOS`,
 * `PMOS` stand for a default model (ElecMap extensions). Unsupported model
 * parameters are ignored with a warning.
 *
 * Subcircuits: `.subckt NAME port… [PARAMS:] [K=default…]` … `.ends`, used with
 * `Xname node… NAME [K=value…]`. They are flattened: the elements of `X1` become
 * `X1.R1`, `X1.C2`…, its internal nodes `X1.mid`…; ports are replaced by the
 * instance nodes and the ground stays global. Subcircuits may be nested.
 * Parameters (`.param K=value`, subcircuit defaults and instance values) are
 * used as `{expression}` in element lines.
 *
 * Comments start with `*` (whole line) or `;` / `$ ` (inline). Lines starting
 * with `+` continue the previous line. `.title`, `.model`, `.param`, `.subckt`,
 * `.ends`, `.end` are understood; other dot-directives are ignored with a warning.
 * The type of an element is the first letter of the last `.`-separated part of
 * its name, so a flattened `X1.R1` is read back as a resistor.
 *
 * @module
 */

import { ElecMapError } from "../core/errors";
import type {
  AcSpec,
  CircuitJSON,
  ComponentJSON,
  BjtJSON,
  CurrentSourceJSON,
  DiodeJSON,
  MosfetJSON,
  NodeName,
  VoltageSourceJSON,
  Waveform,
} from "./types";
import { FORMAT_VERSION } from "./types";
import { formatExpression, parseExpression, renameProbes, resolveParameters } from "./expression";
import { formatSpice, parseValue } from "./units";
import { evaluate } from "./expression";
import { GROUND_ALIASES } from "./validate";

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

/** Device families that take their parameters from a `.model` card. */
export type Family = "diode" | "bjt" | "mosfet";

/** Numeric fields of each family and their SPICE parameter names. */
export const FAMILY_PARAMS: Record<Family, readonly (readonly [string, string])[]> = {
  diode: [
    ["is", "IS"],
    ["n", "N"],
    ["rs", "RS"],
    ["bv", "BV"],
    ["ibv", "IBV"],
    ["nbv", "NBV"],
    ["cjo", "CJO"],
    ["vj", "VJ"],
    ["m", "M"],
    ["tt", "TT"],
    ["fc", "FC"],
  ],
  bjt: [
    ["is", "IS"],
    ["bf", "BF"],
    ["br", "BR"],
    ["nf", "NF"],
    ["nr", "NR"],
    ["vaf", "VAF"],
    ["var", "VAR"],
    ["cje", "CJE"],
    ["vje", "VJE"],
    ["mje", "MJE"],
    ["cjc", "CJC"],
    ["vjc", "VJC"],
    ["mjc", "MJC"],
    ["tf", "TF"],
    ["tr", "TR"],
    ["fc", "FC"],
  ],
  mosfet: [
    ["vto", "VTO"],
    ["kp", "KP"],
    ["lambda", "LAMBDA"],
    ["gamma", "GAMMA"],
    ["phi", "PHI"],
    ["cgso", "CGSO"],
    ["cgdo", "CGDO"],
  ],
};

/** `.model` types and the family they describe. */
const MODEL_TYPES: Record<string, Family> = {
  D: "diode",
  NPN: "bjt",
  PNP: "bjt",
  NMOS: "mosfet",
  PMOS: "mosfet",
};

const FAMILY_NAMES: Record<Family, string> = {
  diode: "diode",
  bjt: "bipolar transistor",
  mosfet: "MOSFET",
};

const MODEL_ALIASES: Record<string, string> = {
  CJ0: "CJO",
  CJ: "CJO",
  PB: "VJ",
  MJ: "M",
  PE: "VJE",
  ME: "MJE",
  PC: "VJC",
  MC: "MJC",
  VA: "VAF",
  VB: "VAR",
  VT0: "VTO",
};

/**
 * A `.model` card as written by {@link toSpice}: its SPICE type (`D`, `NPN`,
 * `PNP`, `NMOS`, `PMOS`) and the device fields it sets (by field name).
 */
export interface DeviceCard {
  type: string;
  values: Partial<Record<string, number>>;
}

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
  const family = MODEL_TYPES[type];
  if (!family) {
    throw new ElecMapError(
      "UNSUPPORTED",
      `Line ${line}: .model type "${type}" is not supported (only ${Object.keys(MODEL_TYPES).join(", ")})`,
      { line },
    );
  }
  const known = new Set<string>(FAMILY_PARAMS[family].map(([, k]) => k));
  const out = new Map<string, string>();
  for (const [k, v] of params) {
    const key = MODEL_ALIASES[k] ?? k;
    if (family === "mosfet" && key === "LEVEL") {
      if (num(v, `${name.value} LEVEL`, line) !== 1) {
        throw new ElecMapError(
          "UNSUPPORTED",
          `Line ${line}: model ${name.value}: only MOSFET LEVEL=1 is supported`,
          { line },
        );
      }
    } else if (known.has(key)) out.set(key, v);
    else warnings.push(`Line ${line}: model ${name.value}: parameter ${k} ignored`);
  }
  return { name: name.value, type, params: out, line };
}

/** Copies the parameters of a model card into a device. */
function applyCard(comp: object, family: Family, card: ModelCard): void {
  const target = comp as Record<string, unknown>;
  for (const [field, key] of FAMILY_PARAMS[family]) {
    const v = card.params.get(key);
    if (v !== undefined) target[field] = num(v, `${card.name} ${key}`, card.line);
  }
}

/**
 * Applies the `KEY=value` parameters of an element line: `extra` fields
 * (instance parameters), then model parameters overriding the card.
 */
function applyLineParams(
  comp: object,
  family: Family,
  params: Map<string, string>,
  id: string,
  line: number,
  extra: Record<string, string> = {},
  ignored: readonly string[] = [],
  warnings: string[] = [],
): void {
  const target = comp as Record<string, unknown>;
  const fields = new Map<string, string>(FAMILY_PARAMS[family].map(([field, key]) => [key, field]));
  for (const [k, v] of params) {
    const field = extra[k] ?? fields.get(MODEL_ALIASES[k] ?? k);
    if (field) target[field] = num(v, `${id} ${k}`, line);
    else if (ignored.includes(k)) warnings.push(`Line ${line}: ${id}: parameter ${k} ignored`);
    else fail(`${id}: unknown ${FAMILY_NAMES[family]} parameter "${k}"`, line);
  }
}

/**
 * Looks up the model of a device: a `.model` card of the right family, or one
 * of the bare `keywords` (default parameters). Returns the card and the type.
 */
function resolveModel(
  id: string,
  name: string,
  family: Family,
  keywords: readonly string[],
  models: Models,
  line: number,
): { card: ModelCard | undefined; type: string } {
  const card = models.get(name.toUpperCase());
  if (card) {
    if (MODEL_TYPES[card.type] !== family) {
      fail(
        `${id}: model "${card.name}" is a ${card.type} model, not a ${FAMILY_NAMES[family]}`,
        line,
      );
    }
    return { card, type: card.type };
  }
  const type = name.toUpperCase();
  if (!keywords.includes(type)) fail(`${id}: unknown model "${name}"`, line);
  return { card: undefined, type };
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
    const { card } = resolveModel(id, rest[0], "diode", [], models, line);
    if (card) {
      comp.model = card.name;
      applyCard(comp, "diode", card);
    }
    rest = rest.slice(1);
  }
  if (rest.length > 1) fail(`${id}: unexpected "${rest[1] as string}"`, line);
  const area = rest[0] === undefined ? 1 : num(rest[0], `${id} area`, line);
  applyLineParams(comp, "diode", params, id, line);
  if (area !== 1) {
    if (!(area > 0)) fail(`${id}: area must be > 0`, line);
    comp.is = (comp.is ?? 1e-14) * area;
    if (comp.rs !== undefined) comp.rs /= area;
    if (comp.cjo !== undefined) comp.cjo *= area;
    if (comp.bv !== undefined) comp.ibv = (comp.ibv ?? 1e-3) * area;
  }
  return comp;
}

const BJT_KEYWORDS = ["NPN", "PNP"] as const;
const MOSFET_KEYWORDS = ["NMOS", "PMOS"] as const;

function parseBjt(
  id: string,
  p: string[],
  params: Map<string, string>,
  models: Models,
  line: number,
  warnings: string[],
): BjtJSON {
  if (p.length < 4) fail(`${id}: expected collector, base, emitter [substrate] model [area]`, line);
  const isModel = (w: string | undefined) =>
    w !== undefined &&
    (models.has(w.toUpperCase()) || (BJT_KEYWORDS as readonly string[]).includes(w.toUpperCase()));
  let at = 3;
  if (!isModel(p[3]) && isModel(p[4])) {
    at = 4;
    warnings.push(`Line ${line}: ${id}: substrate node "${p[3] as string}" ignored`);
  }
  const { card, type } = resolveModel(id, p[at] as string, "bjt", BJT_KEYWORDS, models, line);
  const comp: BjtJSON = {
    id,
    type: "bjt",
    nodes: [p[0] as string, p[1] as string, p[2] as string],
    polarity: type === "PNP" ? "pnp" : "npn",
  };
  if (card) {
    comp.model = card.name;
    applyCard(comp, "bjt", card);
  }
  const rest = p.slice(at + 1);
  if (rest.length > 1) fail(`${id}: unexpected "${rest[1] as string}"`, line);
  const area = rest[0] === undefined ? 1 : num(rest[0], `${id} area`, line);
  applyLineParams(comp, "bjt", params, id, line);
  if (area !== 1) {
    if (!(area > 0)) fail(`${id}: area must be > 0`, line);
    comp.is = (comp.is ?? 1e-16) * area;
    if (comp.cje !== undefined) comp.cje *= area;
    if (comp.cjc !== undefined) comp.cjc *= area;
  }
  return comp;
}

function parseMosfet(
  id: string,
  p: string[],
  params: Map<string, string>,
  models: Models,
  line: number,
  warnings: string[],
): MosfetJSON {
  if (p.length < 4) fail(`${id}: expected drain, gate, source [bulk] model`, line);
  const isModel = (w: string | undefined) =>
    w !== undefined &&
    (models.has(w.toUpperCase()) ||
      (MOSFET_KEYWORDS as readonly string[]).includes(w.toUpperCase()));
  // Without a bulk node (ElecMap extension), the bulk is tied to the source.
  const at = isModel(p[4]) || !isModel(p[3]) ? 4 : 3;
  if (p[at] === undefined) fail(`${id}: unknown model "${p[3] as string}"`, line);
  const { card, type } = resolveModel(id, p[at] as string, "mosfet", MOSFET_KEYWORDS, models, line);
  const [d, g, src] = [p[0] as string, p[1] as string, p[2] as string];
  const comp: MosfetJSON = {
    id,
    type: "mosfet",
    nodes: [d, g, src, at === 4 ? (p[3] as string) : src],
    polarity: type === "PMOS" ? "pmos" : "nmos",
  };
  if (card) {
    comp.model = card.name;
    applyCard(comp, "mosfet", card);
  }
  if (p.length > at + 1) fail(`${id}: unexpected "${p[at + 1] as string}"`, line);
  applyLineParams(
    comp,
    "mosfet",
    params,
    id,
    line,
    { W: "w", L: "l" },
    ["AD", "AS", "PD", "PS", "NRD", "NRS"],
    warnings,
  );
  return comp;
}

/** Element letter: first letter of the last `.`-separated part of the name. */
function elementLetter(id: string): string | undefined {
  return id.slice(id.lastIndexOf(".") + 1)[0]?.toUpperCase();
}

/**
 * `Bname n+ n- V=expression` or `I=expression` (braces optional). Parameters
 * are replaced by their values; probes and `time` stay.
 */
function parseBehavioral(
  text: string,
  line: number,
  params: ReadonlyMap<string, number>,
): ComponentJSON {
  const m = /^(\S+) (\S+) (\S+) ([VI])\s*=\s*(.+)$/i.exec(text);
  if (!m)
    fail(`${text.split(" ")[0] ?? "B"}: expected "B… n+ n- V=expression" or "I=expression"`, line);
  const [, id, p, n, kind, raw] = m as unknown as [string, string, string, string, string, string];
  let src = raw.trim();
  if (src.startsWith("{") && src.endsWith("}")) src = src.slice(1, -1);
  // Inner braces ("{IS}") are plain parentheses: parameters are resolved anyway.
  src = src.replace(/\{/g, "(").replace(/\}/g, ")");
  const err = (msg: string): never => fail(`${id}: ${msg}`, line);
  const tree = parseExpression(src, err, { probes: true });
  const resolved = resolveParameters(tree, params, (msg) => err(`in "${src}": ${msg}`), ["TIME"]);
  return {
    id,
    type: "bsource",
    nodes: [p, n],
    kind: kind.toUpperCase() === "V" ? "voltage" : "current",
    expression: formatExpression(resolved),
  };
}

function parseElement(
  text: string,
  line: number,
  models: Models = new Map(),
  warnings: string[] = [],
  scopeParams: ReadonlyMap<string, number> = new Map(),
): ComponentJSON {
  if (elementLetter(text.split(" ")[0] ?? "") === "B")
    return parseBehavioral(text, line, scopeParams);
  const tokens = tokenize(text, line);
  const first = tokens.shift();
  if (first?.kind !== "word") fail("expected an element name", line);
  const id = first.value;
  const letter = elementLetter(id);

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
    case "Q":
      return parseBjt(id, p, params, models, line, warnings);
    case "M":
      return parseMosfet(id, p, params, models, line, warnings);
    case "X": {
      const model = p[p.length - 1]?.toUpperCase();
      if (model !== "OPAMP") fail(`${id}: unknown subcircuit "${p[p.length - 1] ?? ""}"`, line);
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

/** A `.subckt` definition: its ports, default parameters and body lines. */
interface Subcircuit {
  name: string;
  ports: string[];
  /** Default parameters, in order (upper-case name, expression). */
  defaults: [string, string][];
  body: Line[];
  /** Line of the `.subckt` header. */
  line: number;
}

/** Everything element lines can refer to. */
interface Context {
  models: Models;
  subckts: ReadonlyMap<string, Subcircuit>;
  globals: ReadonlyMap<string, number>;
  isGround: (n: NodeName) => boolean;
  warnings: string[];
}

/** Where lines are expanded: the top level, or inside a subcircuit instance. */
interface Scope {
  /** Prefix of element ids and internal nodes (`""`, `"X1."`, `"X1.X2."`). */
  prefix: string;
  /** Maps a node name of this scope to its global name. */
  node: (n: NodeName) => NodeName;
  params: Map<string, number>;
  /** Subcircuits being expanded (to detect recursion). */
  stack: string[];
}

/** Expression → value, with parse errors on `line`. */
function evalParam(expr: string, params: ReadonlyMap<string, number>, line: number): number {
  const bare = expr.startsWith("{") && expr.endsWith("}") ? expr.slice(1, -1) : expr;
  return evaluate(bare, params, (m) => fail(m, line));
}

/** Replaces every `{expression}` of a line by its value. */
function substitute(text: string, params: ReadonlyMap<string, number>, line: number): string {
  return text.replace(/\{([^}]*)\}/g, (_, e: string) => String(evalParam(e, params, line)));
}

/** `K=v` pairs of a directive (`.param`, `.subckt` header), `PARAMS:` skipped. */
function directiveParams(ws: string[], line: number): [string, string][] {
  return ws
    .filter((w) => w.toUpperCase() !== "PARAMS:")
    .map((w) => {
      const eq = w.indexOf("=");
      if (eq <= 0) fail(`expected K=value, got "${w}"`, line);
      return [w.slice(0, eq).toUpperCase(), w.slice(eq + 1)];
    });
}

/** Renames a parsed element of a subcircuit into the global namespace. */
function relocate(c: ComponentJSON, scope: Scope): ComponentJSON {
  if (scope.prefix === "") return c;
  const r = { ...c, id: scope.prefix + c.id } as ComponentJSON & Record<string, unknown>;
  if ("nodes" in c) r.nodes = (c.nodes as NodeName[]).map(scope.node);
  if ("control" in c) r.control = c.control.map(scope.node);
  if ("controlSource" in c) r.controlSource = scope.prefix + c.controlSource;
  if ("inductors" in c) r.inductors = c.inductors.map((i) => scope.prefix + i);
  if (c.type === "bsource") {
    const tree = parseExpression(
      c.expression,
      (m) => {
        throw new ElecMapError("PARSE_ERROR", m);
      },
      { probes: true },
    );
    r.expression = formatExpression(renameProbes(tree, scope.node, (id) => scope.prefix + id));
  }
  return r;
}

/** Expands the element lines of a scope into `out`. */
function expand(lines: Line[], scope: Scope, ctx: Context, out: ComponentJSON[]): void {
  for (const l of lines) {
    const behavioral = elementLetter(l.text.split(" ")[0] ?? "") === "B";
    // A behavioural expression is parsed as a whole: its braces are not substituted.
    const text = behavioral ? l.text : substitute(l.text, scope.params, l.line);
    if (text.startsWith(".")) {
      // Only local directives reach here (top-level ones are handled by parseSpice).
      const [directive, ...rest] = text.split(" ");
      const d = (directive as string).toLowerCase();
      if (d === ".param") {
        for (const [k, v] of directiveParams(rest, l.line)) {
          scope.params.set(k, evalParam(v, scope.params, l.line));
        }
      } else if (d !== ".model") {
        ctx.warnings.push(`Line ${l.line}: directive ${directive} ignored`);
      }
      continue;
    }
    const id = text.split(" ")[0] as string;
    if (elementLetter(id) === "X") {
      const ws = words(tokenize(text, l.line), l.line).slice(1);
      const { positional, params } = splitParams(ws.filter((w) => w.toUpperCase() !== "PARAMS:"));
      const def = ctx.subckts.get((positional[positional.length - 1] ?? "").toUpperCase());
      if (def) {
        instantiate(id, def, positional.slice(0, -1), params, l.line, scope, ctx, out);
        continue;
      }
    }
    out.push(relocate(parseElement(text, l.line, ctx.models, ctx.warnings, scope.params), scope));
  }
}

/** Expands one `X` instance of a subcircuit. */
function instantiate(
  id: string,
  def: Subcircuit,
  nodes: string[],
  overrides: ReadonlyMap<string, string>,
  line: number,
  scope: Scope,
  ctx: Context,
  out: ComponentJSON[],
): void {
  const key = def.name.toUpperCase();
  if (nodes.length !== def.ports.length) {
    fail(
      `${id}: subcircuit ${def.name} has ${def.ports.length} ports (${def.ports.join(" ")}), got ${nodes.length} nodes`,
      line,
    );
  }
  if (scope.stack.includes(key)) {
    fail(`${id}: recursive subcircuit ${[...scope.stack, key].join(" → ")}`, line);
  }
  // Instance values are evaluated in the caller's scope, defaults in the subcircuit's.
  const values = new Map<string, number>();
  for (const [k, v] of overrides) {
    if (!def.defaults.some(([d]) => d === k)) {
      fail(`${id}: subcircuit ${def.name} has no parameter ${k}`, line);
    }
    values.set(k, evalParam(v, scope.params, line));
  }
  const params = new Map(ctx.globals);
  for (const [k, v] of def.defaults) params.set(k, values.get(k) ?? evalParam(v, params, line));

  const actual = nodes.map(scope.node);
  const ports = new Map(def.ports.map((p, i) => [p, actual[i] as NodeName]));
  const prefix = scope.prefix + id + ".";
  const node = (n: NodeName): NodeName => ports.get(n) ?? (ctx.isGround(n) ? n : prefix + n);
  expand(def.body, { prefix, node, params, stack: [...scope.stack, key] }, ctx, out);
}

/** Separates `.subckt` … `.ends` blocks from the top-level lines. */
function splitSubcircuits(lines: Line[]): { top: Line[]; subckts: Map<string, Subcircuit> } {
  const top: Line[] = [];
  const subckts = new Map<string, Subcircuit>();
  let current: Subcircuit | undefined;
  for (const l of lines) {
    const d = (l.text.split(" ")[0] as string).toLowerCase();
    if (d === ".end" && !current) {
      top.push(l);
      break;
    }
    if (d === ".subckt") {
      if (current) {
        throw new ElecMapError(
          "UNSUPPORTED",
          `Line ${l.line}: .subckt inside .subckt ${current.name} is not supported (define it at top level)`,
          { line: l.line },
        );
      }
      const ws = l.text.split(" ").slice(1);
      const name = ws.shift();
      if (name === undefined) fail(".subckt without a name", l.line);
      const firstParam = ws.findIndex((w) => w.includes("=") || w.toUpperCase() === "PARAMS:");
      const ports = firstParam === -1 ? ws : ws.slice(0, firstParam);
      const defaults = firstParam === -1 ? [] : directiveParams(ws.slice(firstParam), l.line);
      if (subckts.has(name.toUpperCase())) fail(`duplicate subcircuit "${name}"`, l.line);
      if (new Set(ports).size !== ports.length) fail(`${name}: duplicate port`, l.line);
      current = { name, ports, defaults, body: [], line: l.line };
      subckts.set(name.toUpperCase(), current);
      continue;
    }
    if (d === ".ends") {
      if (!current) fail(".ends without .subckt", l.line);
      current = undefined;
      continue;
    }
    (current ? current.body : top).push(l);
  }
  if (current) fail(`.subckt ${current.name} is missing its .ends`, current.line);
  return { top, subckts };
}

/** True if the line parses as a valid element (used to detect a SPICE title line). */
function looksLikeElement(l: Line, ctx: Context): boolean {
  if (l.text.startsWith(".")) return false;
  try {
    const scope: Scope = { prefix: "", node: (n) => n, params: new Map(ctx.globals), stack: [] };
    expand([l], scope, { ...ctx, warnings: [] }, []);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parses a SPICE netlist into the canonical {@link CircuitJSON} format.
 * Subcircuits are flattened (see the module documentation).
 *
 * @throws {@link ElecMapError} `PARSE_ERROR` (with `details.line`) or `UNSUPPORTED`
 */
export function parseSpice(source: string, options: SpiceParseOptions = {}): SpiceParseResult {
  const all = logicalLines(source);
  // Expressions may contain spaces: "{2 * R}" → "{2*R}".
  for (const l of all) l.text = l.text.replace(/\{[^}]*\}/g, (m) => m.replace(/\s+/g, ""));
  const warnings: string[] = [];
  const circuit: CircuitJSON = { version: FORMAT_VERSION, components: [] };
  if (options.ground !== undefined) circuit.ground = options.ground;

  const titleMode = options.titleLine ?? "auto";
  let title: Line | undefined;
  if (titleMode === true && all.length > 0) title = all.shift();
  const { top, subckts } = splitSubcircuits(all);

  // Model cards and global parameters first: elements may use them further down.
  const models = new Map<string, ModelCard>();
  const globals = new Map<string, number>();
  const scan = [...top, ...[...subckts.values()].flatMap((s) => s.body)];
  for (const l of scan) {
    if (!/^\.model\b/i.test(l.text)) continue;
    const card = parseModel(l.text, l.line, warnings);
    const key = card.name.toUpperCase();
    if (models.has(key)) fail(`duplicate model "${card.name}"`, l.line);
    models.set(key, card);
  }
  for (const l of top) {
    if (/^\.end\b/i.test(l.text)) break;
    if (!/^\.param\b/i.test(l.text)) continue;
    for (const [k, v] of directiveParams(l.text.split(" ").slice(1), l.line)) {
      globals.set(k, evalParam(v, globals, l.line));
    }
  }

  const ground = options.ground ?? "0";
  const ctx: Context = {
    models,
    subckts,
    globals,
    isGround: (n) => n === ground || GROUND_ALIASES.includes(n),
    warnings,
  };
  const first = top[0];
  if (
    titleMode === "auto" &&
    first &&
    !first.text.startsWith(".") &&
    !looksLikeElement(first, ctx)
  ) {
    title = top.shift();
  }
  if (title) circuit.title = title.text;

  const elements: Line[] = [];
  for (const l of top) {
    if (!l.text.startsWith(".")) {
      elements.push(l);
      continue;
    }
    const [directive, ...rest] = l.text.split(" ");
    const d = (directive as string).toLowerCase();
    if (d === ".end") break;
    if (d === ".title") circuit.title = rest.join(" ");
    else if (d !== ".model" && d !== ".param") {
      warnings.push(`Line ${l.line}: directive ${directive} ignored`);
    }
  }
  const scope: Scope = { prefix: "", node: (n) => n, params: new Map(globals), stack: [] };
  expand(elements, scope, ctx, circuit.components);
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

type Device = DiodeJSON | BjtJSON | MosfetJSON;

/** `.model` type of a device. */
function modelType(c: Device): string {
  return c.type === "diode" ? "D" : c.polarity.toUpperCase();
}

/** `KEY=value` list of the model fields of `c` that differ from `card`. */
function paramsText(c: Device, card: DeviceCard["values"] = {}): string[] {
  const values = c as unknown as Record<string, number | undefined>;
  return FAMILY_PARAMS[c.type]
    .filter(([field]) => values[field] !== undefined && values[field] !== card[field])
    .map(([field, key]) => `${key}=${formatSpice(values[field] as number)}`);
}

/** Model cards of the devices, by model name (parameters of the first device using it). */
function deviceCards(circuit: CircuitJSON): Map<string, DeviceCard> {
  const cards = new Map<string, DeviceCard>();
  for (const c of circuit.components) {
    if (c.type !== "diode" && c.type !== "bjt" && c.type !== "mosfet") continue;
    if (c.model === undefined || cards.has(c.model)) continue;
    const values = c as unknown as Record<string, number | undefined>;
    const card: DeviceCard = { type: modelType(c), values: {} };
    for (const [field] of FAMILY_PARAMS[c.type])
      if (values[field] !== undefined) card.values[field] = values[field];
    cards.set(c.model, card);
  }
  return cards;
}

/** Model reference and parameters of a device line. */
function deviceText(c: Device, cards: ReadonlyMap<string, DeviceCard>): string[] {
  const card = c.model === undefined ? undefined : cards.get(c.model);
  const usable = card && card.type === modelType(c) ? card : undefined;
  const name = usable ? [c.model as string] : c.type === "diode" ? [] : [modelType(c)];
  return [...name, ...paramsText(c, usable?.values)];
}

/**
 * Serialises one component as a SPICE line. A diode refers to its `model` when
 * `cards` holds it (as written by {@link toSpice}); parameters that differ from
 * the card are written on the line.
 */
export function componentToSpice(
  c: ComponentJSON,
  cards: ReadonlyMap<string, DeviceCard> = new Map(),
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
    case "bsource":
      return `${c.id} ${c.nodes.join(" ")} ${c.kind === "voltage" ? "V" : "I"}=${c.expression}`;
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
    case "diode":
    case "bjt":
      return [c.id, ...c.nodes, ...deviceText(c, cards)].join(" ");
    case "mosfet": {
      const [model, ...rest] = deviceText(c, cards);
      return [
        c.id,
        ...c.nodes,
        model as string,
        ...(c.w === undefined ? [] : [`W=${formatSpice(c.w)}`]),
        ...(c.l === undefined ? [] : [`L=${formatSpice(c.l)}`]),
        ...rest,
      ].join(" ");
    }
  }
}

/** Serialises a circuit as a SPICE netlist (`.title` first, `.end` last). */
export function toSpice(circuit: CircuitJSON): string {
  const lines = [circuit.title === undefined ? "* ElecMap circuit" : `.title ${circuit.title}`];
  const cards = deviceCards(circuit);
  for (const c of circuit.components) lines.push(componentToSpice(c, cards));
  for (const [name, card] of cards) {
    const family = MODEL_TYPES[card.type] as Family;
    const list = FAMILY_PARAMS[family]
      .filter(([f]) => card.values[f] !== undefined)
      .map(([f, key]) => `${key}=${formatSpice(card.values[f] as number)}`);
    lines.push(`.model ${name} ${card.type}${list.length ? `(${list.join(" ")})` : ""}`);
  }
  lines.push(".end");
  return lines.join("\n") + "\n";
}

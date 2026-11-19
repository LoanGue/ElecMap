/**
 * Conversions between the exchange formats of a circuit.
 *
 * The canonical JSON document is the hub: each format has one function that
 * reads it into JSON and one that writes it from JSON. Converting between two
 * other formats goes through JSON (`jsonToNetlist(base64ToJSON(text))`), so n
 * formats need 2n functions instead of n(n − 1).
 *
 * @module
 */
import { ElecMapError } from "../core/errors";
import { parseSpice, toSpice } from "./spice";
import type { SpiceParseOptions } from "./spice";
import type { CircuitJSON } from "./types";

/**
 * Exchange format of a circuit:
 *
 * - `"json"`: the canonical {@link CircuitJSON} document (an object, or its text on input);
 * - `"netlist"`: SPICE netlist text;
 * - `"base64"`: the compact JSON text in URL-safe base64, a single token without
 *   spaces that fits in a URL, a query parameter or a message.
 */
export type CircuitFormat = "json" | "netlist" | "base64";

/** Every supported format. */
export const CIRCUIT_FORMATS: readonly CircuitFormat[] = ["json", "netlist", "base64"];

/** A document read from some format: still unvalidated, plus parser remarks. */
interface Read {
  doc: unknown;
  warnings: string[];
}

// ------------------------------------------------------------------- JSON

function jsonToJSON(input: unknown): Read {
  if (typeof input !== "string") return { doc: input, warnings: [] };
  try {
    return { doc: JSON.parse(input), warnings: [] };
  } catch (e) {
    throw new ElecMapError("PARSE_ERROR", `Invalid JSON: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------- netlist

function netlistToJSON(input: unknown, spice: SpiceParseOptions): Read {
  const parsed = parseSpice(text(input, "netlist"), spice);
  return { doc: parsed.circuit, warnings: parsed.warnings };
}

function jsonToNetlist(doc: CircuitJSON): string {
  return toSpice(doc);
}

// ----------------------------------------------------------------- base64

/** URL-safe base64 alphabet, padding optional. */
const BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

function base64ToJSON(input: unknown): Read {
  const token = text(input, "base64").trim();
  if (!BASE64.test(token)) throw new ElecMapError("PARSE_ERROR", "Invalid base64 circuit");
  let json: string;
  try {
    const b64 = token.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ElecMapError("PARSE_ERROR", "Invalid base64 circuit");
  }
  return jsonToJSON(json);
}

function jsonToBase64(doc: CircuitJSON): string {
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ------------------------------------------------------------------- hub

function text(input: unknown, format: CircuitFormat): string {
  if (typeof input !== "string") {
    throw new ElecMapError("INVALID_ARGUMENT", `A ${format} circuit must be a string`);
  }
  return input;
}

const READERS: Record<CircuitFormat, (input: unknown, spice: SpiceParseOptions) => Read> = {
  json: jsonToJSON,
  netlist: netlistToJSON,
  base64: base64ToJSON,
};

const WRITERS: { [F in CircuitFormat]: (doc: CircuitJSON) => FormatOutput[F] } = {
  json: (doc) => doc,
  netlist: jsonToNetlist,
  base64: jsonToBase64,
};

/** Value produced by each format: the JSON document is an object, the others are text. */
export interface FormatOutput {
  json: CircuitJSON;
  netlist: string;
  base64: string;
}

function checkFormat(format: unknown): asserts format is CircuitFormat {
  if (!CIRCUIT_FORMATS.includes(format as CircuitFormat)) {
    throw new ElecMapError(
      "INVALID_ARGUMENT",
      `Unknown circuit format "${String(format)}" (expected ${CIRCUIT_FORMATS.join(", ")})`,
    );
  }
}

/**
 * Guesses the format of an input: an object is JSON, text starting with `{` is
 * JSON text, a single token without whitespace is base64 (a netlist line always
 * has spaces between its fields), anything else is a netlist.
 */
export function detectFormat(input: unknown): CircuitFormat {
  if (typeof input !== "string") return "json";
  const t = input.trim();
  if (t.startsWith("{")) return "json";
  if (t !== "" && !/\s/.test(t) && BASE64.test(t)) return "base64";
  return "netlist";
}

/**
 * Reads a circuit from any format into an (unvalidated) JSON document.
 * @internal Used by {@link compile}.
 */
export function readCircuit(
  input: unknown,
  format: CircuitFormat = detectFormat(input),
  spice: SpiceParseOptions = {},
): Read {
  checkFormat(format);
  return READERS[format](input, spice);
}

/**
 * Writes a JSON document in any format.
 *
 * @example
 * ```ts
 * writeCircuit({ version: 1, components: [...] }, "base64"); // "eyJ2ZXJzaW9uIjox…"
 * ```
 */
export function writeCircuit<F extends CircuitFormat>(
  doc: CircuitJSON,
  format: F,
): FormatOutput[F] {
  checkFormat(format);
  return WRITERS[format](doc);
}

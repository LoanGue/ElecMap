import { ElecMapError } from "./errors";
import { parseSpice } from "../format/spice";
import type { SpiceParseOptions } from "../format/spice";
import { toSpice } from "../format/spice";
import type { CircuitJSON, ComponentJSON, NodeName } from "../format/types";
import { FORMAT_VERSION } from "../format/types";
import { GROUND_ALIASES, validateCircuit } from "../format/validate";
import type { ValidationIssue } from "../format/validate";

/** Options for {@link compile}. */
export interface CompileOptions {
  /** Ground node name (default: the document's `ground`, else `"0"`). `gnd`/`GND` are aliases. */
  ground?: NodeName;
  /** SPICE parser options (only used for netlist input). */
  spice?: Omit<SpiceParseOptions, "ground">;
}

/** Accepted circuit inputs: SPICE netlist text, JSON text, or a {@link CircuitJSON} object. */
export type CircuitInput = string | CircuitJSON;

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/**
 * A validated, normalised and indexed circuit — the machine-readable compiled
 * form consumed by every analysis.
 *
 * - Ground aliases are rewritten to the ground name.
 * - Non-ground nodes are indexed `0 … n−1` in order of first appearance.
 * - The underlying document is deeply frozen.
 */
export class CompiledCircuit {
  /** Normalised, frozen circuit document. */
  readonly document: Readonly<CircuitJSON>;
  /** Name of the ground node. */
  readonly ground: NodeName;
  /** Non-ground node names, in index order. */
  readonly nodes: readonly NodeName[];
  /** Non-fatal issues found during validation. */
  readonly warnings: readonly ValidationIssue[];
  /** Raw parser remarks (ignored directives…). */
  readonly parserWarnings: readonly string[];

  private readonly index: ReadonlyMap<NodeName, number>;
  private readonly byId: ReadonlyMap<string, ComponentJSON>;

  /** @internal Use {@link compile}. */
  constructor(document: CircuitJSON, warnings: ValidationIssue[], parserWarnings: string[] = []) {
    const ground = document.ground ?? "0";
    const g = (n: NodeName) => (n === ground || GROUND_ALIASES.includes(n) ? ground : n);
    const normalised = deepCopy(document);
    normalised.ground = ground;
    const index = new Map<NodeName, number>();
    const nodes: NodeName[] = [];
    const visit = (n: NodeName) => {
      if (n !== ground && !index.has(n)) {
        index.set(n, nodes.length);
        nodes.push(n);
      }
    };
    for (const c of normalised.components) {
      if (c.type === "coupling") continue;
      c.nodes = c.nodes.map(g) as typeof c.nodes;
      if (c.type === "vcvs" || c.type === "vccs")
        c.control = c.control.map(g) as [NodeName, NodeName];
      c.nodes.forEach(visit);
    }
    this.document = deepFreeze(normalised);
    this.ground = ground;
    this.nodes = Object.freeze(nodes);
    this.index = index;
    this.byId = new Map(this.document.components.map((c) => [c.id, c]));
    this.warnings = Object.freeze([...warnings]);
    this.parserWarnings = Object.freeze([...parserWarnings]);
  }

  /** Circuit title, if any. */
  get title(): string | undefined {
    return this.document.title;
  }

  /** All components, in document order. */
  get components(): readonly ComponentJSON[] {
    return this.document.components;
  }

  /** Number of non-ground nodes. */
  get nodeCount(): number {
    return this.nodes.length;
  }

  /** True if the node exists (ground and its aliases included). */
  hasNode(name: NodeName): boolean {
    return this.isGround(name) || this.index.has(name);
  }

  /** True if the name designates the ground node. */
  isGround(name: NodeName): boolean {
    return name === this.ground || GROUND_ALIASES.includes(name);
  }

  /**
   * Index of a node in the MNA unknown vector, `-1` for ground.
   * @throws {@link ElecMapError} `NOT_FOUND`
   */
  nodeIndex(name: NodeName): number {
    if (this.isGround(name)) return -1;
    const i = this.index.get(name);
    if (i === undefined) {
      throw new ElecMapError("NOT_FOUND", `Unknown node "${name}"`, { node: name });
    }
    return i;
  }

  /** True if a component with this id exists. */
  hasComponent(id: string): boolean {
    return this.byId.has(id);
  }

  /**
   * Returns a component by id.
   * @throws {@link ElecMapError} `NOT_FOUND`
   */
  component(id: string): ComponentJSON {
    const c = this.byId.get(id);
    if (!c) throw new ElecMapError("NOT_FOUND", `Unknown component "${id}"`, { componentId: id });
    return c;
  }

  /** Mutable deep copy of the canonical JSON document. */
  toJSON(): CircuitJSON {
    return deepCopy(this.document) as CircuitJSON;
  }

  /** SPICE netlist of the circuit. */
  toSpice(): string {
    return toSpice(this.document as CircuitJSON);
  }
}

/**
 * Parses (if needed), validates and indexes a circuit.
 *
 * - A string starting with `{` is parsed as JSON, any other string as a SPICE netlist.
 * - An object is taken as a {@link CircuitJSON} document.
 *
 * @throws {@link ElecMapError} `PARSE_ERROR`, `UNSUPPORTED`, or `INVALID_CIRCUIT`
 *   (with `details.issues: ValidationIssue[]`).
 */
export function compile(input: CircuitInput, options: CompileOptions = {}): CompiledCircuit {
  let doc: unknown;
  let parserWarnings: string[] = [];
  if (typeof input === "string") {
    if (input.trimStart().startsWith("{")) {
      try {
        doc = JSON.parse(input);
      } catch (e) {
        throw new ElecMapError("PARSE_ERROR", `Invalid JSON: ${(e as Error).message}`);
      }
    } else {
      const parsed = parseSpice(input, { ...options.spice });
      doc = parsed.circuit;
      parserWarnings = parsed.warnings;
    }
  } else {
    doc = input;
  }

  const docGround =
    typeof doc === "object" && doc !== null && typeof (doc as CircuitJSON).ground === "string"
      ? (doc as CircuitJSON).ground
      : undefined;
  const ground = options.ground ?? docGround ?? "0";
  const issues = validateCircuit(doc, ground);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    const summary = errors.map((e) => e.message).join("; ");
    throw new ElecMapError("INVALID_CIRCUIT", `Invalid circuit: ${summary}`, { issues });
  }
  const circuit = doc as CircuitJSON;
  const version = circuit.version ?? FORMAT_VERSION;
  if (version > FORMAT_VERSION) {
    throw new ElecMapError(
      "UNSUPPORTED",
      `Format version ${version} is newer than supported (${FORMAT_VERSION})`,
    );
  }
  return new CompiledCircuit(
    { ...circuit, version, ground },
    issues.filter((i) => i.severity === "warning"),
    parserWarnings,
  );
}

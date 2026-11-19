import { COMPONENT_CATALOG } from "./catalog";
import type { NumberConstraint } from "./catalog";
import type { ComponentJSON, NodeName } from "./types";

/** Severity of a {@link ValidationIssue}. Errors prevent compilation. */
export type IssueSeverity = "error" | "warning";

/** Machine-readable validation issue codes. */
export type IssueCode =
  | "MALFORMED"
  | "UNKNOWN_TYPE"
  | "DUPLICATE_ID"
  | "INVALID_VALUE"
  | "INVALID_NODES"
  | "UNKNOWN_REFERENCE"
  | "EMPTY_CIRCUIT"
  | "NO_GROUND"
  | "FLOATING_NODE"
  | "NO_DC_PATH"
  | "VOLTAGE_SOURCE_LOOP"
  | "INDUCTOR_LOOP"
  | "SHORTED_COMPONENT"
  | "DANGLING_NODE";

/** A problem found while validating a circuit. */
export interface ValidationIssue {
  severity: IssueSeverity;
  code: IssueCode;
  message: string;
  /** Component concerned, if any. */
  componentId?: string;
  /** Node concerned, if any. */
  node?: NodeName;
}

/** Node names always treated as ground, in addition to the configured ground name. */
export const GROUND_ALIASES: readonly string[] = ["0", "gnd", "GND"];

class UnionFind {
  private readonly parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  /** Joins two sets; returns false if they were already joined. */
  union(a: string, b: string): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.parent.set(ra, rb);
    return true;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function checkNumber(value: unknown, constraint: NumberConstraint): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return "must be a finite number";
  if (constraint === "positive" && !(value > 0)) return "must be > 0";
  if (constraint === "nonNegative" && !(value >= 0)) return "must be ≥ 0";
  if (constraint === "coupling" && !(value > 0 && value <= 1)) return "must be in (0, 1]";
  if (constraint === "fraction" && !(value >= 0 && value < 1)) return "must be in [0, 1)";
  return undefined;
}

/** Structural checks of a single component (shape, node count, numeric fields). */
function checkComponent(c: unknown, index: number, issues: ValidationIssue[]): c is ComponentJSON {
  const err = (code: IssueCode, message: string, componentId?: string) =>
    issues.push({ severity: "error", code, message, ...(componentId ? { componentId } : {}) });
  if (!isRecord(c)) {
    err("MALFORMED", `components[${index}] must be an object`);
    return false;
  }
  const id = c["id"];
  if (typeof id !== "string" || id === "") {
    err("MALFORMED", `components[${index}] needs a non-empty string "id"`);
    return false;
  }
  const type = c["type"];
  const spec =
    typeof type === "string" && Object.prototype.hasOwnProperty.call(COMPONENT_CATALOG, type)
      ? COMPONENT_CATALOG[type as keyof typeof COMPONENT_CATALOG]
      : undefined;
  if (!spec) {
    err("UNKNOWN_TYPE", `${id}: unknown component type "${String(c["type"])}"`, id);
    return false;
  }
  let ok = true;
  if (spec.type === "coupling") {
    const l = c["inductors"];
    if (!Array.isArray(l) || l.length !== 2 || !l.every((x) => typeof x === "string")) {
      err("MALFORMED", `${id}: "inductors" must be an array of two inductor ids`, id);
      ok = false;
    }
  } else {
    const nodes = c["nodes"];
    if (
      !Array.isArray(nodes) ||
      nodes.length !== spec.ports.length ||
      !nodes.every((n) => typeof n === "string" && n !== "")
    ) {
      err(
        "INVALID_NODES",
        `${id}: "nodes" must list ${spec.ports.length} node names (${spec.ports.join(", ")})`,
        id,
      );
      ok = false;
    }
  }
  if (spec.control) {
    const ctrl = c["control"];
    if (!Array.isArray(ctrl) || ctrl.length !== 2 || !ctrl.every((n) => typeof n === "string")) {
      err("INVALID_NODES", `${id}: "control" must list 2 node names`, id);
      ok = false;
    }
  }
  if (spec.type === "cccs" || spec.type === "ccvs") {
    if (typeof c["controlSource"] !== "string") {
      err("MALFORMED", `${id}: "controlSource" must be the id of a voltage source`, id);
      ok = false;
    }
  }
  const polarities =
    spec.type === "bjt" ? ["npn", "pnp"] : spec.type === "mosfet" ? ["nmos", "pmos"] : undefined;
  if (polarities && !polarities.includes(c["polarity"] as string)) {
    err("MALFORMED", `${id}: "polarity" must be "${polarities.join('" or "')}"`, id);
    ok = false;
  }
  if ((spec.type === "bjt" || spec.type === "mosfet") && c["model"] !== undefined) {
    if (typeof c["model"] !== "string") {
      err("MALFORMED", `${id}: "model" must be a string`, id);
      ok = false;
    }
  }
  if (spec.type === "switch" && typeof c["closed"] !== "boolean") {
    err("MALFORMED", `${id}: "closed" must be a boolean`, id);
    ok = false;
  }
  for (const [field, [required, constraint]] of Object.entries(spec.numbers)) {
    const v = c[field];
    if (v === undefined) {
      if (required) {
        err("INVALID_VALUE", `${id}: "${field}" is required`, id);
        ok = false;
      }
      continue;
    }
    const problem = checkNumber(v, constraint);
    if (problem) {
      err("INVALID_VALUE", `${id}: "${field}" ${problem}`, id);
      ok = false;
    }
  }
  if (spec.type === "vsource" || spec.type === "isource") {
    const ac = c["ac"];
    if (ac !== undefined && (!isRecord(ac) || checkNumber(ac["mag"], "any"))) {
      err("INVALID_VALUE", `${id}: "ac.mag" must be a finite number`, id);
      ok = false;
    }
    const w = c["waveform"];
    if (w !== undefined && (!isRecord(w) || typeof w["kind"] !== "string")) {
      err("MALFORMED", `${id}: "waveform" must be an object with a "kind"`, id);
      ok = false;
    }
  }
  return ok;
}

/** Electrical nodes a component connects to (control ports excluded). */
function terminals(c: ComponentJSON): NodeName[] {
  return c.type === "coupling" ? [] : [...c.nodes];
}

/**
 * Validates a circuit document and returns every issue found (errors and warnings).
 * Ground aliases (`0`, `gnd`, `GND`) are recognised; pass `ground` to use another name.
 */
export function validateCircuit(input: unknown, ground = "0"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (code: IssueCode, message: string, extra: Partial<ValidationIssue> = {}) =>
    issues.push({ severity: "error", code, message, ...extra });
  const warn = (code: IssueCode, message: string, extra: Partial<ValidationIssue> = {}) =>
    issues.push({ severity: "warning", code, message, ...extra });

  if (!isRecord(input) || !Array.isArray(input["components"])) {
    error("MALFORMED", `Circuit must be an object with a "components" array`);
    return issues;
  }
  const raw = input["components"] as unknown[];
  const components = raw.filter((c, i): c is ComponentJSON => checkComponent(c, i, issues));
  if (raw.length === 0) {
    error("EMPTY_CIRCUIT", "Circuit has no components");
    return issues;
  }
  if (issues.some((i) => i.severity === "error")) return issues;

  const isGround = (n: NodeName) => n === ground || GROUND_ALIASES.includes(n);
  const g = (n: NodeName) => (isGround(n) ? ground : n);

  // Unique ids.
  const byId = new Map<string, ComponentJSON>();
  for (const c of components) {
    if (byId.has(c.id))
      error("DUPLICATE_ID", `Duplicate component id "${c.id}"`, { componentId: c.id });
    byId.set(c.id, c);
  }

  // References.
  for (const c of components) {
    if (c.type === "cccs" || c.type === "ccvs") {
      if (byId.get(c.controlSource)?.type !== "vsource") {
        error(
          "UNKNOWN_REFERENCE",
          `${c.id}: controlling source "${c.controlSource}" must be an existing voltage source`,
          { componentId: c.id },
        );
      }
    }
    if (c.type === "coupling") {
      const [a, b] = c.inductors;
      for (const l of [a, b]) {
        if (byId.get(l)?.type !== "inductor") {
          error("UNKNOWN_REFERENCE", `${c.id}: "${l}" is not an inductor`, { componentId: c.id });
        }
      }
      if (a === b)
        error("UNKNOWN_REFERENCE", `${c.id}: cannot couple an inductor with itself`, {
          componentId: c.id,
        });
    }
  }

  // Node usage.
  const usage = new Map<NodeName, number>();
  for (const c of components)
    for (const n of terminals(c)) usage.set(g(n), (usage.get(g(n)) ?? 0) + 1);
  if (!usage.has(ground)) {
    error("NO_GROUND", `No component is connected to the ground node "${ground}"`);
    return issues;
  }
  for (const c of components) {
    if (c.type === "vcvs" || c.type === "vccs") {
      for (const n of c.control) {
        if (!usage.has(g(n))) {
          error("UNKNOWN_REFERENCE", `${c.id}: control node "${n}" is not connected to anything`, {
            componentId: c.id,
            node: n,
          });
        }
      }
    }
    if (
      c.type !== "coupling" &&
      c.type !== "opamp" &&
      c.type !== "bjt" &&
      c.type !== "mosfet" &&
      c.nodes[0] !== undefined &&
      g(c.nodes[0]) === g(c.nodes[1])
    ) {
      warn("SHORTED_COMPONENT", `${c.id} has both terminals on node "${c.nodes[0]}"`, {
        componentId: c.id,
      });
    }
  }
  for (const [node, count] of usage) {
    if (count === 1 && node !== ground) {
      warn("DANGLING_NODE", `Node "${node}" is connected to a single terminal`, { node });
    }
  }

  // Connectivity (any path) and DC connectivity (no capacitors / current sources).
  const any = new UnionFind();
  const dc = new UnionFind();
  for (const c of components) {
    switch (c.type) {
      case "coupling":
        break;
      case "opamp":
        any.union(g(c.nodes[2]), ground);
        dc.union(g(c.nodes[2]), ground);
        break;
      case "bjt":
        for (const n of [c.nodes[0], c.nodes[2]]) {
          any.union(g(c.nodes[1]), g(n));
          dc.union(g(c.nodes[1]), g(n));
        }
        break;
      case "mosfet":
        // Channel (drain-source) conducts in DC; the gate is capacitive only.
        any.union(g(c.nodes[0]), g(c.nodes[2]));
        dc.union(g(c.nodes[0]), g(c.nodes[2]));
        any.union(g(c.nodes[1]), g(c.nodes[2]));
        any.union(g(c.nodes[3]), g(c.nodes[2]));
        break;
      case "switch":
        if (c.closed || c.roff !== undefined) {
          any.union(g(c.nodes[0]), g(c.nodes[1]));
          dc.union(g(c.nodes[0]), g(c.nodes[1]));
        }
        break;
      case "capacitor":
      case "isource":
      case "vccs":
      case "cccs":
        any.union(g(c.nodes[0]), g(c.nodes[1]));
        break;
      default:
        any.union(g(c.nodes[0]), g(c.nodes[1]));
        dc.union(g(c.nodes[0]), g(c.nodes[1]));
    }
  }
  for (const node of usage.keys()) {
    if (any.find(node) !== any.find(ground)) {
      error("FLOATING_NODE", `Node "${node}" has no path to ground`, { node });
    } else if (dc.find(node) !== dc.find(ground)) {
      warn("NO_DC_PATH", `Node "${node}" has no DC path to ground (DC analysis is ill-defined)`, {
        node,
      });
    }
  }

  // Loops of ideal voltage-defined branches.
  const vloop = new UnionFind();
  const voltageDefined: ComponentJSON[] = [];
  const inductive: ComponentJSON[] = [];
  for (const c of components) {
    if (c.type === "vsource" || c.type === "vcvs" || c.type === "ccvs") voltageDefined.push(c);
    else if (c.type === "switch" && c.closed && !c.ron) voltageDefined.push(c);
    else if (c.type === "inductor") inductive.push(c);
  }
  for (const c of voltageDefined) {
    const [a, b] = terminals(c) as [NodeName, NodeName];
    if (!vloop.union(g(a), g(b))) {
      error(
        "VOLTAGE_SOURCE_LOOP",
        `${c.id} closes a loop made only of voltage sources / ideal shorts`,
        {
          componentId: c.id,
        },
      );
    }
  }
  for (const c of inductive) {
    const [a, b] = terminals(c) as [NodeName, NodeName];
    if (!vloop.union(g(a), g(b))) {
      warn(
        "INDUCTOR_LOOP",
        `${c.id} closes a loop of inductors / voltage sources (singular in DC)`,
        {
          componentId: c.id,
        },
      );
    }
  }
  return issues;
}

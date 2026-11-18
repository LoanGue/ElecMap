import { compile } from "./core/circuit";
import type { CircuitInput, CompileOptions, CompiledCircuit } from "./core/circuit";
import { ElecMapError } from "./core/errors";
import type { CircuitJSON, ComponentJSON, NodeName } from "./format/types";
import type { Complex } from "./math/complex";
import { MnaSystem } from "./mna/system";
import { operatingPoint } from "./analysis/dc";
import type { DcOptions } from "./analysis/dc";
import { acAnalysis, acSweep } from "./analysis/ac";
import type { AcExcitation, AcSweep, AcSweepOptions } from "./analysis/ac";
import type { AcSolution, DcSolution } from "./analysis/solution";

/** Analysis point for {@link ElecMap.voltage} / {@link ElecMap.current}. */
export type AnalysisPoint = "dc" | ({ freq: number } & AcExcitation);

/**
 * Main entry point: a circuit plus every analysis available on it.
 *
 * ```ts
 * const c = new ElecMap(`
 *   V1 in 0 DC 5 AC 1
 *   R1 in out 1k
 *   C1 out 0 100n
 * `);
 * c.voltage("out");                  // DC: 5 V
 * c.voltage("out", { freq: 1591.5 }); // AC phasor ≈ 0.707∠−45°
 * c.current("R1", "dc");
 * ```
 *
 * The class is designed to be extended: the compiled circuit and the MNA
 * system are exposed to subclasses, and results are cached until the circuit
 * changes (see {@link ElecMap.setValue}).
 */
export class ElecMap {
  /** Validated, immutable circuit. */
  protected compiled: CompiledCircuit;
  private readonly options: CompileOptions;
  private systemCache: MnaSystem | undefined;
  private dcCache: DcSolution | undefined;

  constructor(input: CircuitInput, options: CompileOptions = {}) {
    this.options = options;
    this.compiled = compile(input, options);
  }

  /** Builds a circuit from a SPICE netlist. */
  static fromSpice(netlist: string, options: CompileOptions = {}): ElecMap {
    return new this(netlist, options);
  }

  /** Builds a circuit from a canonical JSON document. */
  static fromJSON(document: CircuitJSON | string, options: CompileOptions = {}): ElecMap {
    return new this(
      typeof document === "string" ? (JSON.parse(document) as CircuitJSON) : document,
      options,
    );
  }

  // ---------------------------------------------------------------- structure

  /** Compiled circuit (nodes, components, warnings). */
  get circuit(): CompiledCircuit {
    return this.compiled;
  }

  /** MNA system, built lazily and cached. */
  get system(): MnaSystem {
    return (this.systemCache ??= new MnaSystem(this.compiled));
  }

  /** Circuit title, if any. */
  get title(): string | undefined {
    return this.compiled.title;
  }

  /** Non-ground node names. */
  nodes(): string[] {
    return [...this.compiled.nodes];
  }

  /** All components. */
  components(): ComponentJSON[] {
    return this.compiled.toJSON().components;
  }

  /** Canonical JSON document. */
  toJSON(): CircuitJSON {
    return this.compiled.toJSON();
  }

  /** SPICE netlist. */
  toSpice(): string {
    return this.compiled.toSpice();
  }

  /**
   * Changes a numeric field of a component (e.g. for parametric sweeps) and
   * invalidates cached results. Returns `this` for chaining.
   *
   * ```ts
   * c.setValue("R1", 2200).setValue("V1", 12, "dc");
   * ```
   */
  setValue(id: string, value: number, field?: string): this {
    const doc = this.compiled.toJSON();
    const comp = doc.components.find((c) => c.id === id);
    if (!comp)
      throw new ElecMapError("NOT_FOUND", `Unknown component "${id}"`, { componentId: id });
    const key = field ?? defaultField(comp);
    if (!(key in comp) && key !== "dc") {
      throw new ElecMapError("INVALID_ARGUMENT", `Component "${id}" has no field "${key}"`, {
        componentId: id,
        field: key,
      });
    }
    (comp as unknown as Record<string, unknown>)[key] = value;
    this.compiled = compile(doc, { ...this.options, ground: this.compiled.ground });
    this.systemCache = undefined;
    this.dcCache = undefined;
    return this;
  }

  // ---------------------------------------------------------------- analyses

  /**
   * DC operating point (capacitors open, inductors shorted, sources at their `dc` value).
   * The default-option result is cached.
   */
  operatingPoint(options?: DcOptions): DcSolution {
    if (options) return operatingPoint(this.system, options);
    return (this.dcCache ??= operatingPoint(this.system));
  }

  /** AC analysis at one frequency (Hz). */
  ac(freq: number, excitation: AcExcitation = {}): AcSolution {
    return acAnalysis(this.system, freq, excitation);
  }

  /** AC analysis over a frequency range. */
  acSweep(options: AcSweepOptions): AcSweep {
    return acSweep(this.system, options);
  }

  /**
   * Voltage between two nodes, `V(a) − V(b)` (`b` defaults to ground).
   *
   * - `"dc"` (default): DC value in volts;
   * - `{ freq }`: AC phasor at that frequency.
   */
  voltage(a: NodeName, at?: "dc"): number;
  voltage(a: NodeName, at: { freq: number } & AcExcitation): Complex;
  voltage(a: NodeName, b: NodeName, at?: "dc"): number;
  voltage(a: NodeName, b: NodeName, at: { freq: number } & AcExcitation): Complex;
  voltage(a: NodeName, bOrAt?: NodeName | AnalysisPoint, at?: AnalysisPoint): number | Complex {
    let b: NodeName | undefined;
    let point: AnalysisPoint = "dc";
    if (typeof bOrAt === "string" && bOrAt !== "dc") {
      b = bOrAt;
      if (at !== undefined) point = at;
    } else if (bOrAt !== undefined) {
      point = bOrAt;
    }
    if (point === "dc") return this.operatingPoint().voltage(a, b);
    const { freq, ...excitation } = point;
    return this.ac(freq, excitation).voltage(a, b);
  }

  /**
   * Current through a component, from its first node to its second node
   * (for an op-amp: current flowing into its output pin).
   */
  current(id: string, at?: "dc"): number;
  current(id: string, at: { freq: number } & AcExcitation): Complex;
  current(id: string, at: AnalysisPoint = "dc"): number | Complex {
    if (at === "dc") return this.operatingPoint().current(id);
    const { freq, ...excitation } = at;
    return this.ac(freq, excitation).current(id);
  }

  /** DC power absorbed by each component (W); sources delivering power are negative. */
  power(): Record<string, number> {
    const op = this.operatingPoint();
    const out: Record<string, number> = {};
    for (const c of this.compiled.components) if (c.type !== "coupling") out[c.id] = op.power(c.id);
    return out;
  }
}

function defaultField(c: ComponentJSON): string {
  switch (c.type) {
    case "resistor":
    case "capacitor":
    case "inductor":
      return "value";
    case "vsource":
    case "isource":
      return "dc";
    case "coupling":
      return "k";
    case "opamp":
      return "gain";
    case "switch":
      return "ron";
    default:
      return "gain";
  }
}

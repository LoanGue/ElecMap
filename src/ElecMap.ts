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
import { transferFunction } from "./analysis/transfer";
import { transient } from "./analysis/transient";
import type { TransientOptions, TransientResult } from "./analysis/transient";
import {
  equivalentCapacitance,
  equivalentInductance,
  equivalentResistance,
  impedance,
  inputImpedance,
  theveninAc,
  theveninDc,
} from "./analysis/equivalent";
import type { AcEquivalent, DcEquivalent, EquivalentOptions } from "./analysis/equivalent";
import type { OutputSpec, TransferFunction, TransferOptions } from "./analysis/transfer";

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
   * Transient (time-domain) analysis.
   *
   * ```ts
   * const tr = c.transient({ tStop: 5e-3, inputs: { V1: { kind: "step", v2: 5 } } });
   * tr.time; tr.voltage("out"); tr.current("R1");
   * ```
   */
  transient(options: TransientOptions): TransientResult {
    return transient(this.system, options);
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

  /**
   * Transfer function `H(s) = output / input`, all other independent sources turned off.
   *
   * ```ts
   * c.transferFunction("out");                              // V(out) / the only source
   * c.transferFunction({ input: "V1", output: ["a", "b"] }); // V(a) − V(b) over V1
   * c.transferFunction({ input: "I1", output: { current: "R2" } });
   * ```
   */
  transferFunction(spec: OutputSpec | TransferOptions): TransferFunction {
    const options: TransferOptions =
      typeof spec === "object" && !Array.isArray(spec) && "output" in spec
        ? (spec as TransferOptions)
        : { output: spec as OutputSpec };
    return transferFunction(this.system, options);
  }

  // ------------------------------------------------------------- equivalents

  /**
   * Impedance `Z(s)` between two nodes (`b` defaults to ground), all independent
   * sources off. It is a {@link TransferFunction}: `Z.evaluate(freq)`, `Z.toLatex()`…
   */
  impedance(a: NodeName, b?: NodeName): TransferFunction {
    return impedance(this.system, a, b);
  }

  /** Complex impedance (Ω) between two nodes at a frequency (Hz). */
  equivalentImpedance(a: NodeName, b: NodeName | undefined, freq: number): Complex {
    return this.impedance(a, b).evaluate(freq);
  }

  /**
   * Equivalent resistance (Ω) between two nodes.
   * @throws {@link ElecMapError} `NOT_HOMOGENEOUS` if the network is reactive (see {@link EquivalentOptions})
   */
  equivalentResistance(a: NodeName, b?: NodeName, options?: EquivalentOptions): number {
    return equivalentResistance(this.impedance(a, b), options);
  }

  /** Equivalent capacitance (F) between two nodes, for purely capacitive networks. */
  equivalentCapacitance(a: NodeName, b?: NodeName, options?: EquivalentOptions): number {
    return equivalentCapacitance(this.impedance(a, b), options);
  }

  /** Equivalent inductance (H) between two nodes, for purely inductive networks. */
  equivalentInductance(a: NodeName, b?: NodeName, options?: EquivalentOptions): number {
    return equivalentInductance(this.impedance(a, b), options);
  }

  /** Impedance `Z(s)` seen by an independent source (voltage / delivered current). */
  inputImpedance(source?: string): TransferFunction {
    return inputImpedance(this.system, source ?? resolveSingleSource(this.compiled));
  }

  /** Output impedance `Z(s)` at a node (alias of {@link impedance} to ground). */
  outputImpedance(node: NodeName, reference?: NodeName): TransferFunction {
    return this.impedance(node, reference);
  }

  /** Thévenin / Norton equivalent seen between two nodes (DC by default, or at `{ freq }`). */
  thevenin(a: NodeName, b?: NodeName, at?: "dc"): DcEquivalent;
  thevenin(a: NodeName, b: NodeName | undefined, at: { freq: number }): AcEquivalent;
  thevenin(
    a: NodeName,
    b?: NodeName,
    at: "dc" | { freq: number } = "dc",
  ): DcEquivalent | AcEquivalent {
    return at === "dc" ? theveninDc(this.system, a, b) : theveninAc(this.system, at.freq, a, b);
  }

  /** Same as {@link thevenin}; the Norton current and impedance are part of the result. */
  norton(a: NodeName, b?: NodeName, at?: "dc"): DcEquivalent;
  norton(a: NodeName, b: NodeName | undefined, at: { freq: number }): AcEquivalent;
  norton(
    a: NodeName,
    b?: NodeName,
    at: "dc" | { freq: number } = "dc",
  ): DcEquivalent | AcEquivalent {
    return at === "dc" ? theveninDc(this.system, a, b) : theveninAc(this.system, at.freq, a, b);
  }

  // ------------------------------------------------------------------- power

  /**
   * Power absorbed by each component. DC (default): watts, sources delivering power
   * are negative. `{ freq }`: complex power `S = ½·V·I*` (W + j·var) for the AC sources.
   */
  power(at?: "dc"): Record<string, number>;
  power(at: { freq: number } & AcExcitation): Record<string, Complex>;
  power(at: AnalysisPoint = "dc"): Record<string, number> | Record<string, Complex> {
    const ids = this.compiled.components.filter((c) => c.type !== "coupling").map((c) => c.id);
    if (at === "dc") {
      const op = this.operatingPoint();
      return Object.fromEntries(ids.map((id) => [id, op.power(id)]));
    }
    const { freq, ...excitation } = at;
    const sol = this.ac(freq, excitation);
    return Object.fromEntries(ids.map((id) => [id, sol.power(id)]));
  }
}

function resolveSingleSource(circuit: CompiledCircuit): string {
  const sources = circuit.components.filter((c) => c.type === "vsource" || c.type === "isource");
  if (sources.length !== 1) {
    throw new ElecMapError(
      "INVALID_ARGUMENT",
      `Pass the source id (${sources.length} independent sources)`,
    );
  }
  return (sources[0] as ComponentJSON).id;
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

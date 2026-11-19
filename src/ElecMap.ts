import { compile } from "./core/circuit";
import type { CircuitInput, CompileOptions, CompiledCircuit } from "./core/circuit";
import { ElecMapError } from "./core/errors";
import { COMPONENT_CATALOG } from "./format/catalog";
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
import { layoutCircuit } from "./render/layout";
import type { LayoutOptions } from "./render/layout";
import type { SchematicLayout } from "./render/layout";
import { renderSvg } from "./render/svg";
import { symbolicImpedance, symbolicTransferFunction } from "./symbolic/transfer";
import type { SymbolicTransferFunction, SymbolicTransferOptions } from "./symbolic/transfer";
import type { SymbolicOptions } from "./symbolic/system";
import type { SvgOptions } from "./render/svg";
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
 * Every example on this page uses this RC low-pass filter, called `c`:
 *
 * ```ts
 * import { ElecMap } from "elecmap";
 *
 * const c = new ElecMap(`
 * V1 in 0 DC 5 AC 1
 * R1 in out 1k
 * C1 out 0 100n
 * `);
 *
 * c.voltage("out"); // 5        (DC, volts)
 * c.voltage("out", { freq: 1000 }).abs(); // 0.8467   (amplitude at 1 kHz)
 * c.transferFunction("out").cutoffFrequency(); // 1591.55  (Hz)
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
  private smallSignalCache: MnaSystem | undefined;
  private dcCache: DcSolution | undefined;

  /**
   * Builds a circuit from a SPICE netlist or a JSON document. The input is
   * validated: an invalid circuit throws an {@link ElecMapError}.
   *
   * @example
   * ```ts
   * new ElecMap("V1 in 0 AC 1\nR1 in out 1k\nC1 out 0 100n"); // SPICE netlist
   * new ElecMap({ version: 1, components: [ ... ] }); // JSON document
   * new ElecMap(netlist, { ground: "gnd" }); // another name for the ground node
   * ```
   */
  constructor(input: CircuitInput, options: CompileOptions = {}) {
    this.options = options;
    this.compiled = compile(input, options);
  }

  /**
   * Builds a circuit from a SPICE netlist.
   *
   * @example
   * ```ts
   * ElecMap.fromSpice("V1 a 0 1\nR1 a 0 1k").current("R1"); // 0.001
   * ```
   */
  static fromSpice(netlist: string, options: CompileOptions = {}): ElecMap {
    return new this(netlist, options);
  }

  /**
   * Builds a circuit from a canonical JSON document (object or string).
   *
   * @example
   * ```ts
   * const copy = ElecMap.fromJSON(c.toJSON());
   * copy.nodes(); // ["in", "out"]
   * ```
   */
  static fromJSON(document: CircuitJSON | string, options: CompileOptions = {}): ElecMap {
    return new this(
      typeof document === "string" ? (JSON.parse(document) as CircuitJSON) : document,
      options,
    );
  }

  // ---------------------------------------------------------------- structure

  /**
   * Compiled circuit (nodes, components, warnings).
   *
   * @example
   * ```ts
   * c.circuit.nodes; // ["in", "out"]
   * c.circuit.warnings; // []
   * ```
   */
  get circuit(): CompiledCircuit {
    return this.compiled;
  }

  /** MNA system, built lazily and cached. */
  get system(): MnaSystem {
    return (this.systemCache ??= new MnaSystem(this.compiled));
  }

  /**
   * MNA system linearised around the DC operating point: the one every
   * small-signal analysis (AC, transfer functions, impedances) uses. For a
   * linear circuit it is {@link ElecMap.system} itself.
   *
   * @example
   * ```ts
   * const c = new ElecMap(`
   * V1 in 0 DC 5 AC 1
   * R1 in a 1k
   * D1 a 0 D1N4148
   * .model D1N4148 D(IS=2.52n N=1.752 RS=0.568)
   * `);
   * c.smallSignal.linear; // true: the diode is replaced by its tangent
   * impedance(c.smallSignal, "a").dcGain(); // 10.874 Ω, same as c.impedance("a")
   * ```
   */
  get smallSignal(): MnaSystem {
    if (this.system.linear) return this.system;
    return (this.smallSignalCache ??= this.system.smallSignal(this.operatingPoint().x));
  }

  /**
   * Circuit title, if any (`.title` line, or first line of a classic SPICE deck).
   *
   * @example
   * ```ts
   * new ElecMap(".title RC low-pass\nV1 in 0 1\nR1 in 0 1k").title; // "RC low-pass"
   * c.title; // undefined
   * ```
   */
  get title(): string | undefined {
    return this.compiled.title;
  }

  /**
   * Non-ground node names.
   *
   * @example
   * ```ts
   * c.nodes(); // ["in", "out"]
   * ```
   */
  nodes(): string[] {
    return [...this.compiled.nodes];
  }

  /**
   * All components, as JSON objects.
   *
   * @example
   * ```ts
   * c.components()[1]; // { id: "R1", type: "resistor", nodes: ["in", "out"], value: 1000 }
   * c.components().map((x) => x.id); // ["V1", "R1", "C1"]
   * ```
   */
  components(): ComponentJSON[] {
    return this.compiled.toJSON().components;
  }

  /**
   * Canonical JSON document.
   *
   * @example
   * ```ts
   * c.toJSON();
   * // {
   * //   version: 1,
   * //   components: [
   * //     { id: "V1", type: "vsource", nodes: ["in", "0"], dc: 5, ac: { mag: 1 } },
   * //     { id: "R1", type: "resistor", nodes: ["in", "out"], value: 1000 },
   * //     { id: "C1", type: "capacitor", nodes: ["out", "0"], value: 1e-7 }
   * //   ]
   * // }
   * ```
   */
  toJSON(): CircuitJSON {
    return this.compiled.toJSON();
  }

  /**
   * SPICE netlist.
   *
   * @example
   * ```ts
   * c.toSpice();
   * // * ElecMap circuit
   * // V1 in 0 DC 5 AC 1
   * // R1 in out 1k
   * // C1 out 0 100n
   * // .end
   * ```
   */
  toSpice(): string {
    return this.compiled.toSpice();
  }

  /**
   * Changes a numeric field of a component (e.g. for parametric sweeps) and
   * invalidates cached results. Returns `this` for chaining.
   *
   * The field defaults to `value` (R, L, C), `dc` (sources), `k` (couplings),
   * `gain` (controlled sources, op-amps) or `ron` (switches).
   *
   * @example
   * ```ts
   * const divider = new ElecMap("V1 in 0 DC 10\nR1 in out 1k\nR2 out 0 1k");
   * divider.setValue("R1", 3000).voltage("out"); // 2.5
   * divider.setValue("V1", 12, "dc").voltage("out"); // 3
   * ```
   */
  setValue(id: string, value: number, field?: string): this {
    const doc = this.compiled.toJSON();
    const comp = doc.components.find((c) => c.id === id);
    if (!comp)
      throw new ElecMapError("NOT_FOUND", `Unknown component "${id}"`, { componentId: id });
    const key = field ?? defaultField(comp);
    if (!(key in comp) && key !== "dc" && !(key in COMPONENT_CATALOG[comp.type].numbers)) {
      throw new ElecMapError("INVALID_ARGUMENT", `Component "${id}" has no field "${key}"`, {
        componentId: id,
        field: key,
      });
    }
    (comp as unknown as Record<string, unknown>)[key] = value;
    this.compiled = compile(doc, { ...this.options, ground: this.compiled.ground });
    this.systemCache = undefined;
    this.smallSignalCache = undefined;
    this.dcCache = undefined;
    return this;
  }

  // ---------------------------------------------------------------- analyses

  /**
   * DC operating point (capacitors open, inductors shorted, sources at their `dc` value).
   * The default-option result is cached.
   *
   * @example
   * ```ts
   * const op = c.operatingPoint();
   * op.nodeVoltages(); // { "0": 0, in: 5, out: 5 }
   * op.currents(); // { V1: 0, R1: 0, C1: 0 }
   * op.voltage("in", "out"); // 0
   * ```
   */
  operatingPoint(options?: DcOptions): DcSolution {
    if (options) return operatingPoint(this.system, options);
    return (this.dcCache ??= operatingPoint(this.system));
  }

  /**
   * AC analysis at one frequency (Hz): every voltage and current as a phasor.
   *
   * @example
   * ```ts
   * const ac = c.ac(1000);
   * ac.voltage("out").toString(); // "0.716956800325 - 0.450477243368j"
   * ac.current("R1").abs(); // 0.000532   (A)
   * ```
   */
  ac(freq: number, excitation: AcExcitation = {}): AcSolution {
    return acAnalysis(this.smallSignal, freq, excitation);
  }

  /**
   * AC analysis over a frequency range (`points` per decade by default).
   *
   * @example
   * ```ts
   * const sweep = c.acSweep({ fStart: 100, fStop: 10e3, points: 1 });
   * sweep.freqs; // [100, 1000, 10000]
   * sweep.voltage("out").map((v) => v.abs()); // [0.998, 0.8467, 0.1572]
   * ```
   */
  acSweep(options: AcSweepOptions): AcSweep {
    return acSweep(this.smallSignal, options);
  }

  /**
   * Transient (time-domain) analysis. Sources follow their netlist waveform,
   * unless overridden with `inputs`.
   *
   * @example
   * ```ts
   * const tr = c.transient({ tStop: 5e-3, inputs: { V1: { kind: "step", v1: 0, v2: 5 } } });
   * tr.time.length; // 1001   (tStep defaults to tStop / 1000)
   * tr.voltage("out").at(-1); // 5   (after 50 time constants)
   * tr.current("R1"); // A, one value per time point
   * ```
   */
  transient(options: TransientOptions): TransientResult {
    return transient(this.system, options);
  }

  /**
   * Schematic geometry (grid units): placed components, routed wires, junctions.
   * Useful to build interactive views; {@link ElecMap.toSVG} renders it.
   * `options.ground` chooses between a ground rail and ground symbols.
   *
   * @example
   * ```ts
   * const layout = c.layout();
   * layout.components.map((p) => p.id); // ["V1", "R1", "C1"]
   * layout.bounds; // { minX: -2, minY: -3, maxX: 16, maxY: 12 }   (the ground rail closes the circuit)
   * c.layout({ ground: "symbols" }).grounds.length; // 2   (one symbol under V1, one under C1)
   * ```
   */
  layout(options: LayoutOptions = {}): SchematicLayout {
    return layoutCircuit(this.compiled, options);
  }

  /**
   * Schematic as a standalone SVG string (IEC symbols by default).
   *
   * @example
   * ```ts
   * const svg = c.toSVG(); // '<svg xmlns="http://www.w3.org/2000/svg" class="elecmap" …'
   * c.toSVG({ style: "ansi", highlight: ["R1", "out"], theme: "light" });
   * c.toSVG({ ground: "symbols" }); // a ground symbol per grounded pin instead of the rail
   * ```
   */
  toSVG(options: SvgOptions = {}): string {
    const layout = layoutCircuit(this.compiled, {
      showValues: options.showValues ?? true,
      ground: options.ground ?? "auto",
    });
    return renderSvg(layout, { title: this.title ?? "Circuit schematic", ...options });
  }

  /**
   * Voltage between two nodes, `V(a) − V(b)` (`b` defaults to ground).
   *
   * - `"dc"` (default): DC value in volts;
   * - `{ freq }`: AC phasor at that frequency.
   *
   * @example
   * ```ts
   * c.voltage("out"); // 5
   * c.voltage("in", "out"); // 0
   * c.voltage("out", { freq: 1000 }).toString(); // "0.716956800325 - 0.450477243368j"
   * c.voltage("out", { freq: 1000, input: "V1", amplitude: 2 }).abs(); // 1.693   (V1 driven at 2 V)
   * ```
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
   *
   * @example
   * ```ts
   * c.current("R1"); // 0   (DC: the capacitor is open)
   * c.current("C1", { freq: 1000 }).toString(); // "0.000283043199675 + 0.000450477243368j"
   * ```
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
   * @example
   * ```ts
   * const H = c.transferFunction("out"); // V(out) / the only source
   * H.toLatex(); // "\frac{1}{1 + 10^{-4}\,s}"
   * H.cutoffFrequency(); // 1591.55
   *
   * c.transferFunction({ input: "V1", output: ["in", "out"] }); // (V(in) − V(out)) / V1
   * c.transferFunction({ input: "V1", output: { current: "R1" } }); // I(R1) / V1
   * ```
   */
  transferFunction(spec: OutputSpec | TransferOptions): TransferFunction {
    const options: TransferOptions =
      typeof spec === "object" && !Array.isArray(spec) && "output" in spec
        ? (spec as TransferOptions)
        : { output: spec as OutputSpec };
    return transferFunction(this.smallSignal, options);
  }

  /**
   * Literal transfer function, with the component names as symbols.
   *
   * @example
   * ```ts
   * const H = c.symbolicTransferFunction("out");
   * H.toLatex(); // "\frac{1}{1 + R_{1} C_{1} s}"
   * H.substitute({ C1: 200e-9 }).cutoffFrequency(); // 795.8
   * c.symbolicTransferFunction({ output: "out", symbols: ["C1"] }); // R1 replaced by its value
   * ```
   */
  symbolicTransferFunction(spec: OutputSpec | SymbolicTransferOptions): SymbolicTransferFunction {
    const options: SymbolicTransferOptions =
      typeof spec === "object" && !Array.isArray(spec) && "output" in spec
        ? (spec as SymbolicTransferOptions)
        : { output: spec as OutputSpec };
    return symbolicTransferFunction(this.system, options);
  }

  /**
   * Literal impedance between two nodes (`b` defaults to ground), sources off.
   *
   * @example
   * ```ts
   * c.symbolicImpedance("out").toLatex(); // "\frac{R_{1}}{1 + R_{1} C_{1} s}"
   * ```
   */
  symbolicImpedance(
    a: NodeName,
    b?: NodeName,
    options: SymbolicOptions = {},
  ): SymbolicTransferFunction {
    return symbolicImpedance(this.system, a, b, options);
  }

  // ------------------------------------------------------------- equivalents

  /**
   * Impedance `Z(s)` between two nodes (`b` defaults to ground), all independent
   * sources off. It is a {@link TransferFunction}: `Z.evaluate(freq)`, `Z.toLatex()`…
   *
   * @example
   * ```ts
   * const Z = c.impedance("out"); // R1 ∥ C1 (V1 is turned off: a wire)
   * Z.toLatex(); // "\frac{1000}{1 + 10^{-4}\,s}"
   * Z.evaluate(1000).toString(); // "716.956800325 - 450.477243368j"
   * ```
   */
  impedance(a: NodeName, b?: NodeName): TransferFunction {
    return impedance(this.smallSignal, a, b);
  }

  /**
   * Complex impedance (Ω) between two nodes at a frequency (Hz).
   *
   * @example
   * ```ts
   * c.equivalentImpedance("out", undefined, 1000).toString(); // "716.956800325 - 450.477243368j"
   * ```
   */
  equivalentImpedance(a: NodeName, b: NodeName | undefined, freq: number): Complex {
    return this.impedance(a, b).evaluate(freq);
  }

  /**
   * Equivalent resistance (Ω) between two nodes.
   * @throws {@link ElecMapError} `NOT_HOMOGENEOUS` if the network is reactive (see {@link EquivalentOptions})
   *
   * @example
   * ```ts
   * new ElecMap("V1 in 0 1\nR1 in a 1k\nR2 a 0 1k").equivalentResistance("a"); // 500
   *
   * c.equivalentResistance("out"); // throws NOT_HOMOGENEOUS (R1 ∥ C1 is not a resistor)
   * c.equivalentResistance("out", undefined, { mode: "dc" }); // 1000
   * ```
   */
  equivalentResistance(a: NodeName, b?: NodeName, options?: EquivalentOptions): number {
    return equivalentResistance(this.impedance(a, b), options);
  }

  /**
   * Equivalent capacitance (F) between two nodes, for purely capacitive networks.
   *
   * @example
   * ```ts
   * new ElecMap("V1 in 0 AC 1\nC1 in a 100n\nC2 a 0 100n").equivalentCapacitance("a"); // 2e-7
   * ```
   */
  equivalentCapacitance(a: NodeName, b?: NodeName, options?: EquivalentOptions): number {
    return equivalentCapacitance(this.impedance(a, b), options);
  }

  /**
   * Equivalent inductance (H) between two nodes, for purely inductive networks.
   *
   * @example
   * ```ts
   * new ElecMap("V1 in 0 AC 1\nL1 in a 10m\nL2 a 0 22m").equivalentInductance("a"); // 0.006875
   * ```
   */
  equivalentInductance(a: NodeName, b?: NodeName, options?: EquivalentOptions): number {
    return equivalentInductance(this.impedance(a, b), options);
  }

  /**
   * Impedance `Z(s)` seen by an independent source (voltage / delivered current).
   * The source can be omitted when the circuit has only one.
   *
   * @example
   * ```ts
   * c.inputImpedance("V1").toLatex(); // "\frac{10^{7} + 1000\,s}{s}"   (R1 + 1/(C1·s))
   * ```
   */
  inputImpedance(source?: string): TransferFunction {
    return inputImpedance(this.smallSignal, source ?? resolveSingleSource(this.compiled));
  }

  /**
   * Output impedance `Z(s)` at a node (alias of {@link impedance} to ground).
   *
   * @example
   * ```ts
   * c.outputImpedance("out").toLatex(); // "\frac{1000}{1 + 10^{-4}\,s}"
   * ```
   */
  outputImpedance(node: NodeName, reference?: NodeName): TransferFunction {
    return this.impedance(node, reference);
  }

  /**
   * Thévenin / Norton equivalent seen between two nodes (DC by default, or at `{ freq }`).
   *
   * @example
   * ```ts
   * c.thevenin("out");
   * // { voltage: 5, resistance: 1000, current: 0.005, optimalLoad: 1000, maxPower: 0.00625 }
   *
   * c.thevenin("out", undefined, { freq: 1000 }).impedance.toString();
   * // "716.956800325 - 450.477243368j"
   * ```
   */
  thevenin(a: NodeName, b?: NodeName, at?: "dc"): DcEquivalent;
  thevenin(a: NodeName, b: NodeName | undefined, at: { freq: number }): AcEquivalent;
  thevenin(
    a: NodeName,
    b?: NodeName,
    at: "dc" | { freq: number } = "dc",
  ): DcEquivalent | AcEquivalent {
    return at === "dc"
      ? theveninDc(this.system, a, b, this.smallSignal)
      : theveninAc(this.smallSignal, at.freq, a, b);
  }

  /**
   * Same as {@link thevenin}; the Norton current and impedance are part of the result.
   *
   * @example
   * ```ts
   * c.norton("out").current; // 0.005   (A, short-circuit current)
   * ```
   */
  norton(a: NodeName, b?: NodeName, at?: "dc"): DcEquivalent;
  norton(a: NodeName, b: NodeName | undefined, at: { freq: number }): AcEquivalent;
  norton(
    a: NodeName,
    b?: NodeName,
    at: "dc" | { freq: number } = "dc",
  ): DcEquivalent | AcEquivalent {
    return at === "dc"
      ? theveninDc(this.system, a, b, this.smallSignal)
      : theveninAc(this.smallSignal, at.freq, a, b);
  }

  // ------------------------------------------------------------------- power

  /**
   * Power absorbed by each component. DC (default): watts, sources delivering power
   * are negative. `{ freq }`: complex power `S = ½·V·I*` (W + j·var) for the AC sources.
   *
   * @example
   * ```ts
   * new ElecMap("V1 in 0 DC 10\nR1 in out 1k\nR2 out 0 4k").power();
   * // { V1: -0.02, R1: 0.004, R2: 0.016 }
   *
   * const s = c.power({ freq: 1000 });
   * s.R1.toString(); // "0.000141521599838"        (W)
   * s.C1.toString(); // "0 - 0.000225238621684j"   (var)
   * ```
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
    case "diode":
      return "is";
    default:
      return "gain";
  }
}

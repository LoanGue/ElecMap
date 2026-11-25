import { compile } from "./core/circuit";
import type { CircuitInput, CompileOptions, CompiledCircuit } from "./core/circuit";
import { writeCircuit } from "./format/exchange";
import { toCir } from "./format/cir";
import { toAsc } from "./format/asc";
import type { AscOptions } from "./format/asc";
import type { CirOptions } from "./format/cir";
import type { CircuitFormat, FormatOutput } from "./format/exchange";
import { ElecMapError } from "./core/errors";
import { COMPONENT_CATALOG } from "./format/catalog";
import type { CircuitJSON, ComponentJSON, NodeName } from "./format/types";
import type { Complex } from "./math/complex";
import { MnaSystem } from "./mna/system";
import { bjtParams, diodeParams, mosfetParams } from "./mna/devices";
import { operatingPoint } from "./analysis/dc";
import type { DcOptions } from "./analysis/dc";
import { acAnalysis, acSweep } from "./analysis/ac";
import type { AcExcitation, AcSweep, AcSweepOptions } from "./analysis/ac";
import type { AcSolution, DcSolution } from "./analysis/solution";
import { toTransferOptions, transferFunction } from "./analysis/transfer";
import { feedbackWarnings } from "./analysis/feedback";
import type { ValidationIssue } from "./format/validate";
import { transient } from "./analysis/transient";
import { layoutCircuit } from "./render/layout";
import type { LayoutOptions } from "./render/layout";
import type { SchematicLayout } from "./render/layout";
import { renderSvg } from "./render/svg";
import { MonteCarlo, drawDeviation, seededRandom } from "./montecarlo";
import type { MonteCarloOptions, MonteCarloSample } from "./montecarlo";
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
 * What {@link ElecMap.sensitivity} differentiates: a node voltage (to ground),
 * a voltage between two nodes, a component current, or any number computed
 * from the circuit.
 */
export type SensitivityOutput =
  NodeName | [NodeName, NodeName] | { current: string } | ((circuit: ElecMap) => number);

/** Options of {@link ElecMap.sensitivity} and {@link ElecMap.sensitivities}. */
export interface SensitivityOptions {
  /**
   * Where the output is measured: `"dc"` (default) or `{ freq }`, where the
   * output is the amplitude (modulus) of the phasor. Ignored for a function output.
   */
  at?: AnalysisPoint;
  /** Component field to vary (default: the field of {@link ElecMap.setValue}). */
  field?: string;
}

/** Sensitivity of an output to one component field. */
export interface Sensitivity {
  /** Component id. */
  id: string;
  /** Field varied (`value`, `dc`, `gain`…). */
  field: string;
  /** Current value of the field, `p`. */
  value: number;
  /** Output at the current value, `y`. */
  output: number;
  /** Absolute sensitivity `∂y/∂p`, in output units per field unit. */
  derivative: number;
  /**
   * Normalised sensitivity `(p/y)·∂y/∂p`: the relative change of the output for a
   * 1 % change of the field is `normalized` %. `NaN` when the output is 0.
   */
  normalized: number;
}

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
   * Builds a circuit from a SPICE netlist, a JSON document or a base64 token
   * (see {@link ElecMap.export}). The format is detected, or set with
   * `options.format`. The input is validated: an invalid circuit throws an
   * {@link ElecMapError}.
   *
   * @example
   * ```ts
   * new ElecMap("V1 in 0 AC 1\nR1 in out 1k\nC1 out 0 100n"); // SPICE netlist
   * new ElecMap({ version: 1, components: [ ... ] }); // JSON document
   * new ElecMap("eyJ2ZXJzaW9uIjox…"); // base64, as produced by export("base64")
   * new ElecMap(text, { format: "netlist" }); // explicit format
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
   * Portable SPICE netlist (`.cir`) for LTspice, ngspice and KiCad: ElecMap's
   * extensions are translated (op-amps become controlled sources, fixed
   * switches resistors, `STEP` a `PWL`, device parameters `.model` cards) and
   * names follow SPICE rules. `analysis` sets the analysis lines (default `.op`).
   *
   * @example
   * ```ts
   * new ElecMap("V1 in 0 AC 1\nR1 in out 10k\nX1 0 out o2 OPAMP").toCir({ analysis: ".ac dec 20 1 1meg" });
   * // * ElecMap circuit
   * // V1 in 0 AC 1
   * // R1 in out 10k
   * // EX1 o2 0 0 out 1meg
   * // .ac dec 20 1 1meg
   * // .end
   * ```
   */
  toCir(options: CirOptions = {}): string {
    return toCir(this.compiled.toJSON(), options);
  }

  /**
   * Writes the circuit as an LTspice schematic (`.asc`): the schematic of
   * {@link layout} redrawn with LTspice's symbols, its nets named as here, the
   * `.model` cards and the analysis as directives. Elements and values are
   * those of {@link toCir}.
   *
   * @example
   * ```ts
   * const asc = new ElecMap("V1 in 0 AC 1\nR1 in out 1k\nC1 out 0 100n").toAsc({
   *   analysis: ".ac dec 20 10 100k",
   * });
   * asc.split("\n").filter((l) => l.startsWith("SYMBOL"));
   * // ["SYMBOL voltage 0 80 R0", "SYMBOL res 144 16 R270", "SYMBOL cap 336 96 R0"]
   * ```
   */
  toAsc(options: AscOptions = {}): string {
    return toAsc(this.compiled.toJSON(), this.layout({ ground: "symbols" }), options);
  }

  /**
   * Exports the circuit in an exchange format: `"json"` (the canonical
   * document, an object), `"netlist"` (SPICE text) or `"base64"` (a single
   * URL-safe token, ready to send). Every format can be read back by the
   * constructor.
   *
   * @example
   * ```ts
   * const token = c.export("base64"); // "eyJ2ZXJzaW9uIjox…"
   * new ElecMap(token).voltage("out"); // same circuit
   * c.export("netlist"); // "* ElecMap circuit\nV1 in 0 …"
   * ```
   */
  export<F extends CircuitFormat>(format: F): FormatOutput[F] {
    return writeCircuit(this.compiled.toJSON(), format);
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
    this.compiled = this.compileWith(id, field, value);
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
   * c.transferFunction({ input: { voltage: "in" }, output: "out" }); // V(out) / V(in)
   * ```
   */
  transferFunction(spec: OutputSpec | TransferOptions): TransferFunction {
    return transferFunction(this.smallSignal, toTransferOptions(spec));
  }

  /**
   * Warnings on {@link ElecMap.transferFunction}: `POSITIVE_FEEDBACK` when an
   * ideal op-amp sits in positive feedback, so that the linear result has no
   * physical meaning (checked with each ideal op-amp as `GAIN=1e5 GBW=1e6`).
   *
   * @example
   * ```ts
   * const schmitt = new ElecMap("V1 n1 0 1\nR3 in n1 1k\nX1 n2 in out OPAMP\nR2 n2 out 1k\nR1 n2 0 1k");
   * schmitt.transferFunction("out").dcGain(); // 2 (looks stable)
   * schmitt.transferWarnings("out").map((w) => w.code); // ["POSITIVE_FEEDBACK"]
   * ```
   */
  transferWarnings(spec: OutputSpec | TransferOptions): ValidationIssue[] {
    return feedbackWarnings(this.system, toTransferOptions(spec));
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

  // ----------------------------------------------------------- sensitivities

  /**
   * Sensitivity of an output to one component field: how much the output moves
   * when the field changes. The result gives both the derivative `∂y/∂p` and the
   * normalised sensitivity `(p/y)·∂y/∂p` (a 1 % change of the field moves the
   * output by `normalized` %).
   *
   * The output is a node voltage, a voltage between two nodes, a current
   * (`{ current: id }`) or a function of the circuit; at `{ freq }` it is the
   * amplitude of the phasor. The derivative is computed by central differences
   * with Richardson extrapolation (4 analyses, relative step 10⁻³), so it also
   * works on non-linear circuits.
   *
   * @example
   * ```ts
   * const divider = new ElecMap("V1 in 0 10\nR1 in out 1k\nR2 out 0 3k");
   * const s = divider.sensitivity("out", "R1");
   * s.output; // 7.5          V(out)
   * s.derivative; // -0.001875 V/Ω: +1 Ω on R1 → -1.875 mV
   * s.normalized; // -0.25    +1 % on R1 → -0.25 % on V(out)
   *
   * divider.sensitivity("out", "V1").normalized; // 1
   * divider.sensitivity({ current: "R2" }, "R2").derivative; // -6.25e-7 A/Ω
   * c.sensitivity("out", "C1", { at: { freq: 1000 } }).normalized; // -0.2830
   * c.sensitivity((x) => x.transferFunction("out").cutoffFrequency(), "R1").normalized; // -1
   * ```
   *
   * @throws {@link ElecMapError} `NOT_FOUND` for an unknown component,
   * `INVALID_ARGUMENT` for a field it does not have
   */
  sensitivity(
    output: SensitivityOutput,
    id: string,
    options: SensitivityOptions = {},
  ): Sensitivity {
    const [comp, field] = fieldOf(this.compiled.toJSON(), id, options.field);
    const value = fieldValue(comp, field);
    if (value === undefined) {
      throw new ElecMapError(
        "INVALID_ARGUMENT",
        `Component "${id}" has no value for "${field}": set it first (setValue or the netlist)`,
        { componentId: id, field },
      );
    }
    const measure = measureOf(output, options.at ?? "dc");
    const y = measure(this);
    const at = (p: number) =>
      measure(new ElecMap(this.docWith(id, field, p), this.clonedOptions()));
    const h = value === 0 ? 1e-3 : Math.abs(value) * 1e-3;
    const d = (step: number) => (at(value + step) - at(value - step)) / (2 * step);
    const derivative = (4 * d(h / 2) - d(h)) / 3;
    return {
      id,
      field,
      value,
      output: y,
      derivative,
      normalized: y === 0 ? NaN : (derivative * value) / y,
    };
  }

  /**
   * Sensitivities of an output to every component field that has a value (the
   * default field of each component, see {@link ElecMap.setValue}), sorted by
   * decreasing `|normalized|`: the first entries are the components that matter most.
   *
   * @example
   * ```ts
   * const loaded = new ElecMap("V1 in 0 10\nR1 in out 1k\nR2 out 0 3k\nR3 out 0 6k");
   * loaded.sensitivities("out").map((s) => [s.id, s.normalized]);
   * // [["V1", 1], ["R1", -0.3333], ["R2", 0.2222], ["R3", 0.1111]]
   * ```
   */
  sensitivities(output: SensitivityOutput, options: { at?: AnalysisPoint } = {}): Sensitivity[] {
    const result: Sensitivity[] = [];
    for (const comp of this.compiled.toJSON().components) {
      if (comp.type === "opamp" && comp.gain === undefined) continue;
      if (fieldValue(comp, defaultField(comp)) === undefined) continue;
      result.push(this.sensitivity(output, comp.id, options));
    }
    const key = (s: Sensitivity) => (Number.isNaN(s.normalized) ? -1 : Math.abs(s.normalized));
    return result.sort((a, b) => key(b) - key(a));
  }

  // ------------------------------------------------------------- Monte-Carlo

  /**
   * Monte-Carlo tolerance analysis: `runs` copies of the circuit, each with every
   * toleranced component drawn at random around its value. The result gives the
   * random circuits, statistics of any quantity over them and Bode envelopes.
   * The circuit itself is not changed, and the same `seed` gives the same runs.
   *
   * @example
   * ```ts
   * const mc = c.monteCarlo({ tolerances: { R1: 0.05, C1: 0.1 }, runs: 200 });
   * mc.samples[0].values; // { R1: 1012.7, C1: 9.005e-8 }   (drawn values of run 0)
   *
   * const fc = mc.statistics((x) => x.transferFunction("out").cutoffFrequency());
   * fc.nominal; // 1591.5 Hz
   * [fc.min, fc.max]; // [1390.7, 1835.6]
   * fc.std; // 108.1
   *
   * const bode = mc.bode("out"); // Bode of every run, and its envelope
   * bode.magnitudeDb.min; // lower edge of the envelope (dB, one value per frequency)
   * ```
   *
   * @throws {@link ElecMapError} `NOT_FOUND` for an unknown component,
   * `INVALID_ARGUMENT` for a field it does not have or a negative tolerance
   */
  monteCarlo(options: MonteCarloOptions): MonteCarlo {
    const runs = options.runs ?? 100;
    if (!Number.isInteger(runs) || runs < 1) {
      throw new ElecMapError("INVALID_ARGUMENT", `runs must be a positive integer (got ${runs})`);
    }
    const doc = this.compiled.toJSON();
    const fields = Object.entries(options.tolerances).map(([key, spec]) => {
      const dot = key.lastIndexOf(".");
      const known = doc.components.some((c) => c.id === key);
      const id = known || dot < 0 ? key : key.slice(0, dot);
      const field = known || dot < 0 ? undefined : key.slice(dot + 1);
      const [comp, name] = fieldOf(doc, id, field);
      const value = fieldValue(comp, name);
      if (value === undefined) {
        throw new ElecMapError("INVALID_ARGUMENT", `Component "${id}" has no value for "${name}"`, {
          componentId: id,
          field: name,
        });
      }
      const s = typeof spec === "number" ? { tolerance: spec } : spec;
      if (!(s.tolerance >= 0)) {
        throw new ElecMapError(
          "INVALID_ARGUMENT",
          `Tolerance of "${key}" must be a non-negative number (got ${s.tolerance})`,
          { componentId: id, field: name },
        );
      }
      const distribution = s.distribution ?? options.distribution ?? "uniform";
      return { key, id, name, value, tolerance: s.tolerance, distribution };
    });
    const random = seededRandom(options.seed ?? 1);
    const samples: MonteCarloSample[] = Array.from({ length: runs }, (_, run) => ({
      run,
      values: Object.fromEntries(
        fields.map((f) => [
          f.key,
          f.value * (1 + f.tolerance * drawDeviation(random, f.distribution)),
        ]),
      ),
    }));
    return new MonteCarlo(this, samples, (sample) => {
      const copy = this.compiled.toJSON();
      for (const f of fields) {
        const [comp] = fieldOf(copy, f.id, f.name);
        (comp as unknown as Record<string, unknown>)[f.name] = sample.values[f.key];
      }
      return new ElecMap(copy, this.clonedOptions());
    });
  }

  /** The circuit with one field changed. */
  private docWith(id: string, field: string | undefined, value: number): CircuitJSON {
    const doc = this.compiled.toJSON();
    const [comp, key] = fieldOf(doc, id, field);
    (comp as unknown as Record<string, unknown>)[key] = value;
    return doc;
  }

  private clonedOptions(): CompileOptions {
    // The copy is built from JSON, whatever the original input format was.
    const options: CompileOptions = { ...this.options, ground: this.compiled.ground };
    delete options.format;
    return options;
  }

  private compileWith(id: string, field: string | undefined, value: number): CompiledCircuit {
    return compile(this.docWith(id, field, value), this.clonedOptions());
  }

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

/** Component and field of `setValue(id, …, field)`, validated. */
function fieldOf(doc: CircuitJSON, id: string, field?: string): [ComponentJSON, string] {
  const comp = doc.components.find((c) => c.id === id);
  if (!comp) throw new ElecMapError("NOT_FOUND", `Unknown component "${id}"`, { componentId: id });
  const key = field ?? defaultField(comp);
  if (!(key in comp) && key !== "dc" && !(key in COMPONENT_CATALOG[comp.type].numbers)) {
    throw new ElecMapError("INVALID_ARGUMENT", `Component "${id}" has no field "${key}"`, {
      componentId: id,
      field: key,
    });
  }
  return [comp, key];
}

/** Current numeric value of a field (missing `dc` = 0, other missing fields: catalogue default). */
function fieldValue(comp: ComponentJSON, key: string): number | undefined {
  const v = (comp as unknown as Record<string, unknown>)[key];
  if (typeof v === "number") return v;
  if (key === "dc" && v === undefined) return 0;
  return resolvedValue(comp, key);
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
    case "bjt":
      return "bf";
    case "mosfet":
      return "w";
    default:
      return "gain";
  }
}

/** Field value, with the SPICE default of device parameters that are not set. */
function resolvedValue(comp: ComponentJSON, key: string): number | undefined {
  const params =
    comp.type === "diode"
      ? diodeParams(comp)
      : comp.type === "bjt"
        ? bjtParams(comp)
        : comp.type === "mosfet"
          ? { ...mosfetParams(comp), w: comp.w ?? 100e-6, l: comp.l ?? 100e-6 }
          : undefined;
  const v = (params as Record<string, unknown> | undefined)?.[key];
  return typeof v === "number" ? v : undefined;
}

/** Output of {@link ElecMap.sensitivity} as a function of a circuit. */
function measureOf(output: SensitivityOutput, at: AnalysisPoint): (c: ElecMap) => number {
  if (typeof output === "function") return output;
  const real = (v: number | Complex) => (typeof v === "number" ? v : v.abs());
  const point = at as { freq: number } & AcExcitation;
  if (typeof output === "string") {
    return (c) => real(at === "dc" ? c.voltage(output) : c.voltage(output, point));
  }
  if (Array.isArray(output)) {
    const [a, b] = output;
    return (c) => real(at === "dc" ? c.voltage(a, b) : c.voltage(a, b, point));
  }
  const id = output.current;
  return (c) => real(at === "dc" ? c.current(id) : c.current(id, point));
}

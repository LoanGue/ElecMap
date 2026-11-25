/**
 * Canonical, machine-readable circuit format (the "compiled" form).
 *
 * Every input (SPICE netlist or JSON) is normalised into a {@link CircuitJSON}
 * document. All values are plain SI numbers (ohms, farads, henries, volts,
 * amperes, hertz, seconds); phases are in degrees.
 *
 * @module
 */

/** Name of an electrical node. `"0"` is the ground reference by default. */
export type NodeName = string;

/** Current version of the JSON format. */
export const FORMAT_VERSION = 1;

/** Sinusoidal waveform `offset + amplitude·e^(−damping·(t−delay))·sin(2π·freq·(t−delay) + phase)`. */
export interface SineWaveform {
  kind: "sine";
  offset: number;
  amplitude: number;
  /** Frequency in Hz. */
  freq: number;
  /** Delay in seconds (default 0). */
  delay?: number;
  /** Damping factor in 1/s (default 0). */
  damping?: number;
  /** Phase in degrees (default 0). */
  phase?: number;
}

/** Periodic trapezoidal pulse (SPICE `PULSE`). */
export interface PulseWaveform {
  kind: "pulse";
  /** Initial value. */
  v1: number;
  /** Pulsed value. */
  v2: number;
  delay?: number;
  rise?: number;
  fall?: number;
  /** Pulse width in seconds. */
  width?: number;
  /** Period in seconds (non-periodic when omitted). */
  period?: number;
}

/** Piecewise-linear waveform (SPICE `PWL`): list of `[time, value]` points. */
export interface PwlWaveform {
  kind: "pwl";
  points: [number, number][];
}

/** Step from `v1` to `v2` at `delay`. */
export interface StepWaveform {
  kind: "step";
  v1?: number;
  v2: number;
  delay?: number;
}

/** Double exponential waveform (SPICE `EXP`). */
export interface ExpWaveform {
  kind: "exp";
  v1: number;
  v2: number;
  /** Rise delay. */
  td1?: number;
  /** Rise time constant. */
  tau1?: number;
  /** Fall delay. */
  td2?: number;
  /** Fall time constant. */
  tau2?: number;
}

/** Time-domain waveform of an independent source. */
export type Waveform = SineWaveform | PulseWaveform | PwlWaveform | StepWaveform | ExpWaveform;

/** Small-signal AC specification of an independent source. */
export interface AcSpec {
  /** Magnitude. */
  mag: number;
  /** Phase in degrees (default 0). */
  phase?: number;
}

/** Fields shared by every component. */
export interface ComponentBase {
  /** Unique identifier, e.g. `"R1"`. The first letter follows SPICE conventions. */
  id: string;
  /** Free text label shown on the schematic. */
  label?: string;
}

/** Linear resistor. `nodes = [a, b]`, `value` in ohms. */
export interface ResistorJSON extends ComponentBase {
  type: "resistor";
  nodes: [NodeName, NodeName];
  value: number;
}

/** Linear capacitor. `value` in farads, optional initial voltage `ic` (V). */
export interface CapacitorJSON extends ComponentBase {
  type: "capacitor";
  nodes: [NodeName, NodeName];
  value: number;
  ic?: number;
}

/** Linear inductor. `value` in henries, optional initial current `ic` (A). */
export interface InductorJSON extends ComponentBase {
  type: "inductor";
  nodes: [NodeName, NodeName];
  value: number;
  ic?: number;
}

/** Shared fields of independent sources. */
interface IndependentSource extends ComponentBase {
  /** `[positive, negative]` nodes. */
  nodes: [NodeName, NodeName];
  /** DC value (default 0). */
  dc?: number;
  /** AC small-signal value. */
  ac?: AcSpec;
  /** Time-domain waveform (transient analysis). */
  waveform?: Waveform;
}

/** Independent voltage source: `V(p) − V(n) = value`. Its current flows from `p` to `n` through the source. */
export interface VoltageSourceJSON extends IndependentSource {
  type: "vsource";
}

/** Independent current source: `value` flows from `p` to `n` through the source (SPICE convention). */
export interface CurrentSourceJSON extends IndependentSource {
  type: "isource";
}

/** Voltage-controlled voltage source (SPICE `E`): `V(p,n) = gain · V(cp,cn)`. */
export interface VcvsJSON extends ComponentBase {
  type: "vcvs";
  nodes: [NodeName, NodeName];
  control: [NodeName, NodeName];
  gain: number;
}

/** Voltage-controlled current source (SPICE `G`): `I(p→n) = gain · V(cp,cn)` (gain in siemens). */
export interface VccsJSON extends ComponentBase {
  type: "vccs";
  nodes: [NodeName, NodeName];
  control: [NodeName, NodeName];
  gain: number;
}

/** Current-controlled current source (SPICE `F`): `I(p→n) = gain · I(controlSource)`. */
export interface CccsJSON extends ComponentBase {
  type: "cccs";
  nodes: [NodeName, NodeName];
  /** Id of the voltage source whose current controls this source. */
  controlSource: string;
  gain: number;
}

/** Current-controlled voltage source (SPICE `H`): `V(p,n) = gain · I(controlSource)` (gain in ohms). */
export interface CcvsJSON extends ComponentBase {
  type: "ccvs";
  nodes: [NodeName, NodeName];
  controlSource: string;
  gain: number;
}

/**
 * Behavioural source (SPICE `B`): a voltage `V(p,n)` or a current `I(p→n)`
 * given by an expression of the circuit's voltages and currents, e.g.
 * `"V(in)^2 / 2"`, `"1m * tanh(V(a,b) / 26m)"`, `"V(ctrl) * I(Vsense)"`.
 *
 * The expression may use the probes `V(node)`, `V(a,b)` and `I(id)` (current of
 * a component without capacitance, e.g. a voltage source, an inductor, a resistor),
 * the time `time` (s, 0 outside transient analysis), numbers with SPICE suffixes,
 * `pi`, `e`, the operators `+ - * / ^`, comparisons and the functions of
 * {@link EXPRESSION_FUNCTIONS}. It is solved by Newton-Raphson, and linearised
 * at the operating point in small-signal analyses.
 */
export interface BehavioralSourceJSON extends ComponentBase {
  type: "bsource";
  /** `[positive, negative]` nodes. */
  nodes: [NodeName, NodeName];
  /** `"voltage"`: `V(p) − V(n) = expression`; `"current"`: `expression` flows from `p` to `n` through the source. */
  kind: "voltage" | "current";
  expression: string;
}

/**
 * Operational amplifier, `nodes = [non-inverting, inverting, output]`, output referenced to ground.
 * Ideal (virtual short) when `gain` is omitted; otherwise a finite open-loop
 * gain, with an optional gain-bandwidth product `gbw` (Hz) giving a single-pole model.
 * With `vpos` and `vneg` (V, both or neither, `vpos > vneg`), the output saturates
 * smoothly between these rails (non-linear model, open-loop gain 1e6 when ideal).
 */
export interface OpAmpJSON extends ComponentBase {
  type: "opamp";
  nodes: [NodeName, NodeName, NodeName];
  gain?: number;
  gbw?: number;
  /** Positive output rail (V). */
  vpos?: number;
  /** Negative output rail (V). */
  vneg?: number;
}

/** Magnetic coupling between two inductors (SPICE `K`), `0 < k ≤ 1`. */
export interface CouplingJSON extends ComponentBase {
  type: "coupling";
  /** Ids of the two coupled inductors. */
  inductors: [string, string];
  k: number;
}

/** Ideal switch with a fixed state. Modelled by `ron` / `roff` resistances. */
export interface SwitchJSON extends ComponentBase {
  type: "switch";
  nodes: [NodeName, NodeName];
  closed: boolean;
  /** On resistance (default 0 → ideal short). */
  ron?: number;
  /** Off resistance (default ∞ → open circuit). */
  roff?: number;
}

/**
 * Junction diode (SPICE `D`), `nodes = [anode, cathode]`. Its current, from anode
 * to cathode, follows the Shockley law with series resistance and optional reverse
 * breakdown (zener):
 *
 * `I = is·(e^(Vj/(n·Vt)) − 1) − ibv·e^(−(Vj + bv)/(nbv·Vt))`, with `Vj = V(anode, cathode) − rs·I`
 *
 * and `Vt = 25.865 mV` (27 °C). Parameters left out take their SPICE default.
 */
export interface DiodeJSON extends ComponentBase {
  type: "diode";
  nodes: [NodeName, NodeName];
  /** Name of the `.model` card the parameters come from (informative, kept for SPICE export). */
  model?: string;
  /** Saturation current (A, default 1e-14). */
  is?: number;
  /** Emission coefficient (default 1). */
  n?: number;
  /** Series resistance (Ω, default 0). */
  rs?: number;
  /** Reverse breakdown voltage (V, positive): the diode is a zener when set. */
  bv?: number;
  /** Current at the breakdown voltage (A, default 1e-3). */
  ibv?: number;
  /** Emission coefficient of the breakdown (default `n`). */
  nbv?: number;
  /** Zero-bias junction capacitance (F, default 0). */
  cjo?: number;
  /** Junction potential (V, default 1). */
  vj?: number;
  /** Grading coefficient (default 0.5): `C(v) = cjo / (1 − v/vj)^m`. */
  m?: number;
  /** Transit time (s, default 0): adds the diffusion charge `tt·I`. */
  tt?: number;
  /** Forward-bias coefficient (default 0.5): `C(v)` is continued linearly above `fc·vj`. */
  fc?: number;
}

/**
 * Bipolar junction transistor (SPICE `Q`), `nodes = [collector, base, emitter]`,
 * transport (Ebers-Moll / Gummel-Poon without high injection) model:
 *
 * `Ic = (Ibe − Ibc)·(1 − Vbc/vaf − Vbe/var) − Ibc/br`, `Ib = Ibe/bf + Ibc/br`,
 *
 * with `Ibe = is·(e^(Vbe/(nf·Vt)) − 1)` and `Ibc = is·(e^(Vbc/(nr·Vt)) − 1)`
 * (voltages and currents reversed for a PNP). Parameters left out take their
 * SPICE default.
 */
export interface BjtJSON extends ComponentBase {
  type: "bjt";
  nodes: [NodeName, NodeName, NodeName];
  polarity: "npn" | "pnp";
  /** Name of the `.model` card the parameters come from (informative, kept for SPICE export). */
  model?: string;
  /** Transport saturation current (A, default 1e-16). */
  is?: number;
  /** Forward current gain β (default 100). */
  bf?: number;
  /** Reverse current gain (default 1). */
  br?: number;
  /** Forward emission coefficient (default 1). */
  nf?: number;
  /** Reverse emission coefficient (default 1). */
  nr?: number;
  /** Forward Early voltage (V, default ∞: no Early effect). */
  vaf?: number;
  /** Reverse Early voltage (V, default ∞). */
  var?: number;
  /** Zero-bias base-emitter capacitance (F, default 0). */
  cje?: number;
  /** Base-emitter junction potential (V, default 0.75). */
  vje?: number;
  /** Base-emitter grading coefficient (default 0.33). */
  mje?: number;
  /** Zero-bias base-collector capacitance (F, default 0). */
  cjc?: number;
  /** Base-collector junction potential (V, default 0.75). */
  vjc?: number;
  /** Base-collector grading coefficient (default 0.33). */
  mjc?: number;
  /** Forward transit time (s, default 0): diffusion charge `tf·Ibe`. */
  tf?: number;
  /** Reverse transit time (s, default 0): diffusion charge `tr·Ibc`. */
  tr?: number;
  /** Forward-bias coefficient of both depletion capacitances (default 0.5). */
  fc?: number;
}

/**
 * MOSFET (SPICE `M`), `nodes = [drain, gate, source, bulk]`, level 1
 * (Shichman-Hodges) model with `β = kp·w/l` and
 * `Vth = vto + gamma·(√(phi − Vbs) − √phi)`:
 *
 * - cut-off (`Vgs ≤ Vth`): `Id = 0`;
 * - linear (`Vds < Vgs − Vth`): `Id = β·(Vgs − Vth − Vds/2)·Vds·(1 + lambda·Vds)`;
 * - saturation: `Id = β/2·(Vgs − Vth)²·(1 + lambda·Vds)`.
 *
 * Drain and source swap when `Vds < 0`; voltages and currents are reversed for
 * a PMOS (whose `vto` is negative, as in SPICE). Parameters left out take their
 * SPICE default.
 */
export interface MosfetJSON extends ComponentBase {
  type: "mosfet";
  nodes: [NodeName, NodeName, NodeName, NodeName];
  polarity: "nmos" | "pmos";
  /** Name of the `.model` card the parameters come from (informative, kept for SPICE export). */
  model?: string;
  /** Zero-bias threshold voltage (V, default 0; negative for an enhancement PMOS). */
  vto?: number;
  /** Transconductance parameter (A/V², default 2e-5). */
  kp?: number;
  /** Channel-length modulation (1/V, default 0). */
  lambda?: number;
  /** Body-effect coefficient (√V, default 0). */
  gamma?: number;
  /** Surface potential (V, default 0.6). */
  phi?: number;
  /** Gate-source overlap capacitance per metre of width (F/m, default 0). */
  cgso?: number;
  /** Gate-drain overlap capacitance per metre of width (F/m, default 0). */
  cgdo?: number;
  /** Channel width (m, default 100 µm). */
  w?: number;
  /** Channel length (m, default 100 µm). */
  l?: number;
}

/** Any component of the canonical format. */
export type ComponentJSON =
  | ResistorJSON
  | CapacitorJSON
  | InductorJSON
  | VoltageSourceJSON
  | CurrentSourceJSON
  | VcvsJSON
  | VccsJSON
  | CccsJSON
  | CcvsJSON
  | BehavioralSourceJSON
  | OpAmpJSON
  | CouplingJSON
  | SwitchJSON
  | DiodeJSON
  | BjtJSON
  | MosfetJSON;

/** Discriminant of {@link ComponentJSON}. */
export type ComponentType = ComponentJSON["type"];

/** Root document of the canonical format. */
export interface CircuitJSON {
  /** Format version, currently {@link FORMAT_VERSION}. */
  version: number;
  /** Optional circuit title. */
  title?: string;
  /** Ground (reference) node name, default `"0"`. */
  ground?: NodeName;
  /** List of components. */
  components: ComponentJSON[];
}

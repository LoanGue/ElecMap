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
 * Operational amplifier, `nodes = [non-inverting, inverting, output]`, output referenced to ground.
 * Ideal (virtual short) when `gain` is omitted; otherwise a finite open-loop
 * gain, with an optional gain-bandwidth product `gbw` (Hz) giving a single-pole model.
 */
export interface OpAmpJSON extends ComponentBase {
  type: "opamp";
  nodes: [NodeName, NodeName, NodeName];
  gain?: number;
  gbw?: number;
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
  | OpAmpJSON
  | CouplingJSON
  | SwitchJSON;

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

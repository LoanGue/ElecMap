import { ElecMapError } from "../core/errors";
import type { NodeName } from "../format/types";
import { Complex } from "../math/complex";
import type { Polynomial } from "../math/polynomial";
import type { MnaSystem } from "../mna/system";
import { dcValues } from "../mna/system";
import { acAnalysis } from "./ac";
import { operatingPoint } from "./dc";
import { computeRational, TransferFunction, transferFunction } from "./transfer";

/**
 * Impedance `Z(s)` seen between nodes `a` and `b` with every independent source
 * turned off (voltage sources shorted, current sources opened).
 *
 * The result is a {@link TransferFunction} of `s`, so all its helpers apply:
 * `Z.evaluate(freq)` gives the complex impedance at a frequency, `Z.dcGain()` the DC resistance.
 */
export function impedance(
  system: MnaSystem,
  a: NodeName,
  b: NodeName = system.circuit.ground,
): TransferFunction {
  const ia = system.node(a);
  const ib = system.node(b);
  if (ia === ib) {
    throw new ElecMapError(
      "INVALID_ARGUMENT",
      `Impedance between a node and itself ("${a}", "${b}")`,
    );
  }
  // 1 A test current injected into `a` and drawn from `b`.
  const rhs = new Array<Complex>(system.size).fill(Complex.ZERO);
  if (ia >= 0) rhs[ia] = Complex.ONE;
  if (ib >= 0) rhs[ib] = new Complex(-1);
  const rational = computeRational(system, rhs, system.voltageForm(a, b), () => 0);
  return new TransferFunction(rational, { output: `Z(${a},${b})` });
}

/** Input impedance seen by an independent source: `V / I` delivered by the source. */
export function inputImpedance(system: MnaSystem, source: string): TransferFunction {
  const c = system.circuit.component(source);
  if (c.type === "isource") {
    // The source pushes its current into its second node.
    return impedance(system, c.nodes[1], c.nodes[0]);
  }
  if (c.type !== "vsource") {
    throw new ElecMapError("INVALID_ARGUMENT", `"${source}" is not an independent source`, {
      componentId: source,
    });
  }
  // Delivered current is −I(V) (SPICE convention), so Z = −1 / (I/V).
  const y = transferFunction(system, { input: source, output: { current: source } });
  if (y.numerator.isZero()) {
    throw new ElecMapError(
      "INVALID_ARGUMENT",
      `"${source}" delivers no current: its input impedance is infinite`,
      {
        componentId: source,
      },
    );
  }
  return new TransferFunction(y.rational.inv().neg(), { output: `Zin(${source})` });
}

const isNegligible = (c: number, scale: number) => Math.abs(c) <= 1e-9 * scale;

/** Coefficients of `p` other than the one of degree `keep`, relative to its norm, are negligible. */
function isMonomial(p: Polynomial, keep: number): boolean {
  const scale = p.norm();
  return (
    p.coeffs.every((c, k) => k === keep || isNegligible(c, scale)) &&
    !isNegligible(p.coeff(keep), scale)
  );
}

/** Options for equivalent R / L / C. */
export interface EquivalentOptions {
  /**
   * `"strict"` (default): throw `NOT_HOMOGENEOUS` if the network is not purely
   * resistive / capacitive / inductive. `"dc"` (resistance only): return the DC
   * resistance `Z(0)` of any network. `"freq"`: value of the equivalent component
   * at {@link EquivalentOptions.freq} (`Re Z`, `−1/(ω·Im Z)` or `Im Z / ω`).
   */
  mode?: "strict" | "dc" | "freq";
  /** Frequency (Hz) for `mode: "freq"`. */
  freq?: number;
}

function notHomogeneous(kind: string, z: TransferFunction): never {
  throw new ElecMapError(
    "NOT_HOMOGENEOUS",
    `The network is not purely ${kind}: Z(s) = ${z.rational.toString()}. Use { mode: "freq", freq } for a frequency-dependent value.`,
    { impedance: z.rational.toString() },
  );
}

function atFreq(z: TransferFunction, options: EquivalentOptions): Complex {
  if (options.freq === undefined || !(options.freq > 0)) {
    throw new ElecMapError("INVALID_ARGUMENT", '`mode: "freq"` requires a frequency > 0');
  }
  return z.evaluate(options.freq);
}

/** Equivalent resistance (Ω) between two nodes. */
export function equivalentResistance(z: TransferFunction, options: EquivalentOptions = {}): number {
  const mode = options.mode ?? "strict";
  if (mode === "dc") return z.dcGain();
  if (mode === "freq") return atFreq(z, options).re;
  if (z.numerator.isZero()) return 0;
  if (z.numerator.degree === 0 && z.denominator.degree === 0) return z.dcGain();
  return notHomogeneous("resistive", z);
}

/** Equivalent capacitance (F) between two nodes: `Z(s) = 1 / (C·s)`. */
export function equivalentCapacitance(
  z: TransferFunction,
  options: EquivalentOptions = {},
): number {
  if ((options.mode ?? "strict") === "freq") {
    const w = 2 * Math.PI * (options.freq ?? 0);
    return -1 / (w * atFreq(z, options).im);
  }
  if (z.numerator.degree === 0 && isMonomial(z.denominator, 1)) {
    return z.denominator.coeff(1) / z.numerator.coeff(0);
  }
  return notHomogeneous("capacitive", z);
}

/** Equivalent inductance (H) between two nodes: `Z(s) = L·s`. */
export function equivalentInductance(z: TransferFunction, options: EquivalentOptions = {}): number {
  if ((options.mode ?? "strict") === "freq") {
    const w = 2 * Math.PI * (options.freq ?? 0);
    return atFreq(z, options).im / w;
  }
  if (z.denominator.degree === 0 && isMonomial(z.numerator, 1)) {
    return z.numerator.coeff(1) / z.denominator.coeff(0);
  }
  return notHomogeneous("inductive", z);
}

/** DC Thévenin / Norton equivalent. */
export interface DcEquivalent {
  /** Open-circuit voltage `V(a) − V(b)` (V). */
  voltage: number;
  /** Thévenin resistance (Ω), `Infinity` if no DC path. */
  resistance: number;
  /** Norton (short-circuit) current from `a` to `b` through the short (A). */
  current: number;
  /** Load resistance for maximum power transfer (Ω). */
  optimalLoad: number;
  /** Maximum power deliverable to a load (W). */
  maxPower: number;
}

/** AC Thévenin / Norton equivalent at one frequency (phasors). */
export interface AcEquivalent {
  freq: number;
  voltage: Complex;
  impedance: Complex;
  current: Complex;
  /** Load impedance for maximum power transfer (conjugate match). */
  optimalLoad: Complex;
  /** Maximum average power deliverable to a load (W), for peak-amplitude phasors. */
  maxPower: number;
}

/**
 * Thévenin / Norton equivalent seen between `a` and `b`, in DC. For a
 * non-linear circuit, pass the small-signal system: the resistance is then the
 * incremental (dynamic) resistance at the operating point.
 */
export function theveninDc(
  system: MnaSystem,
  a: NodeName,
  b?: NodeName,
  smallSignal: MnaSystem = system,
): DcEquivalent {
  const z = impedance(smallSignal, a, b);
  const voltage = operatingPoint(system, { values: dcValues }).voltage(a, b);
  const resistance = z.dcGain();
  const current = resistance === 0 ? Math.sign(voltage) * Infinity : voltage / resistance;
  return {
    voltage,
    resistance,
    current,
    optimalLoad: resistance,
    maxPower: resistance > 0 ? (voltage * voltage) / (4 * resistance) : Infinity,
  };
}

/** Thévenin / Norton equivalent seen between `a` and `b` at a frequency (sources at their AC value). */
export function theveninAc(
  system: MnaSystem,
  freq: number,
  a: NodeName,
  b?: NodeName,
): AcEquivalent {
  const z = impedance(system, a, b).evaluate(freq);
  const voltage = acAnalysis(system, freq).voltage(a, b);
  const r = z.re;
  return {
    freq,
    voltage,
    impedance: z,
    current: voltage.div(z),
    optimalLoad: z.conj(),
    maxPower: r > 0 ? voltage.abs() ** 2 / (8 * r) : Infinity,
  };
}

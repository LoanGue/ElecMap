import { ElecMapError } from "../core/errors";
import type { NodeName } from "../format/types";
import { Complex } from "../math/complex";
import { ComplexLU } from "../math/linear";
import type { MnaSystem, SourceValues } from "../mna/system";
import { acValues, singleSource } from "../mna/system";
import { AcSolution } from "./solution";

/** Which sources drive an AC analysis. */
export interface AcExcitation {
  /**
   * Id of the single independent source driving the circuit (with phasor `amplitude`,
   * all other sources off). When omitted, every source uses its own `ac` specification.
   */
  input?: string;
  /** Phasor of the `input` source (default 1∠0°). */
  amplitude?: number | Complex;
}

/** Options for {@link acSweep}. */
export interface AcSweepOptions extends AcExcitation {
  /** Start frequency (Hz). */
  fStart: number;
  /** Stop frequency (Hz). */
  fStop: number;
  /** Points per decade (log scale, default 20) or total points (linear scale, default 100). */
  points?: number;
  /** Frequency scale (default `"log"`). */
  scale?: "log" | "linear";
}

/** Resolves the source values of an AC excitation. */
export function acSourceValues(system: MnaSystem, excitation: AcExcitation = {}): SourceValues {
  if (excitation.input !== undefined) {
    const c = system.circuit.component(excitation.input);
    if (c.type !== "vsource" && c.type !== "isource") {
      throw new ElecMapError(
        "INVALID_ARGUMENT",
        `Input "${excitation.input}" must be an independent source`,
        {
          componentId: excitation.input,
        },
      );
    }
    return singleSource(excitation.input, excitation.amplitude ?? 1);
  }
  const hasAc = system.circuit.components.some(
    (c) => (c.type === "vsource" || c.type === "isource") && c.ac !== undefined && c.ac.mag !== 0,
  );
  if (!hasAc) {
    throw new ElecMapError(
      "INVALID_ARGUMENT",
      "No AC excitation: pass `input` (a source id) or give a source an AC value (e.g. `V1 in 0 AC 1`)",
    );
  }
  return acValues;
}

/**
 * Small-signal AC analysis at one frequency (sinusoidal steady state, phasors).
 *
 * @throws {@link ElecMapError} `SINGULAR_MATRIX` (e.g. exactly at the resonance of an ideal LC loop)
 */
export function acAnalysis(
  system: MnaSystem,
  freq: number,
  excitation: AcExcitation = {},
): AcSolution {
  if (!Number.isFinite(freq) || freq < 0) {
    throw new ElecMapError(
      "INVALID_ARGUMENT",
      `Frequency must be a finite number ≥ 0 (got ${freq})`,
    );
  }
  const values = acSourceValues(system, excitation);
  const s = new Complex(0, 2 * Math.PI * freq);
  const x = new ComplexLU(system.matrixAt(s)).solve(system.rhs(values));
  return new AcSolution(system, freq, x, values);
}

/** Frequencies of a sweep. */
export function sweepFrequencies(options: Omit<AcSweepOptions, keyof AcExcitation>): number[] {
  const { fStart, fStop } = options;
  const scale = options.scale ?? "log";
  if (!(fStart >= 0 && fStop > fStart) || (scale === "log" && fStart <= 0)) {
    throw new ElecMapError("INVALID_ARGUMENT", `Invalid frequency range [${fStart}, ${fStop}]`);
  }
  if (scale === "linear") {
    const n = Math.max(2, Math.round(options.points ?? 100));
    return Array.from({ length: n }, (_, i) => fStart + ((fStop - fStart) * i) / (n - 1));
  }
  const perDecade = Math.max(1, options.points ?? 20);
  const decades = Math.log10(fStop / fStart);
  const n = Math.max(2, Math.round(decades * perDecade) + 1);
  return Array.from({ length: n }, (_, i) => fStart * Math.pow(10, (decades * i) / (n - 1)));
}

/** Result of an AC sweep. */
export class AcSweep {
  /** @internal */
  constructor(
    /** Frequencies (Hz). */
    readonly freqs: readonly number[],
    /** Solution at each frequency. */
    readonly solutions: readonly AcSolution[],
  ) {}

  /** Voltage phasor `V(a) − V(b)` at each frequency. */
  voltage(a: NodeName, b?: NodeName): Complex[] {
    return this.solutions.map((s) => s.voltage(a, b));
  }

  /** Current phasor through a component at each frequency. */
  current(id: string): Complex[] {
    return this.solutions.map((s) => s.current(id));
  }
}

/** AC analysis over a range of frequencies. */
export function acSweep(system: MnaSystem, options: AcSweepOptions): AcSweep {
  const freqs = sweepFrequencies(options);
  const excitation: AcExcitation = {};
  if (options.input !== undefined) excitation.input = options.input;
  if (options.amplitude !== undefined) excitation.amplitude = options.amplitude;
  return new AcSweep(
    freqs,
    freqs.map((f) => acAnalysis(system, f, excitation)),
  );
}

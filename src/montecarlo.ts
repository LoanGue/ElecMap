/**
 * Monte-Carlo tolerance analysis: the circuit analysed many times with every
 * toleranced component drawn at random within its tolerance.
 */
import type { ElecMap } from "./ElecMap";
import type { BodeOptions, BodePlot, OutputSpec, TransferOptions } from "./analysis/transfer";

/** Distribution of a toleranced value around its nominal value. */
export type ToleranceDistribution = "uniform" | "gaussian";

/** Tolerance of one component field. */
export interface ToleranceSpec {
  /** Relative tolerance: `0.05` for ±5 %. */
  tolerance: number;
  /** Distribution (default: the one of {@link MonteCarloOptions.distribution}). */
  distribution?: ToleranceDistribution;
}

/** Options of {@link ElecMap.monteCarlo}. */
export interface MonteCarloOptions {
  /**
   * Relative tolerance per component: `{ R1: 0.05, C1: 0.1 }`. The key is a
   * component id (its default field, as in {@link ElecMap.setValue}) or
   * `"id.field"` for another field (`"Q1.bf"`).
   */
  tolerances: Record<string, number | ToleranceSpec>;
  /** Number of random circuits (default 100). */
  runs?: number;
  /**
   * `"uniform"` (default): any value in `[p·(1−t), p·(1+t)]` is equally likely.
   * `"gaussian"`: normal law with σ = t/3, so 99.7 % of the values fall within
   * the tolerance (values beyond it are kept, as on a real production batch).
   */
  distribution?: ToleranceDistribution;
  /** Seed of the random generator (default 1): the same seed gives the same runs. */
  seed?: number;
}

/** One random draw: the value of every toleranced field. */
export interface MonteCarloSample {
  /** Run index, from 0. */
  run: number;
  /** Drawn values, keyed like {@link MonteCarloOptions.tolerances}. */
  values: Record<string, number>;
}

/** Statistics of a quantity over the runs. */
export interface MonteCarloStatistics {
  /** Value on the nominal circuit. */
  nominal: number;
  /** One value per run. */
  values: number[];
  mean: number;
  /** Standard deviation (sample, n − 1). */
  std: number;
  min: number;
  max: number;
  /** Value below which the fraction `p` of the runs fall (`percentile(0.95)`). */
  percentile(p: number): number;
}

/** Spread of a curve, point by point. */
export interface MonteCarloBand {
  min: number[];
  max: number[];
  mean: number[];
  std: number[];
}

/** Bode diagrams of every run, on the frequency grid of the nominal circuit. */
export interface MonteCarloBode {
  freq: number[];
  nominal: BodePlot;
  runs: BodePlot[];
  /** Envelope of the magnitude, in dB. */
  magnitudeDb: MonteCarloBand;
  /** Envelope of the (unwrapped) phase, in degrees. */
  phase: MonteCarloBand;
}

/**
 * Result of {@link ElecMap.monteCarlo}: the drawn values and the random circuits,
 * with helpers to compute statistics and Bode envelopes over them. Circuits are
 * built on demand, so drawing many runs is cheap until something is analysed.
 */
export class MonteCarlo {
  /** Drawn values of every run. */
  readonly samples: readonly MonteCarloSample[];
  private readonly built: (ElecMap | undefined)[];

  /** @internal Built by {@link ElecMap.monteCarlo}. */
  constructor(
    /** The circuit with its nominal values. */
    readonly nominal: ElecMap,
    samples: MonteCarloSample[],
    private readonly make: (sample: MonteCarloSample) => ElecMap,
  ) {
    this.samples = samples;
    this.built = samples.map(() => undefined);
  }

  /** Number of runs. */
  get length(): number {
    return this.samples.length;
  }

  /** Circuit of run `i`, with its drawn values. */
  circuit(i: number): ElecMap {
    const sample = this.samples[i];
    if (!sample) throw new RangeError(`Run ${i} does not exist (${this.samples.length} runs)`);
    return (this.built[i] ??= this.make(sample));
  }

  /** Every random circuit. */
  circuits(): ElecMap[] {
    return this.samples.map((_, i) => this.circuit(i));
  }

  /**
   * A quantity computed on the nominal circuit and on every run, with its
   * statistics. A run where the quantity is `undefined` (no cut-off frequency,
   * for instance) counts as `NaN` in `values` and is left out of the statistics.
   */
  statistics(measure: (circuit: ElecMap) => number | undefined): MonteCarloStatistics {
    const value = (c: ElecMap) => measure(c) ?? NaN;
    return statistics(
      value(this.nominal),
      this.samples.map((_, i) => value(this.circuit(i))),
    );
  }

  /**
   * Bode diagram of a transfer function on every run, and its envelope. The
   * frequency grid is the one of the nominal circuit (`options` as in
   * {@link TransferFunction.bode}).
   */
  bode(spec: OutputSpec | TransferOptions, options: BodeOptions = {}): MonteCarloBode {
    const nominal = this.nominal.transferFunction(spec).bode(options);
    const grid: BodeOptions = {
      fStart: nominal.freq[0] as number,
      fStop: nominal.freq[nominal.freq.length - 1] as number,
      points: options.points ?? 50,
    };
    const runs = this.samples.map((_, i) => this.circuit(i).transferFunction(spec).bode(grid));
    return {
      freq: nominal.freq,
      nominal,
      runs,
      magnitudeDb: band(runs.map((r) => r.magnitudeDb)),
      phase: band(runs.map((r) => r.phase)),
    };
  }
}

/** Deterministic generator (mulberry32), uniform in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Relative deviation in units of the tolerance: uniform in [−1, 1], or normal with σ = 1/3. */
export function drawDeviation(random: () => number, distribution: ToleranceDistribution): number {
  if (distribution === "uniform") return 2 * random() - 1;
  // Box-Muller.
  const u = 1 - random();
  const v = random();
  return (Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)) / 3;
}

function statistics(nominal: number, values: number[]): MonteCarloStatistics {
  const sorted = values.filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1 ? sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  return {
    nominal,
    values,
    mean,
    std: Math.sqrt(variance),
    min: sorted[0] ?? NaN,
    max: sorted[n - 1] ?? NaN,
    percentile(p: number): number {
      if (n === 0) return NaN;
      const k = Math.min(Math.max(p, 0), 1) * (n - 1);
      const lo = Math.floor(k);
      const hi = Math.ceil(k);
      return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (k - lo);
    },
  };
}

function band(curves: number[][]): MonteCarloBand {
  const length = curves[0]?.length ?? 0;
  const result: MonteCarloBand = { min: [], max: [], mean: [], std: [] };
  for (let i = 0; i < length; i++) {
    const s = statistics(
      NaN,
      curves.map((c) => c[i] as number),
    );
    result.min.push(s.min);
    result.max.push(s.max);
    result.mean.push(s.mean);
    result.std.push(s.std);
  }
  return result;
}

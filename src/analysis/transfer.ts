import { ElecMapError } from "../core/errors";
import { polynomialToLatex } from "../format/latex";
import type { NodeName } from "../format/types";
import { Complex } from "../math/complex";
import { ComplexLU } from "../math/linear";
import { Polynomial } from "../math/polynomial";
import { Rational } from "../math/rational";
import { polynomialRoots } from "../math/roots";
import type { LinearForm } from "../mna/models";
import type { MnaSystem, SourceValues } from "../mna/system";
import { singleSource } from "../mna/system";
import type { ResponseOptions, StepMetrics, TimeResponse } from "./response";
import { defaultDuration, impulseResponseOf, simulateResponse, stepMetrics } from "./response";
import type { Signal } from "./waveforms";

// ------------------------------------------------------------------ specs

/**
 * Output quantity of a transfer function:
 * - a node name: its voltage to ground;
 * - a pair of nodes `[a, b]`: the voltage `V(a) − V(b)`;
 * - `{ current: id }`: the current through a component.
 */
export type OutputSpec = NodeName | readonly [NodeName, NodeName] | { readonly current: string };

/** Options for {@link transferFunction}. */
export interface TransferOptions {
  /**
   * Id of the independent source used as input. Optional when the circuit has a
   * single AC source or a single independent source.
   */
  input?: string;
  output: OutputSpec;
}

/** Returns the id of the input source, picking the obvious one when not given. */
export function resolveInput(system: MnaSystem, input?: string): string {
  const sources = system.circuit.components.filter(
    (c) => c.type === "vsource" || c.type === "isource",
  );
  if (input !== undefined) {
    const c = system.circuit.component(input);
    if (c.type !== "vsource" && c.type !== "isource") {
      throw new ElecMapError("INVALID_ARGUMENT", `Input "${input}" must be an independent source`, {
        componentId: input,
      });
    }
    return input;
  }
  const ac = sources.filter((c) => c.ac !== undefined && c.ac.mag !== 0);
  if (ac.length === 1) return (ac[0] as { id: string }).id;
  if (sources.length === 1) return (sources[0] as { id: string }).id;
  throw new ElecMapError(
    "INVALID_ARGUMENT",
    `Cannot choose the input source automatically (${sources.length} sources): pass \`input\``,
    { sources: sources.map((c) => c.id) },
  );
}

/** Linear form and description of an output specification. */
export function outputForm(
  system: MnaSystem,
  output: OutputSpec,
): { form: LinearForm; label: string } {
  if (typeof output === "string") {
    return { form: system.voltageForm(output), label: `V(${output})` };
  }
  if (Array.isArray(output)) {
    const [a, b] = output as readonly [NodeName, NodeName];
    return { form: system.voltageForm(a, b), label: `V(${a},${b})` };
  }
  const { current } = output as { current: string };
  return { form: system.currentForm(current), label: `I(${current})` };
}

// ------------------------------------------------------------------ computation

const TWO_PI = 2 * Math.PI;

/**
 * Computes the rational function `y(s) / u` where `y` is a linear form of the MNA
 * unknowns and the right-hand side is `b·u`.
 *
 * Instead of a fraction-free determinant on polynomial entries (which loses
 * accuracy in floating point when component values span many decades), the
 * circuit determinant `D(s) = det(G + s·C)` and the numerator `N(s) = y(s)·D(s)`
 * are sampled on a circle `s = σ·e^{iθ}` and their coefficients recovered by a
 * discrete Fourier transform. The frequency scale `σ` is chosen from the
 * matrices, then refined from the poles, so that the polynomials are well
 * conditioned. Pole/zero pairs that cancel are removed.
 */
export function computeRational(
  system: MnaSystem,
  b: readonly Complex[],
  form: LinearForm,
  values: SourceValues,
): Rational {
  if (system.size === 0) {
    throw new ElecMapError("INVALID_CIRCUIT", "The circuit has no unknowns");
  }
  let sigma = initialScale(system);
  let result = interpolate(system, b, form, values, sigma);
  const poles = result.denRoots.filter((r) => r.abs() > 0).map((r) => r.abs() * sigma);
  if (poles.length > 0) {
    const refined = Math.exp(poles.reduce((acc, m) => acc + Math.log(m), 0) / poles.length);
    if (Math.abs(Math.log(refined / sigma)) > 1) {
      sigma = refined;
      result = interpolate(system, b, form, values, sigma);
    }
  }
  return new Rational(result.num.scaleVariable(1 / sigma), result.den.scaleVariable(1 / sigma));
}

/** Frequency scale (rad/s) estimated from the ratio of static to dynamic entries. */
function initialScale(system: MnaSystem): number {
  let logs = 0;
  let count = 0;
  system.C.forEach((row, i) => {
    const gmax = Math.max(...(system.G[i] as readonly number[]).map(Math.abs));
    for (const c of row) {
      if (c === 0 || gmax === 0) continue;
      logs += Math.log(gmax / Math.abs(c));
      count++;
    }
  });
  return count === 0 ? 1 : Math.exp(logs / count);
}

interface Interpolation {
  num: Polynomial;
  den: Polynomial;
  denRoots: Complex[];
}

function interpolate(
  system: MnaSystem,
  b: readonly Complex[],
  form: LinearForm,
  values: SourceValues,
  sigma: number,
): Interpolation {
  const m = system.size + 1;
  for (const offset of [0.1234, 0.4321, 0.2718]) {
    const thetas = Array.from({ length: m }, (_, k) => offset + (TWO_PI * k) / m);
    const dSamples: Complex[] = [];
    const nSamples: Complex[] = [];
    let yMax = 0;
    let yScale = 0;
    let singular = false;
    for (const theta of thetas) {
      const s = Complex.fromPolar(sigma, theta);
      let lu: ComplexLU;
      try {
        lu = new ComplexLU(system.matrixAt(s));
      } catch (e) {
        if (e instanceof ElecMapError && e.code === "SINGULAR_MATRIX") {
          singular = true;
          break;
        }
        throw e;
      }
      const x = lu.solve(b);
      const y = system.evaluate(form, x, s, values);
      const det = lu.determinant();
      dSamples.push(det);
      nSamples.push(y.mul(det));
      yMax = Math.max(yMax, y.abs());
      yScale = Math.max(yScale, magnitudeScale(form, x, s, values, system));
    }
    if (singular) continue;

    const den = new Polynomial(dft(dSamples, thetas)).trim(1e-11);
    if (den.isZero()) break;
    const outputIsZero = yMax <= 1e-12 * yScale;
    const num = outputIsZero
      ? Polynomial.zero()
      : new Polynomial(dft(nSamples, thetas)).trim(1e-11);
    return cancelCommon(num, den);
  }
  throw new ElecMapError(
    "SINGULAR_MATRIX",
    "The circuit equations are singular for every frequency (check for floating parts or ideal loops)",
  );
}

/** Size of the terms entering a linear form, to detect outputs that cancel exactly. */
function magnitudeScale(
  form: LinearForm,
  x: readonly Complex[],
  s: Complex,
  values: SourceValues,
  system: MnaSystem,
): number {
  let acc = 0;
  for (const t of form.terms) {
    acc += new Complex(t.g + s.re * t.c, s.im * t.c).abs() * (x[t.index] as Complex).abs();
  }
  for (const { id, factor } of form.sources) {
    acc += Math.abs(factor) * Complex.from(values(system.circuit.component(id))).abs();
  }
  return acc;
}

/** Real coefficients `c_k` of `Σ c_k·e^{ikθ}` from samples at `thetas` (uniform, with offset). */
function dft(samples: readonly Complex[], thetas: readonly number[]): number[] {
  const m = samples.length;
  const coeffs = new Array<number>(m).fill(0);
  for (let k = 0; k < m; k++) {
    let acc = Complex.ZERO;
    samples.forEach((v, j) => {
      acc = acc.add(v.mul(Complex.fromPolar(1, -k * (thetas[j] as number))));
    });
    coeffs[k] = acc.re / m;
  }
  return coeffs;
}

/** Removes pole/zero pairs that coincide (uncontrollable or unobservable modes). */
function cancelCommon(num: Polynomial, den: Polynomial): Interpolation {
  const denRoots = den.degree > 0 ? polynomialRoots(den) : [];
  if (num.degree < 1 || den.degree < 1) return { num, den, denRoots };
  const zeros = polynomialRoots(num);
  const keptPoles: Complex[] = [];
  let cancelled = false;
  for (const p of denRoots) {
    const tol = 1e-6 * Math.max(1, p.abs());
    const i = zeros.findIndex((z) => z.sub(p).abs() <= tol);
    if (i >= 0) {
      zeros.splice(i, 1);
      cancelled = true;
    } else {
      keptPoles.push(p);
    }
  }
  if (!cancelled) return { num, den, denRoots };
  return {
    num: Polynomial.fromRoots(zeros).scale(num.leading()),
    den: Polynomial.fromRoots(keptPoles).scale(den.leading()),
    denRoots: keptPoles,
  };
}

/** Transfer function `output / input` of a circuit (all other sources off). */
export function transferFunction(system: MnaSystem, options: TransferOptions): TransferFunction {
  const input = resolveInput(system, options.input);
  const { form, label } = outputForm(system, options.output);
  const values = singleSource(input, 1);
  const rational = computeRational(system, system.rhs(values), form, values);
  return new TransferFunction(rational, { input, output: label });
}

// ------------------------------------------------------------------ result

/** A sinusoid `amplitude · sin(2π·freq·t + phase)`; `phase` in degrees. */
export interface Sinusoid {
  amplitude: number;
  /** Frequency (Hz). */
  freq: number;
  /** Phase (degrees, default 0). */
  phase?: number;
}

/** Periodic input: DC offset plus a sum of sinusoids. */
export interface PeriodicSignal {
  offset?: number;
  components?: readonly Sinusoid[];
}

/** Anything {@link TransferFunction.apply} accepts: a DC value, one or several sinusoids, or both. */
export type InputSignal = number | Sinusoid | readonly Sinusoid[] | PeriodicSignal;

/** Output sinusoid of {@link SteadyStateResponse}. */
export interface OutputSinusoid {
  amplitude: number;
  freq: number;
  /** Phase (degrees). */
  phase: number;
  /** Complex gain `H(j·2π·freq)` applied to this component. */
  gain: Complex;
}

/** Sinusoidal steady-state output of a linear system. */
export interface SteadyStateResponse {
  /** DC component of the output. */
  offset: number;
  components: OutputSinusoid[];
  /** Output value at time `t` (s). */
  at(t: number): number;
  /** Output values at several times. */
  sample(times: readonly number[]): number[];
}

/** Options for {@link TransferFunction.bode}. */
export interface BodeOptions {
  /** Start frequency (Hz, default: two decades below the lowest pole/zero). */
  fStart?: number;
  /** Stop frequency (Hz, default: two decades above the highest pole/zero). */
  fStop?: number;
  /** Points per decade (default 50). */
  points?: number;
}

/** Bode diagram data. */
export interface BodePlot {
  freq: number[];
  magnitude: number[];
  magnitudeDb: number[];
  /** Unwrapped phase (degrees). */
  phase: number[];
}

/** Options for {@link TransferFunction.toLatex}. */
export interface TransferLatexOptions {
  /** Significant digits (default 4). */
  digits?: number;
  /** Variable (default `s`). */
  variable?: string;
  /**
   * Normalisation: `"constant"` (default, `… / (1 + a·s + …)`), `"monic"`
   * (`… / (s^n + …)`) or `"none"`.
   */
  normalize?: "constant" | "monic" | "none";
  /** Term order (default ascending for `"constant"`, descending otherwise). */
  order?: "ascending" | "descending";
  /** Left-hand side, e.g. `"H(s)"` gives `H(s) = \frac{…}{…}`. */
  name?: string;
}

/** Classification of a frequency response. */
export type FilterType =
  "lowpass" | "highpass" | "bandpass" | "bandstop" | "allpass" | "flat" | "other";

/**
 * A rational transfer function `H(s) = N(s) / D(s)` with real coefficients,
 * with frequency-domain helpers. Frequencies are in hertz, poles and zeros in rad/s.
 */
export class TransferFunction {
  /** `H(s)`, normalised so that the lowest-order denominator coefficient is 1. */
  readonly rational: Rational;
  /** Input source id and output label, when computed from a circuit. */
  readonly meta: { input?: string; output?: string };

  private polesCache: Complex[] | undefined;
  private zerosCache: Complex[] | undefined;

  constructor(rational: Rational, meta: { input?: string; output?: string } = {}) {
    this.rational = rational.num.isZero()
      ? new Rational(Polynomial.zero(), Polynomial.constant(1))
      : rational.normalize("constant");
    this.meta = meta;
  }

  /** Builds `H(s)` from ascending coefficient arrays: `[b0, b1, …] / [a0, a1, …]`. */
  static fromCoefficients(num: readonly number[], den: readonly number[]): TransferFunction {
    return new TransferFunction(new Rational(new Polynomial(num), new Polynomial(den)));
  }

  /** Numerator `N(s)`. */
  get numerator(): Polynomial {
    return this.rational.num;
  }

  /** Denominator `D(s)`. */
  get denominator(): Polynomial {
    return this.rational.den;
  }

  /** Order of the system (degree of the denominator). */
  get order(): number {
    return Math.max(0, this.denominator.degree);
  }

  /** `deg D − deg N` (negative for improper functions). */
  get relativeDegree(): number {
    return this.numerator.isZero() ? Infinity : this.denominator.degree - this.numerator.degree;
  }

  /** `H(s)` at a complex point. */
  at(s: Complex | number): Complex {
    return this.rational.evaluate(s);
  }

  /** Frequency response `H(j·2πf)`. */
  evaluate(freq: number): Complex {
    return this.at(new Complex(0, TWO_PI * freq));
  }

  /** `|H(j·2πf)|`. */
  magnitude(freq: number): number {
    return this.evaluate(freq).abs();
  }

  /** `20·log10 |H(j·2πf)|` (dB). */
  magnitudeDb(freq: number): number {
    return 20 * Math.log10(this.magnitude(freq));
  }

  /** `arg H(j·2πf)` in degrees, in (−180, 180]. */
  phase(freq: number): number {
    return (this.evaluate(freq).arg() * 180) / Math.PI;
  }

  /** `lim H(s)` for `s → 0` (±Infinity for integrators). */
  dcGain(): number {
    return limitRatio(this.numerator, this.denominator, "low");
  }

  /** `lim H(s)` for `s → ∞` (±Infinity for improper functions). */
  highFrequencyGain(): number {
    return limitRatio(this.numerator, this.denominator, "high");
  }

  /** Poles (rad/s), sorted by magnitude. */
  poles(): Complex[] {
    return [
      ...(this.polesCache ??= this.denominator.degree > 0 ? polynomialRoots(this.denominator) : []),
    ];
  }

  /** Zeros (rad/s), sorted by magnitude. */
  zeros(): Complex[] {
    return [
      ...(this.zerosCache ??= this.numerator.degree > 0 ? polynomialRoots(this.numerator) : []),
    ];
  }

  /** True if every pole has a strictly negative real part. */
  isStable(): boolean {
    return this.poles().every((p) => p.re < -1e-12 * Math.max(1, p.abs()));
  }

  /** Time constants `τ = −1/Re(p)` (s) of the stable poles, one per real pole or conjugate pair. */
  timeConstants(): number[] {
    return this.poles()
      .filter((p) => p.re < 0 && p.im >= 0)
      .map((p) => -1 / p.re);
  }

  /** Natural frequency (Hz) of the dominant complex pole pair, or of a second-order real-pole system. */
  naturalFrequency(): number | undefined {
    const pair = this.dominantPair();
    return pair && pair.omega0 / TWO_PI;
  }

  /** Quality factor of the dominant pole pair (see {@link naturalFrequency}). */
  qFactor(): number | undefined {
    return this.dominantPair()?.q;
  }

  /** Damping ratio `ζ = 1 / (2Q)` of the dominant pole pair. */
  dampingRatio(): number | undefined {
    const q = this.qFactor();
    return q === undefined ? undefined : 1 / (2 * q);
  }

  private dominantPair(): { omega0: number; q: number } | undefined {
    const poles = this.poles();
    const complex = poles.find((p) => p.im > 0);
    if (complex) {
      const omega0 = complex.abs();
      return { omega0, q: complex.re === 0 ? Infinity : omega0 / (-2 * complex.re) };
    }
    if (poles.length === 2) {
      const [p1, p2] = poles as [Complex, Complex];
      const product = p1.re * p2.re;
      if (product <= 0) return undefined;
      const omega0 = Math.sqrt(product);
      return { omega0, q: omega0 / -(p1.re + p2.re) };
    }
    return undefined;
  }

  /** Default frequency range (Hz) covering every pole and zero. */
  frequencyRange(decadesAround = 2): [number, number] {
    const mags = [...this.poles(), ...this.zeros()].map((r) => r.abs()).filter((m) => m > 0);
    if (mags.length === 0) return [1, 1e6];
    const lo = Math.min(...mags) / TWO_PI;
    const hi = Math.max(...mags) / TWO_PI;
    return [lo / 10 ** decadesAround, hi * 10 ** decadesAround];
  }

  /** Bode diagram: magnitude (linear and dB) and unwrapped phase over a log sweep. */
  bode(options: BodeOptions = {}): BodePlot {
    const [defStart, defStop] = this.frequencyRange();
    const freq = logGrid(
      options.fStart ?? defStart,
      options.fStop ?? defStop,
      options.points ?? 50,
    );
    const h = freq.map((f) => this.evaluate(f));
    const magnitude = h.map((z) => z.abs());
    const phase: number[] = [];
    let previous: number | undefined;
    let shift = 0;
    for (const z of h) {
      let p = (z.arg() * 180) / Math.PI + shift;
      if (previous !== undefined) {
        while (p - previous > 180) {
          p -= 360;
          shift -= 360;
        }
        while (p - previous < -180) {
          p += 360;
          shift += 360;
        }
      }
      phase.push(p);
      previous = p;
    }
    return { freq, magnitude, magnitudeDb: magnitude.map((m) => 20 * Math.log10(m)), phase };
  }

  /** Classifies the magnitude response (low-pass, high-pass, band-pass…). */
  filterType(): FilterType {
    if (this.numerator.isZero()) return "other";
    if (this.order === 0 && this.numerator.degree <= 0) return "flat";
    const g0 = Math.abs(this.dcGain());
    const gInf = Math.abs(this.highFrequencyGain());
    if (!Number.isFinite(g0) || !Number.isFinite(gInf)) return "other";
    const { peak, min } = this.extremes();
    const ref = Math.max(g0, gInf, peak);
    const small = (g: number) => g <= 1e-6 * ref;
    if (!small(g0) && small(gInf)) return "lowpass";
    if (small(g0) && !small(gInf)) return "highpass";
    if (small(g0) && small(gInf)) return "bandpass";
    if (min < 0.5 * Math.min(g0, gInf)) return "bandstop";
    if (peak <= 1.001 * min) return "allpass";
    return "other";
  }

  private extremes(): { peak: number; peakFreq: number; min: number } {
    const [lo, hi] = this.frequencyRange(3);
    const grid = logGrid(lo, hi, 100);
    let peak = -Infinity;
    let peakFreq = lo;
    let min = Infinity;
    for (const f of grid) {
      const m = this.magnitude(f);
      if (m > peak) {
        peak = m;
        peakFreq = f;
      }
      min = Math.min(min, m);
    }
    // Golden-section refinement of the peak in log-frequency.
    let a = Math.log(peakFreq / 1.05);
    let b = Math.log(peakFreq * 1.05);
    const g = (Math.sqrt(5) - 1) / 2;
    for (let i = 0; i < 60; i++) {
      const c = b - g * (b - a);
      const d = a + g * (b - a);
      if (this.magnitude(Math.exp(c)) > this.magnitude(Math.exp(d))) b = d;
      else a = c;
    }
    const refined = Math.exp((a + b) / 2);
    const refinedPeak = this.magnitude(refined);
    if (refinedPeak > peak) {
      peak = refinedPeak;
      peakFreq = refined;
    }
    return { peak, peakFreq, min };
  }

  /** Frequency (Hz) of the maximum of `|H|`. */
  peakFrequency(): number {
    return this.extremes().peakFreq;
  }

  /** Maximum of `|H|`. */
  peakGain(): number {
    return this.extremes().peak;
  }

  /**
   * −3 dB frequencies (Hz): where `|H|` crosses `reference / √2`. The reference is the DC
   * gain (low-pass, band-stop), the high-frequency gain (high-pass) or the peak (band-pass).
   */
  cutoffFrequencies(): number[] {
    const type = this.filterType();
    let ref: number;
    if (type === "lowpass" || type === "bandstop") ref = Math.abs(this.dcGain());
    else if (type === "highpass") ref = Math.abs(this.highFrequencyGain());
    else if (type === "bandpass") ref = this.peakGain();
    else return [];
    const level = ref / Math.SQRT2;
    const [lo, hi] = this.frequencyRange(3);
    const grid = logGrid(lo, hi, 100);
    const out: number[] = [];
    let prev = this.magnitude(grid[0] as number) - level;
    for (let i = 1; i < grid.length; i++) {
      const cur = this.magnitude(grid[i] as number) - level;
      if (prev === 0 || prev * cur < 0) {
        let a = Math.log(grid[i - 1] as number);
        let b = Math.log(grid[i] as number);
        const fa = prev;
        for (let k = 0; k < 80; k++) {
          const mid = (a + b) / 2;
          const fm = this.magnitude(Math.exp(mid)) - level;
          if (fm * fa > 0) a = mid;
          else b = mid;
        }
        out.push(Math.exp((a + b) / 2));
      }
      prev = cur;
    }
    return out;
  }

  /** The −3 dB frequency (Hz) of a low-pass or high-pass response. */
  cutoffFrequency(): number | undefined {
    const f = this.cutoffFrequencies();
    return f.length === 1 ? f[0] : undefined;
  }

  /** −3 dB bandwidth (Hz) of a band-pass or band-stop response. */
  bandwidth(): number | undefined {
    const f = this.cutoffFrequencies();
    if (f.length !== 2) return undefined;
    return (f[1] as number) - (f[0] as number);
  }

  /**
   * Sinusoidal steady-state response to a DC value, one or several sinusoids.
   *
   * ```ts
   * H.apply({ amplitude: 1, freq: 1e3 });              // one sine
   * H.apply({ offset: 2.5, components: [s1, s2] });    // DC + harmonics
   * ```
   */
  apply(signal: InputSignal): SteadyStateResponse {
    const { offset, components } = normalizeSignal(signal);
    let dc = 0;
    if (offset !== 0) dc += offset * this.dcGain();
    const out: OutputSinusoid[] = [];
    for (const c of components) {
      const phaseIn = c.phase ?? 0;
      if (c.freq === 0) {
        dc += c.amplitude * Math.sin((phaseIn * Math.PI) / 180) * this.dcGain();
        continue;
      }
      const gain = this.evaluate(c.freq);
      out.push({
        amplitude: c.amplitude * gain.abs(),
        freq: c.freq,
        phase: phaseIn + (gain.arg() * 180) / Math.PI,
        gain,
      });
    }
    const at = (t: number) =>
      out.reduce(
        (acc, c) => acc + c.amplitude * Math.sin(TWO_PI * c.freq * t + (c.phase * Math.PI) / 180),
        dc,
      );
    return { offset: dc, components: out, at, sample: (times) => times.map(at) };
  }

  /** Default simulation length for time responses, from the poles. */
  private defaultDuration(): number {
    return defaultDuration(this.poles());
  }

  /**
   * Unit step response `y(t)` for zero initial state (exact discretisation,
   * `e^{A·h}`). Default duration from the poles; `amplitude` scales the step.
   */
  stepResponse(options: ResponseOptions & { amplitude?: number } = {}): TimeResponse {
    const r = simulateResponse(
      this.numerator,
      this.denominator,
      options.amplitude ?? 1,
      options,
      this.defaultDuration(),
    );
    return r;
  }

  /** Impulse response `h(t)`; a direct feed-through term is reported as `impulse` (Dirac weight). */
  impulseResponse(options: ResponseOptions = {}): TimeResponse {
    return impulseResponseOf(this.numerator, this.denominator, options, this.defaultDuration());
  }

  /**
   * Time response to an arbitrary input for zero initial state: a waveform
   * (`{ kind: "pulse", … }`), a function of time or samples on the time grid.
   * The input is held constant over each step (exact for piecewise constant inputs).
   */
  response(input: Signal | readonly number[], options: ResponseOptions = {}): TimeResponse {
    return simulateResponse(
      this.numerator,
      this.denominator,
      input,
      options,
      this.defaultDuration(),
    );
  }

  /** Rise time, overshoot, peak and 2 % settling time of the step response. */
  stepInfo(options: ResponseOptions = {}): StepMetrics {
    return stepMetrics(this.stepResponse(options), this.dcGain());
  }

  /** LaTeX of `H(s)` with numeric coefficients, e.g. `\frac{1}{1 + 10^{-4}\,s}`. */
  toLatex(options: TransferLatexOptions = {}): string {
    const mode = options.normalize ?? "constant";
    const r = mode === "none" ? this.rational : this.rational.normalize(mode);
    const poly = {
      variable: options.variable ?? "s",
      digits: options.digits ?? 4,
      order: options.order ?? (mode === "constant" ? "ascending" : "descending"),
    } as const;
    const num = polynomialToLatex(r.num, poly);
    const den = r.den;
    let body: string;
    if (den.degree === 0) {
      const scaled = r.num.scale(1 / den.coeff(0));
      body = polynomialToLatex(scaled, poly);
    } else {
      body = `\\frac{${num}}{${polynomialToLatex(den, poly)}}`;
    }
    return options.name ? `${options.name} = ${body}` : body;
  }

  /** Plain-text representation. */
  toString(): string {
    const label =
      this.meta.output && this.meta.input ? `${this.meta.output}/${this.meta.input}: ` : "";
    return `${label}${this.rational.toString()}`;
  }
}

function limitRatio(num: Polynomial, den: Polynomial, where: "low" | "high"): number {
  if (num.isZero()) return 0;
  const lowest = (p: Polynomial) => p.coeffs.findIndex((c) => c !== 0);
  const kn = where === "low" ? lowest(num) : num.degree;
  const kd = where === "low" ? lowest(den) : den.degree;
  const ratio = num.coeff(kn) / den.coeff(kd);
  if (kn === kd) return ratio;
  const vanishes = where === "low" ? kn > kd : kn < kd;
  return vanishes ? 0 : ratio > 0 ? Infinity : -Infinity;
}

function logGrid(fStart: number, fStop: number, perDecade: number): number[] {
  if (!(fStart > 0 && fStop > fStart)) {
    throw new ElecMapError("INVALID_ARGUMENT", `Invalid frequency range [${fStart}, ${fStop}]`);
  }
  const decades = Math.log10(fStop / fStart);
  const n = Math.max(2, Math.round(decades * perDecade) + 1);
  return Array.from({ length: n }, (_, i) => fStart * 10 ** ((decades * i) / (n - 1)));
}

function normalizeSignal(signal: InputSignal): { offset: number; components: readonly Sinusoid[] } {
  if (typeof signal === "number") return { offset: signal, components: [] };
  if (Array.isArray(signal)) return { offset: 0, components: signal as readonly Sinusoid[] };
  if ("freq" in signal) return { offset: 0, components: [signal] };
  const periodic = signal as PeriodicSignal;
  return { offset: periodic.offset ?? 0, components: periodic.components ?? [] };
}

import { ElecMapError } from "../core/errors";
import { expm, matVec } from "../math/expm";
import type { Polynomial } from "../math/polynomial";
import type { Signal } from "./waveforms";
import { signalValue } from "./waveforms";

/** Options for time responses of a transfer function. */
export interface ResponseOptions {
  /** Stop time (s). Default: 5× the slowest time constant (or 10 periods of the slowest oscillation). */
  tStop?: number;
  /** Number of intervals (default 500). Ignored when `tStep` is given. */
  points?: number;
  /** Time step (s). */
  tStep?: number;
}

/** Characteristics of a step response. */
export interface StepMetrics {
  /** Final value (DC gain for a unit step). */
  finalValue: number;
  /** Maximum value reached (for a positive final value; minimum otherwise). */
  peak: number;
  /** Time of the peak (s). */
  peakTime: number;
  /** Overshoot in % of the final value (0 if none). */
  overshoot: number;
  /** 10 % → 90 % rise time (s), if reached. */
  riseTime: number | undefined;
  /** Time after which the response stays within ±2 % of the final value (s), if reached. */
  settlingTime: number | undefined;
}

/** Time response of a transfer function. */
export interface TimeResponse {
  time: number[];
  value: number[];
  /**
   * Weight of a Dirac impulse at `t = 0` in the output (impulse response of a
   * transfer function with a direct feed-through, `lim H(s)` for `s → ∞`).
   */
  impulse?: number;
}

/** Proper rational function as a state-space model `x' = A·x + B·u`, `y = C·x + D·u` (time scaled by `σ`). */
interface StateSpace {
  A: number[][];
  C: number[];
  D: number;
  /** Time scale: the model runs in `τ = σ·t`. */
  sigma: number;
}

function stateSpace(num: Polynomial, den: Polynomial): StateSpace {
  if (num.degree > den.degree) {
    throw new ElecMapError(
      "UNSUPPORTED",
      "Time response of an improper transfer function (deg N > deg D)",
    );
  }
  const n = den.degree;
  // Time scale from the geometric mean of the denominator coefficient ratios.
  const lowest = den.coeffs.findIndex((c) => c !== 0);
  const sigma = n > lowest ? Math.abs(den.coeff(lowest) / den.leading()) ** (1 / (n - lowest)) : 1;
  const sigmaSafe = sigma > 0 && Number.isFinite(sigma) ? sigma : 1;
  // H(s) = H̃(p) with s = σ·p.
  const d = den.scaleVariable(sigmaSafe);
  const m = num.scaleVariable(sigmaSafe);
  const lead = d.leading();
  const a = d.coeffs.map((c) => c / lead); // monic, a[n] = 1
  const b = Array.from({ length: n + 1 }, (_, k) => m.coeff(k) / lead);
  const D = b[n] as number;
  const A = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i < n - 1 ? (j === i + 1 ? 1 : 0) : -(a[j] as number))),
  );
  const C = Array.from({ length: n }, (_, k) => (b[k] as number) - D * (a[k] as number));
  return { A, C, D, sigma: sigmaSafe };
}

/** Exact ZOH discretisation: `Φ = e^{A·h}`, `Γ = ∫₀ʰ e^{Aτ}dτ·B` with `B = eₙ`. */
function discretize(ss: StateSpace, h: number): { phi: number[][]; gamma: number[] } {
  const n = ss.A.length;
  const hs = h * ss.sigma;
  // Augmented exponential [[A, B], [0, 0]]·h.
  const aug = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => {
      if (i === n) return 0;
      if (j === n) return i === n - 1 ? hs : 0;
      return ((ss.A[i] as number[])[j] as number) * hs;
    }),
  );
  const e = expm(aug);
  return {
    phi: e.slice(0, n).map((row) => row.slice(0, n)),
    gamma: e.slice(0, n).map((row) => row[n] as number),
  };
}

function timeGrid(options: ResponseOptions, defaultStop: number): { time: number[]; h: number } {
  const tStop = options.tStop ?? defaultStop;
  if (!(tStop > 0) || !Number.isFinite(tStop)) {
    throw new ElecMapError("INVALID_ARGUMENT", `tStop must be a finite number > 0 (got ${tStop})`);
  }
  const steps = options.tStep ? Math.ceil(tStop / options.tStep - 1e-9) : (options.points ?? 500);
  if (!(steps >= 1) || steps > 1e7)
    throw new ElecMapError("INVALID_ARGUMENT", `Invalid number of steps (${steps})`);
  const h = tStop / steps;
  return { time: Array.from({ length: steps + 1 }, (_, k) => k * h), h };
}

/**
 * Default simulation length from the poles (rad/s): 5 time constants of the
 * slowest damped pole, at least 10 periods of undamped oscillations.
 */
export function defaultDuration(poles: readonly { re: number; im: number }[]): number {
  let t = 0;
  for (const p of poles) {
    const mag = Math.hypot(p.re, p.im);
    if (mag === 0) continue;
    if (p.re < -1e-9 * mag) t = Math.max(t, 5 / -p.re);
    else t = Math.max(t, p.im !== 0 ? (10 * 2 * Math.PI) / Math.abs(p.im) : 5 / mag);
  }
  return t > 0 && Number.isFinite(t) ? t : 1;
}

/** Response to an arbitrary input, with the input held constant over each step (ZOH, exact for steps). */
export function simulateResponse(
  num: Polynomial,
  den: Polynomial,
  input: Signal | readonly number[],
  options: ResponseOptions,
  defaultStop: number,
): TimeResponse {
  const ss = stateSpace(num, den);
  const { time, h } = timeGrid(options, defaultStop);
  const u = Array.isArray(input)
    ? (k: number) => (input as readonly number[])[Math.min(k, input.length - 1)] ?? 0
    : (k: number) =>
        signalValue(input as Signal, time[k] as number, {
          tStep: h,
          tStop: time[time.length - 1] as number,
        });
  const n = ss.A.length;
  if (n === 0) return { time, value: time.map((_, k) => ss.D * u(k)) };
  const { phi, gamma } = discretize(ss, h);
  let x = new Array<number>(n).fill(0);
  const value: number[] = [];
  for (let k = 0; k < time.length; k++) {
    const uk = u(k);
    value.push(ss.C.reduce((acc, c, i) => acc + c * (x[i] as number), 0) + ss.D * uk);
    const next = matVec(phi, x);
    x = next.map((v, i) => v + (gamma[i] as number) * uk);
  }
  return { time, value };
}

/** Impulse response `h(t)` (the Dirac part, if any, is reported in `impulse`). */
export function impulseResponseOf(
  num: Polynomial,
  den: Polynomial,
  options: ResponseOptions,
  defaultStop: number,
): TimeResponse {
  const ss = stateSpace(num, den);
  const { time, h } = timeGrid(options, defaultStop);
  const n = ss.A.length;
  if (n === 0) return { time, value: time.map(() => 0), impulse: ss.D };
  const { phi } = discretize(ss, h);
  // x(0+) = B (in scaled time the impulse has weight σ).
  let x = new Array<number>(n).fill(0);
  x[n - 1] = ss.sigma;
  const value: number[] = [];
  for (let k = 0; k < time.length; k++) {
    value.push(ss.C.reduce((acc, c, i) => acc + c * (x[i] as number), 0));
    x = matVec(phi, x);
  }
  return ss.D === 0 ? { time, value } : { time, value, impulse: ss.D };
}

/** Rise time, overshoot, settling time… of a step response. */
export function stepMetrics(response: TimeResponse, finalValue: number): StepMetrics {
  const { time, value } = response;
  const sign = finalValue < 0 ? -1 : 1;
  let peak = value[0] ?? 0;
  let peakTime = 0;
  value.forEach((v, k) => {
    if (sign * v > sign * peak) {
      peak = v;
      peakTime = time[k] as number;
    }
  });
  const overshoot =
    finalValue !== 0 && sign * (peak - finalValue) > 0
      ? (100 * (peak - finalValue)) / finalValue
      : 0;
  const crossing = (level: number) => {
    for (let k = 1; k < value.length; k++) {
      const a = sign * ((value[k - 1] as number) - level);
      const b = sign * ((value[k] as number) - level);
      if (a < 0 && b >= 0) {
        const t0 = time[k - 1] as number;
        const t1 = time[k] as number;
        return t0 + ((t1 - t0) * -a) / (b - a);
      }
    }
    return undefined;
  };
  const t10 = crossing(0.1 * finalValue);
  const t90 = crossing(0.9 * finalValue);
  const riseTime = t10 !== undefined && t90 !== undefined ? t90 - t10 : undefined;
  let settlingTime: number | undefined;
  const band = 0.02 * Math.abs(finalValue);
  if (finalValue !== 0 && Number.isFinite(finalValue)) {
    let last = -1;
    value.forEach((v, k) => {
      if (Math.abs(v - finalValue) > band) last = k;
    });
    if (last < value.length - 1) settlingTime = last < 0 ? 0 : (time[last + 1] as number);
  }
  return { finalValue, peak, peakTime, overshoot, riseTime, settlingTime };
}

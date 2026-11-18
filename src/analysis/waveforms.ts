import type { ComponentJSON, Waveform } from "../format/types";

/** Time context used for SPICE default waveform parameters. */
export interface WaveformContext {
  /** Simulation time step (s): default rise / fall time of pulses, exp time constants. */
  tStep: number;
  /** Simulation stop time (s): default pulse width / period. */
  tStop: number;
}

/** A time-domain signal: a waveform description or any function of time (s). */
export type Signal = Waveform | number | ((t: number) => number);

/**
 * Value of a SPICE-style waveform at time `t` (s).
 *
 * - `sine`: `offset + A·e^{−θ(t−td)}·sin(2πf(t−td) + φ)` for `t ≥ td`;
 * - `pulse`: trapezoidal pulse train (`rise`/`fall` default to `tStep`, `width`/`period` to `tStop`);
 * - `pwl`: piecewise linear, held constant outside the points;
 * - `step`: `v1` up to `delay` (included, so a transient starts from rest), `v2` after;
 * - `exp`: SPICE double exponential.
 */
export function waveformValue(w: Waveform, t: number, ctx: WaveformContext): number {
  switch (w.kind) {
    case "sine": {
      const td = w.delay ?? 0;
      const phase = ((w.phase ?? 0) * Math.PI) / 180;
      if (t < td) return w.offset + w.amplitude * Math.sin(phase);
      const dt = t - td;
      return (
        w.offset +
        w.amplitude * Math.exp(-(w.damping ?? 0) * dt) * Math.sin(2 * Math.PI * w.freq * dt + phase)
      );
    }
    case "pulse": {
      const td = w.delay ?? 0;
      const tr = w.rise || ctx.tStep;
      const tf = w.fall || ctx.tStep;
      const pw = w.width ?? ctx.tStop;
      const per = w.period ?? Infinity;
      if (t < td) return w.v1;
      let local = t - td;
      if (Number.isFinite(per) && per > 0) local %= per;
      if (local < tr) return w.v1 + ((w.v2 - w.v1) * local) / tr;
      if (local < tr + pw) return w.v2;
      if (local < tr + pw + tf) return w.v2 + ((w.v1 - w.v2) * (local - tr - pw)) / tf;
      return w.v1;
    }
    case "pwl": {
      const pts = w.points;
      if (pts.length === 0) return 0;
      const first = pts[0] as [number, number];
      if (t <= first[0]) return first[1];
      for (let i = 1; i < pts.length; i++) {
        const [t1, v1] = pts[i] as [number, number];
        if (t <= t1) {
          const [t0, v0] = pts[i - 1] as [number, number];
          return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
        }
      }
      return (pts[pts.length - 1] as [number, number])[1];
    }
    case "step":
      return t <= (w.delay ?? 0) ? (w.v1 ?? 0) : w.v2;
    case "exp": {
      const td1 = w.td1 ?? 0;
      const tau1 = w.tau1 || ctx.tStep;
      const td2 = w.td2 ?? td1 + ctx.tStep;
      const tau2 = w.tau2 || ctx.tStep;
      if (t < td1) return w.v1;
      let v = w.v1 + (w.v2 - w.v1) * (1 - Math.exp(-(t - td1) / tau1));
      if (t >= td2) v += (w.v1 - w.v2) * (1 - Math.exp(-(t - td2) / tau2));
      return v;
    }
  }
}

/** Evaluates any {@link Signal} at time `t`. */
export function signalValue(signal: Signal, t: number, ctx: WaveformContext): number {
  if (typeof signal === "number") return signal;
  if (typeof signal === "function") return signal(t);
  return waveformValue(signal, t, ctx);
}

/** Time-domain value of an independent source: its waveform, else its DC value. */
export function sourceSignal(c: ComponentJSON): Signal {
  if (c.type !== "vsource" && c.type !== "isource") return 0;
  return c.waveform ?? c.dc ?? 0;
}

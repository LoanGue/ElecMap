import type { ComponentJSON } from "../format/types";
import type { ComponentModel, LoadContext } from "./models";

type OpAmp = Extract<ComponentJSON, { type: "opamp" }>;

/** Open-loop gain of an ideal op-amp given output rails (the SPICE export uses the same). */
export const IDEAL_RAIL_GAIN = 1e6;

/**
 * Knee of the limiter: beyond `|r| = 1 − KNEE` the inverse `atanh` is continued by
 * its tangent, so the output still moves by `2·KNEE·A` volts per volt of input.
 */
const KNEE = 1e-12;
const R_KNEE = 1 - KNEE;
const Z_KNEE = Math.atanh(R_KNEE);
const SLOPE_KNEE = 1 - R_KNEE * R_KNEE;

/** Output rails of an op-amp: centre, half swing and gain, or `undefined` without rails. */
export function opampRails(c: OpAmp): { mid: number; half: number; gain: number } | undefined {
  if (c.vpos === undefined || c.vneg === undefined) return undefined;
  return {
    mid: (c.vpos + c.vneg) / 2,
    half: (c.vpos - c.vneg) / 2,
    gain: c.gain ?? IDEAL_RAIL_GAIN,
  };
}

/**
 * Normalised limiter `r = L(z)`: `tanh(z)`, continued linearly beyond the knee.
 * It is the inverse of {@link limiterInverse}.
 */
export function limiter(z: number): number {
  const a = Math.abs(z);
  const r = a <= Z_KNEE ? Math.tanh(a) : R_KNEE + (a - Z_KNEE) * SLOPE_KNEE;
  return Math.sign(z) * r;
}

/** Inverse limiter `z = L⁻¹(r)` and its derivative `dz/dr`, defined for every `r`. */
export function limiterInverse(r: number): { z: number; dz: number } {
  const a = Math.abs(r);
  if (a <= R_KNEE) return { z: Math.atanh(r), dz: 1 / (1 - r * r) };
  return { z: Math.sign(r) * (Z_KNEE + (a - R_KNEE) / SLOPE_KNEE), dz: 1 / SLOPE_KNEE };
}

const at = (ctx: LoadContext, i: number): number => (i < 0 ? 0 : (ctx.x[i] as number));

/**
 * Op-amp model. Output branch current I flows from `out` into the op-amp.
 *
 * Without rails (linear):
 * - ideal: `V+ − V− = 0`;
 * - finite gain: `Vout·(1 + s/ωp) − A·(V+ − V−) = 0`, `ωp = 2π·GBW / A`.
 *
 * With rails, a second unknown `y` (the `":sat"` branch) is the gain stage
 * output, limited between the rails before the dominant pole:
 * - row `k`:     `Vout·(1 + s/ωp) − y = 0` (linear, `Vout = y` without GBW);
 * - row `k + 1`: `y = mid + half·L(A·(V+ − V−) / half)`, solved by Newton in the
 *   inverse form `V+ − V− = (half / A)·L⁻¹((y − mid) / half)`, which converges
 *   in negative feedback. Each Newton solve first holds `y` at its previous
 *   value, then restarts from the open-loop response to the inputs found, so
 *   that positive feedback lands on a saturated branch and switches when that
 *   branch disappears.
 */
export const opampModel: ComponentModel<OpAmp> = {
  branches: (c) => (opampRails(c) ? 2 : 1),
  branchSuffixes: [":sat"],
  nonlinear: (c) => opampRails(c) !== undefined,
  stamp(c, ctx) {
    const [ip, im, out] = c.nodes.map((n) => ctx.node(n)) as [number, number, number];
    const k = ctx.branch(c.id);
    ctx.addG(out, k, 1);
    if (c.gain === undefined && !opampRails(c)) {
      ctx.addG(k, ip, 1);
      ctx.addG(k, im, -1);
      return;
    }
    const gain = c.gain ?? IDEAL_RAIL_GAIN;
    ctx.addG(k, out, 1);
    if (opampRails(c)) ctx.addG(k, k + 1, -1);
    else {
      ctx.addG(k, ip, -gain);
      ctx.addG(k, im, gain);
    }
    if (c.gbw !== undefined) ctx.addC(k, out, gain / (2 * Math.PI * c.gbw));
  },
  current: (c, ctx) => ({ terms: [{ index: ctx.branch(c.id), g: 1, c: 0 }], sources: [] }),
  load(c, ctx) {
    const rails = opampRails(c);
    if (!rails) return;
    const { mid, half, gain } = rails;
    const [ip, im] = c.nodes.map((n) => ctx.node(n)) as [number, number, number];
    const row = ctx.branch(c.id) + 1;
    const s = ctx.state;
    let y = at(ctx, row);
    if (s && ctx.first) {
      // Hold the stage output, to see the inputs it gives.
      ctx.addJ(row, row, 1);
      ctx.addB(row, ctx.initial ? mid : y);
      s["seed"] = 1;
      ctx.limited();
      return;
    }
    if (s?.["seed"]) {
      s["seed"] = 0;
      y = mid + half * limiter((gain * (at(ctx, ip) - at(ctx, im))) / half);
      ctx.limited();
    }
    const vd = at(ctx, ip) - at(ctx, im);
    const { z, dz } = limiterInverse((y - mid) / half);
    const f = (half / gain) * z;
    const df = dz / gain;
    // Small Newton steps far into saturation are not convergence: check the residual.
    if (s && Math.abs(vd - f) > 1e-6 + 1e-3 * Math.abs(f)) ctx.limited();
    ctx.addJ(row, ip, 1);
    ctx.addJ(row, im, -1);
    ctx.addJ(row, row, -df);
    ctx.addB(row, f - df * y);
  },
};

/**
 * Physics of the non-linear devices: current laws, their derivatives and the
 * voltage limiting used by Newton-Raphson.
 *
 * @module
 */

import type { DiodeJSON } from "../format/types";

/** Thermal voltage `kT/q` at the nominal temperature of 27 °C (V). */
export const THERMAL_VOLTAGE = 0.025865;

/** Largest exponent evaluated exactly; beyond it the exponential is continued linearly. */
const MAX_EXP = 80;

/** `e^x` and its derivative, continued linearly beyond {@link MAX_EXP} to avoid overflow. */
function safeExp(x: number): { value: number; slope: number } {
  if (x <= MAX_EXP) {
    const e = Math.exp(x);
    return { value: e, slope: e };
  }
  const e = Math.exp(MAX_EXP);
  return { value: e * (1 + x - MAX_EXP), slope: e };
}

/** Diode parameters with every default applied. */
export interface DiodeParams {
  is: number;
  n: number;
  rs: number;
  bv: number | undefined;
  ibv: number;
  nbv: number;
  cjo: number;
  /** `n·Vt` (V). */
  nvt: number;
  /** Critical voltage above which steps are limited (V). */
  vcrit: number;
}

/** Resolves the parameters of a diode (SPICE defaults). */
export function diodeParams(c: DiodeJSON): DiodeParams {
  const is = c.is ?? 1e-14;
  const n = c.n ?? 1;
  const nvt = n * THERMAL_VOLTAGE;
  return {
    is,
    n,
    rs: c.rs ?? 0,
    bv: c.bv,
    ibv: c.ibv ?? 1e-3,
    nbv: c.nbv ?? n,
    cjo: c.cjo ?? 0,
    nvt,
    vcrit: nvt * Math.log(nvt / (Math.SQRT2 * is)),
  };
}

/** Junction current `I(Vj)` (A) and its conductance `dI/dVj` (S). */
export function diodeCurrent(vj: number, p: DiodeParams): { i: number; g: number } {
  const f = safeExp(vj / p.nvt);
  let i = p.is * (f.value - 1);
  let g = (p.is * f.slope) / p.nvt;
  if (p.bv !== undefined) {
    const vt = p.nbv * THERMAL_VOLTAGE;
    const r = safeExp(-(vj + p.bv) / vt);
    i -= p.ibv * r.value;
    g += (p.ibv * r.slope) / vt;
  }
  return { i, g };
}

/**
 * SPICE `pnjlim`: limits the change of a junction voltage between two Newton
 * iterations so that the exponential cannot explode.
 */
export function limitJunction(
  vnew: number,
  vold: number,
  vt: number,
  vcrit: number,
): { v: number; limited: boolean } {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      return { v: arg > 0 ? vold + vt * Math.log(arg) : vcrit, limited: true };
    }
    return { v: vt * Math.log(vnew / vt), limited: true };
  }
  return { v: vnew, limited: false };
}

/** Limits a diode voltage step, in the forward and (zener) breakdown directions. */
export function limitDiode(
  vnew: number,
  vold: number,
  p: DiodeParams,
): { v: number; limited: boolean } {
  if (p.bv !== undefined && vnew < Math.min(0, -p.bv + 10 * p.nbv * THERMAL_VOLTAGE)) {
    const vt = p.nbv * THERMAL_VOLTAGE;
    const vcrit = vt * Math.log(vt / (Math.SQRT2 * p.ibv));
    const r = limitJunction(-(vnew + p.bv), -(vold + p.bv), vt, vcrit);
    return { v: -(r.v + p.bv), limited: r.limited };
  }
  return limitJunction(vnew, vold, p.nvt, p.vcrit);
}

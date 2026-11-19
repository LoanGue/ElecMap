/**
 * Physics of the non-linear devices: current laws, their derivatives and the
 * voltage limiting used by Newton-Raphson.
 *
 * @module
 */

import type { BjtJSON, DiodeJSON, MosfetJSON } from "../format/types";

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

// ---------------------------------------------------------------------- BJT

/** Bipolar transistor parameters with every default applied. */
export interface BjtParams {
  /** `+1` for an NPN, `−1` for a PNP. */
  sign: 1 | -1;
  is: number;
  bf: number;
  br: number;
  /** `nf·Vt` and `nr·Vt` (V). */
  vtf: number;
  vtr: number;
  /** `1/vaf` and `1/var` (1/V, 0 without Early effect). */
  ivaf: number;
  ivar: number;
  cje: number;
  cjc: number;
  /** Critical voltages of the base-emitter and base-collector junctions (V). */
  vcritBe: number;
  vcritBc: number;
}

/** Resolves the parameters of a bipolar transistor (SPICE defaults). */
export function bjtParams(c: BjtJSON): BjtParams {
  const is = c.is ?? 1e-16;
  const vtf = (c.nf ?? 1) * THERMAL_VOLTAGE;
  const vtr = (c.nr ?? 1) * THERMAL_VOLTAGE;
  return {
    sign: c.polarity === "pnp" ? -1 : 1,
    is,
    bf: c.bf ?? 100,
    br: c.br ?? 1,
    vtf,
    vtr,
    ivaf: c.vaf ? 1 / c.vaf : 0,
    ivar: c.var ? 1 / c.var : 0,
    cje: c.cje ?? 0,
    cjc: c.cjc ?? 0,
    vcritBe: vtf * Math.log(vtf / (Math.SQRT2 * is)),
    vcritBc: vtr * Math.log(vtr / (Math.SQRT2 * is)),
  };
}

/**
 * Collector and base currents of an NPN-normalised transistor (`Vbe`, `Vbc`
 * multiplied by the polarity sign), with their partial derivatives.
 */
export interface BjtCurrents {
  ic: number;
  ib: number;
  /** `∂Ic/∂Vbe`, `∂Ic/∂Vbc`. */
  dicBe: number;
  dicBc: number;
  /** `∂Ib/∂Vbe`, `∂Ib/∂Vbc`. */
  dibBe: number;
  dibBc: number;
}

/** Transport-model currents; `gmin` is placed across both junctions. */
export function bjtCurrents(vbe: number, vbc: number, p: BjtParams, gmin = 0): BjtCurrents {
  const fe = safeExp(vbe / p.vtf);
  const fc = safeExp(vbc / p.vtr);
  const ibe = p.is * (fe.value - 1);
  const ibc = p.is * (fc.value - 1);
  const gbe = (p.is * fe.slope) / p.vtf;
  const gbc = (p.is * fc.slope) / p.vtr;
  const k = 1 - vbc * p.ivaf - vbe * p.ivar;
  const it = ibe - ibc;
  return {
    ic: it * k - ibc / p.br - gmin * vbc,
    ib: ibe / p.bf + ibc / p.br + gmin * (vbe + vbc),
    dicBe: gbe * k - it * p.ivar,
    dicBc: -gbc * k - it * p.ivaf - gbc / p.br - gmin,
    dibBe: gbe / p.bf + gmin,
    dibBc: gbc / p.br + gmin,
  };
}

// ------------------------------------------------------------------- MOSFET

/** MOSFET parameters with every default applied. */
export interface MosfetParams {
  /** `+1` for an NMOS, `−1` for a PMOS. */
  sign: 1 | -1;
  /** Threshold voltage of the NMOS-normalised device (`sign·vto`, V). */
  vto: number;
  /** `kp·w/l` (A/V²). */
  beta: number;
  lambda: number;
  gamma: number;
  phi: number;
  /** Gate-source and gate-drain capacitances (F). */
  cgs: number;
  cgd: number;
}

/** Resolves the parameters of a MOSFET (SPICE defaults). */
export function mosfetParams(c: MosfetJSON): MosfetParams {
  const sign = c.polarity === "pmos" ? -1 : 1;
  const w = c.w ?? 100e-6;
  const l = c.l ?? 100e-6;
  return {
    sign,
    vto: sign * (c.vto ?? 0),
    beta: ((c.kp ?? 2e-5) * w) / l,
    lambda: c.lambda ?? 0,
    gamma: c.gamma ?? 0,
    phi: c.phi ?? 0.6,
    cgs: (c.cgso ?? 0) * w,
    cgd: (c.cgdo ?? 0) * w,
  };
}

/** Threshold voltage at a bulk-source voltage (NMOS-normalised) and `dVth/dVbs`. */
export function mosfetThreshold(vbs: number, p: MosfetParams): { vth: number; dvth: number } {
  if (p.gamma === 0) return { vth: p.vto, dvth: 0 };
  const sphi = Math.sqrt(p.phi);
  // SPICE continues √(phi − Vbs) linearly for a forward-biased bulk.
  let sarg: number;
  let dsarg: number;
  if (vbs <= 0) {
    sarg = Math.sqrt(p.phi - vbs);
    dsarg = -0.5 / sarg;
  } else {
    sarg = Math.max(0, sphi - vbs / (2 * sphi));
    dsarg = sarg > 0 ? -0.5 / sphi : 0;
  }
  return { vth: p.vto + p.gamma * (sarg - sphi), dvth: p.gamma * dsarg };
}

/** Drain current of an NMOS-normalised MOSFET and its derivatives. */
export interface MosfetCurrent {
  /** Drain → source current (A). */
  id: number;
  /** `∂Id/∂Vgs`, `∂Id/∂Vds`, `∂Id/∂Vbs` (S). */
  gm: number;
  gds: number;
  gmbs: number;
  region: "cutoff" | "linear" | "saturation";
}

/** Shichman-Hodges drain current for `Vds ≥ 0`. */
function forwardCurrent(vgs: number, vds: number, vbs: number, p: MosfetParams): MosfetCurrent {
  const { vth, dvth } = mosfetThreshold(vbs, p);
  const vov = vgs - vth;
  if (vov <= 0) return { id: 0, gm: 0, gds: 0, gmbs: 0, region: "cutoff" };
  const clm = 1 + p.lambda * vds;
  let id: number;
  let gm: number;
  let gds: number;
  let region: MosfetCurrent["region"];
  if (vds < vov) {
    region = "linear";
    const core = p.beta * (vov - vds / 2) * vds;
    id = core * clm;
    gm = p.beta * vds * clm;
    gds = p.beta * (vov - vds) * clm + core * p.lambda;
  } else {
    region = "saturation";
    const core = (p.beta / 2) * vov * vov;
    id = core * clm;
    gm = p.beta * vov * clm;
    gds = core * p.lambda;
  }
  return { id, gm, gds, gmbs: -gm * dvth, region };
}

/**
 * Drain current for any `Vds` (drain and source swap roles when `Vds < 0`), with
 * its derivatives with respect to the original `Vgs`, `Vds`, `Vbs`.
 */
export function mosfetCurrent(
  vgs: number,
  vds: number,
  vbs: number,
  p: MosfetParams,
): MosfetCurrent {
  if (vds >= 0) return forwardCurrent(vgs, vds, vbs, p);
  const r = forwardCurrent(vgs - vds, -vds, vbs - vds, p);
  return {
    id: -r.id,
    gm: -r.gm,
    gds: r.gm + r.gds + r.gmbs,
    gmbs: -r.gmbs,
    region: r.region,
  };
}

/** SPICE `fetlim`: limits a gate voltage step around the threshold `vto`. */
export function limitGate(vnew: number, vold: number, vto: number): number {
  const vtsthi = Math.abs(2 * (vold - vto)) + 2;
  const vtstlo = Math.abs(vold - vto) + 1;
  const vtox = vto + 3.5;
  const delv = vnew - vold;
  if (vold >= vto) {
    if (vold >= vtox) {
      if (delv <= 0) {
        if (vnew >= vtox) return -delv > vtstlo ? vold - vtstlo : vnew;
        return Math.max(vnew, vto + 2);
      }
      return delv >= vtsthi ? vold + vtsthi : vnew;
    }
    return delv <= 0 ? Math.max(vnew, vto - 0.5) : Math.min(vnew, vto + 4);
  }
  if (delv <= 0) return -delv > vtsthi ? vold - vtsthi : vnew;
  const vtemp = vto + 0.5;
  if (vnew <= vtemp) return delv > vtstlo ? vold + vtstlo : vnew;
  return vtemp;
}

/** SPICE `limvds`: limits a drain-source voltage step. */
export function limitDrain(vnew: number, vold: number): number {
  if (vold >= 3.5) {
    if (vnew > vold) return Math.min(vnew, 3 * vold + 2);
    return vnew < 3.5 ? Math.max(vnew, 2) : vnew;
  }
  return vnew > vold ? Math.min(vnew, 4) : Math.max(vnew, -0.5);
}

import { ElecMapError } from "../core/errors";
import type { NodeName } from "../format/types";
import { RealLU } from "../math/linear";
import type { LinearForm } from "../mna/models";
import type { MnaSystem, SourceValues } from "../mna/system";
import { operatingPoint } from "./dc";
import { newtonSolve } from "./newton";
import type { DeviceStates } from "./newton";
import type { Signal, WaveformContext } from "./waveforms";
import { signalValue, sourceSignal } from "./waveforms";

/** Options for {@link transient}. */
export interface TransientOptions {
  /** Stop time (s). */
  tStop: number;
  /** Time step (s). Default `tStop / 1000`. */
  tStep?: number;
  /** Start time of the recorded output (s, default 0). Earlier steps are simulated but not stored. */
  tStart?: number;
  /**
   * Integration method: `"gear2"` (default, BDF2: second order, no numerical ringing),
   * `"trap"` (trapezoidal: second order, energy preserving, may ring after discontinuities)
   * or `"euler"` (backward Euler: first order, strongly damped).
   */
  method?: "gear2" | "trap" | "euler";
  /**
   * Initial state:
   * - `"op"`: DC operating point with the sources at their `t = 0` value;
   * - `"ic"`: capacitors and inductors start at their `ic` value (0 when absent), like SPICE `UIC`;
   * - `"auto"` (default): `"ic"` if any capacitor or inductor has an `ic`, otherwise `"op"`.
   */
  initial?: "auto" | "op" | "ic";
  /**
   * Signals overriding independent sources, by id: a waveform description, a
   * constant or any function of time, e.g. `{ V1: (t) => Math.sin(2 * Math.PI * 50 * t) }`.
   */
  inputs?: Record<string, Signal>;
}

/** Result of a transient analysis. */
export class TransientResult {
  /** @internal */
  constructor(
    private readonly system: MnaSystem,
    /** Time points (s). */
    readonly time: readonly number[],
    /** MNA unknown vector at each time point. */
    readonly x: readonly (readonly number[])[],
    /** Time derivative of the unknowns at each time point. */
    private readonly dx: readonly (readonly number[])[],
    private readonly sourceAt: (index: number) => SourceValues,
  ) {}

  private evaluate(form: LinearForm): number[] {
    return this.time.map((_, n) => {
      const x = this.x[n] as readonly number[];
      const dx = this.dx[n] as readonly number[];
      let v = 0;
      for (const t of form.terms) v += t.g * (x[t.index] as number) + t.c * (dx[t.index] as number);
      if (form.sources.length > 0) {
        const values = this.sourceAt(n);
        for (const { id, factor } of form.sources) {
          v += factor * (values(this.system.circuit.component(id)) as number);
        }
      }
      return v;
    });
  }

  /** Voltage `V(a) − V(b)` at every time point (`b` defaults to ground). */
  voltage(a: NodeName, b?: NodeName): number[] {
    return this.evaluate(this.system.voltageForm(a, b));
  }

  /** Current through a component (first node → second node) at every time point. */
  current(id: string): number[] {
    return this.evaluate(this.system.currentForm(id));
  }

  /** Instantaneous power absorbed by a component at every time point (W). */
  power(id: string): number[] {
    const out = this.time.map(() => 0);
    for (const t of this.system.powerTerms(id)) {
      const v = this.evaluate(t.v);
      const i = this.evaluate(t.i);
      v.forEach((vk, k) => (out[k] = (out[k] as number) + vk * (i[k] as number)));
    }
    return out;
  }
}

/**
 * Transient (time-domain) analysis with fixed time step:
 * `C·x'(t) + G·x(t) + f(x(t)) = b(t)`, where `f` is the current of the
 * non-linear devices (none for a linear circuit).
 *
 * The first step uses backward Euler (which also makes `"ic"` starts consistent),
 * the following ones the chosen method. For a linear circuit the matrices are
 * factorised once per method; otherwise every step is solved by Newton-Raphson,
 * starting from the previous time point.
 *
 * @throws {@link ElecMapError} `NO_CONVERGENCE` if Newton-Raphson fails at a time step
 */
export function transient(system: MnaSystem, options: TransientOptions): TransientResult {
  const { tStop } = options;
  if (!(tStop > 0) || !Number.isFinite(tStop)) {
    throw new ElecMapError("INVALID_ARGUMENT", `tStop must be a finite number > 0 (got ${tStop})`);
  }
  const h = options.tStep ?? tStop / 1000;
  if (!(h > 0) || h > tStop) {
    throw new ElecMapError("INVALID_ARGUMENT", `tStep must be in (0, tStop] (got ${h})`);
  }
  const steps = Math.ceil(tStop / h - 1e-9);
  if (steps > 1e7) throw new ElecMapError("INVALID_ARGUMENT", `Too many time steps (${steps})`);
  const method = options.method ?? "gear2";
  const ctx: WaveformContext = { tStep: h, tStop };
  const n = system.size;

  // Source signals (overrides first).
  const signals = new Map<string, Signal>();
  for (const c of system.circuit.components) {
    if (c.type === "vsource" || c.type === "isource") signals.set(c.id, sourceSignal(c));
  }
  for (const [id, s] of Object.entries(options.inputs ?? {})) {
    const c = system.circuit.component(id);
    if (c.type !== "vsource" && c.type !== "isource") {
      throw new ElecMapError("INVALID_ARGUMENT", `Input "${id}" must be an independent source`, {
        componentId: id,
      });
    }
    signals.set(id, s);
  }
  const valuesAt =
    (t: number): SourceValues =>
    (c) => {
      const s = signals.get(c.id);
      return s === undefined ? 0 : signalValue(s, t, ctx);
    };
  const rhsAt = (t: number) => system.rhs(valuesAt(t)).map((v) => v.re);

  const G = system.G;
  const C = system.C;
  // Stored charge q(x) = C·x + junction charges of the devices.
  const mulC = (x: readonly number[]) => {
    const q = C.map((row) =>
      row.reduce((acc, c, j) => (c === 0 ? acc : acc + c * (x[j] as number)), 0),
    );
    if (system.hasCharges) system.charges(x).forEach((v, i) => (q[i] = (q[i] as number) + v));
    return q;
  };
  const mulG = (x: readonly number[]) =>
    G.map((row) => row.reduce((acc, g, j) => (g === 0 ? acc : acc + g * (x[j] as number)), 0));
  // Linear solver of a step matrix, or Newton-Raphson when the circuit has devices.
  const states: DeviceStates = new Map();
  type Solve = (b: number[], guess: readonly number[], t: number) => number[];
  // `a` is the coefficient of q(x) in the step equation (for the junction charges).
  const solver = (A: number[][], a: number, tolerance?: number): Solve => {
    if (system.linear) {
      const lu = new RealLU(A, tolerance);
      return (b) => lu.solve(b);
    }
    return (b, guess, t) => {
      const r = newtonSolve(system, A, b, guess, states, {}, false, a);
      if (!r) {
        throw new ElecMapError(
          "NO_CONVERGENCE",
          `Transient analysis did not converge at t = ${t} s (try a smaller tStep)`,
          { time: t },
        );
      }
      return r.x;
    };
  };
  const combine = (a: number, alpha: number) =>
    G.map((row, i) =>
      row.map((g, j) => a * ((C[i] as readonly number[])[j] as number) + alpha * g),
    );

  // Initial state.
  const hasIc = system.circuit.components.some(
    (c) => (c.type === "capacitor" || c.type === "inductor") && c.ic !== undefined,
  );
  const initial =
    options.initial === undefined || options.initial === "auto"
      ? hasIc
        ? "ic"
        : "op"
      : options.initial;

  const times: number[] = [0];
  const xs: number[][] = [];
  let q0: number[]; // C·x at t = 0
  if (initial === "op") {
    const op = operatingPoint(system, { values: valuesAt(0) });
    xs.push([...op.x]);
    q0 = mulC(op.x);
  } else {
    q0 = initialCharge(system);
    // Consistent x(0+): backward Euler with a vanishing step enforces C·x = q0 and the algebraic equations.
    const eps = h * 1e-6;
    const solve0 = solver(combine(1 / eps, 1), 1 / eps, 0);
    const b0 = rhsAt(0);
    xs.push(
      solve0(
        b0.map((b, i) => b + (q0[i] as number) / eps),
        new Array<number>(n).fill(0),
        0,
      ),
    );
    q0 = mulC(xs[0] as number[]);
  }

  // First step: backward Euler. C(x1 − x0)/h + G x1 = b1.
  const euler = solver(combine(1 / h, 1), 1 / h);
  const qs: number[][] = [q0];
  const t1 = Math.min(h, tStop);
  {
    const b = rhsAt(t1);
    const x1 = euler(
      b.map((bi, i) => bi + (q0[i] as number) / h),
      xs[0] as number[],
      t1,
    );
    xs.push(x1);
    qs.push(mulC(x1));
    times.push(t1);
  }

  let step: Solve;
  if (method === "euler") step = euler;
  else if (method === "gear2") step = solver(combine(3 / (2 * h), 1), 3 / (2 * h));
  else step = solver(combine(1 / h, 0.5), 1 / h);

  for (let k = 2; k <= steps; k++) {
    const t = Math.min(k * h, tStop);
    const b = rhsAt(t);
    const qn = qs[k - 1] as number[];
    let rhs: number[];
    if (method === "euler") {
      rhs = b.map((bi, i) => bi + (qn[i] as number) / h);
    } else if (method === "gear2") {
      const qp = qs[k - 2] as number[];
      rhs = b.map((bi, i) => bi + (4 * (qn[i] as number) - (qp[i] as number)) / (2 * h));
    } else {
      const bPrev = rhsAt(times[k - 1] as number);
      const gx = mulG(xs[k - 1] as number[]);
      rhs = b.map(
        (bi, i) => 0.5 * (bi + (bPrev[i] as number) - (gx[i] as number)) + (qn[i] as number) / h,
      );
    }
    const x = step(rhs, xs[k - 1] as number[], t);
    xs.push(x);
    qs.push(mulC(x));
    times.push(t);
  }

  // Derivatives by backward differences (second order from the third point on).
  const dxs = xs.map((x, k) => {
    if (k === 0) return new Array<number>(n).fill(initial === "op" ? 0 : NaN);
    const dt = (times[k] as number) - (times[k - 1] as number);
    const prev = xs[k - 1] as number[];
    if (k === 1) return x.map((v, i) => (v - (prev[i] as number)) / dt);
    const prev2 = xs[k - 2] as number[];
    return x.map((v, i) => (3 * v - 4 * (prev[i] as number) + (prev2[i] as number)) / (2 * dt));
  });
  if (initial !== "op" && dxs.length > 1) dxs[0] = [...(dxs[1] as number[])];

  const tStart = options.tStart ?? 0;
  const keep = times.map((t, i) => (t >= tStart - 1e-15 ? i : -1)).filter((i) => i >= 0);
  return new TransientResult(
    system,
    keep.map((i) => times[i] as number),
    keep.map((i) => xs[i] as number[]),
    keep.map((i) => dxs[i] as number[]),
    (idx) => valuesAt(times[keep[idx] as number] as number),
  );
}

/** `C·x(0)` built from the capacitor voltages and inductor currents given by their `ic`. */
function initialCharge(system: MnaSystem): number[] {
  const q = new Array<number>(system.size).fill(0);
  const add = (i: number, v: number) => {
    if (i >= 0) q[i] = (q[i] as number) + v;
  };
  for (const c of system.circuit.components) {
    if (c.type === "capacitor" && c.ic) {
      add(system.node(c.nodes[0]), c.value * c.ic);
      add(system.node(c.nodes[1]), -c.value * c.ic);
    } else if (c.type === "inductor" && c.ic) {
      add(system.branch(c.id), -c.value * c.ic);
    } else if (c.type === "coupling") {
      const [l1, l2] = c.inductors.map((id) => system.circuit.component(id));
      if (l1?.type !== "inductor" || l2?.type !== "inductor") continue;
      const m = c.k * Math.sqrt(l1.value * l2.value);
      if (l2.ic) add(system.branch(l1.id), -m * l2.ic);
      if (l1.ic) add(system.branch(l2.id), -m * l1.ic);
    }
  }
  return q;
}

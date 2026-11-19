import { ElecMapError } from "../core/errors";
import { RealLU } from "../math/linear";
import type { MnaSystem } from "../mna/system";

/** Tolerances and limits of the Newton-Raphson solver (SPICE defaults). */
export interface NewtonOptions {
  /** Maximum number of iterations per solve (default 100). */
  maxIterations?: number;
  /** Relative tolerance on every unknown (default 1e-3). */
  reltol?: number;
  /** Absolute tolerance on node voltages (V, default 1e-6). */
  vntol?: number;
  /** Absolute tolerance on branch currents (A, default 1e-12). */
  abstol?: number;
}

/** Junction state of every device (previous voltages, for step limiting). */
export type DeviceStates = Map<string, Record<string, number>>;

/** Conductance placed across every junction (S), as SPICE's GMIN. */
export const DEVICE_GMIN = 1e-12;

/**
 * Solves `A·x + f(x) = r`, where `A` is the linear part of the circuit and `f`
 * the current of the non-linear devices, by Newton-Raphson with junction
 * voltage limiting. Returns `undefined` if it does not converge.
 *
 * `states` is updated in place, so that a following solve (next time step,
 * next continuation step) starts from the last junction voltages.
 */
export function newtonSolve(
  system: MnaSystem,
  A: readonly (readonly number[])[],
  r: readonly number[],
  x0: readonly number[],
  states: DeviceStates,
  options: NewtonOptions = {},
  /** Start the junctions at their default guess (solve from scratch). */
  initial = false,
  /** Coefficient of the junction charges in the equation (transient steps), none in DC. */
  charge?: number,
): { x: number[]; iterations: number } | undefined {
  const maxIterations = options.maxIterations ?? 100;
  const reltol = options.reltol ?? 1e-3;
  const vntol = options.vntol ?? 1e-6;
  const abstol = options.abstol ?? 1e-12;
  let x = [...x0];
  for (let it = 1; it <= maxIterations; it++) {
    const M = A.map((row) => [...row]);
    const b = [...r];
    const limited = system.load(M, b, x, states, DEVICE_GMIN, initial && it === 1, charge);
    let next: number[];
    try {
      next = new RealLU(M, 0).solve(b);
    } catch (e) {
      if (e instanceof ElecMapError && e.code === "SINGULAR_MATRIX") return undefined;
      throw e;
    }
    if (!next.every(Number.isFinite)) return undefined;
    let converged = !limited && it > 1;
    for (let i = 0; converged && i < next.length; i++) {
      const a = next[i] as number;
      const p = x[i] as number;
      const tol =
        reltol * Math.max(Math.abs(a), Math.abs(p)) + (i < system.nodeCount ? vntol : abstol);
      if (Math.abs(a - p) > tol) converged = false;
    }
    x = next;
    if (converged) {
      // One more (quadratically convergent) step, linearised at the accepted point:
      // the result is then accurate far below the tolerances.
      const M2 = A.map((row) => [...row]);
      const b2 = [...r];
      system.load(M2, b2, x, states, DEVICE_GMIN, false, charge);
      try {
        const polished = new RealLU(M2, 0).solve(b2);
        if (polished.every(Number.isFinite)) x = polished;
      } catch {
        // Keep the accepted iterate.
      }
      return { x, iterations: it + 1 };
    }
  }
  return undefined;
}

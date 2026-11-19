import { ElecMapError } from "../core/errors";
import { RealLU } from "../math/linear";
import type { MnaSystem } from "../mna/system";
import { dcValues } from "../mna/system";
import type { SourceValues } from "../mna/system";
import { newtonSolve } from "./newton";
import type { DeviceStates, NewtonOptions } from "./newton";
import { DcSolution } from "./solution";

/** Options for {@link operatingPoint}. */
export interface DcOptions extends NewtonOptions {
  /**
   * Conductance (S) added from every node to ground when the plain system is singular
   * (nodes without DC path, e.g. behind a series capacitor). Default `1e-12`, as in SPICE.
   * Set to 0 to disable the fallback.
   */
  gmin?: number;
  /** Source values (default: each source's `dc` value). */
  values?: SourceValues;
}

/**
 * DC operating point: capacitors are open circuits, inductors short circuits.
 *
 * Circuits with non-linear devices are solved by Newton-Raphson with junction
 * voltage limiting; when it fails, by gmin stepping, then by source stepping.
 *
 * @throws {@link ElecMapError} `SINGULAR_MATRIX` if the circuit has no unique DC solution,
 *   `NO_CONVERGENCE` if Newton-Raphson fails
 */
export function operatingPoint(system: MnaSystem, options: DcOptions = {}): DcSolution {
  const values = options.values ?? dcValues;
  const b = system.rhs(values).map((v) => v.re);
  const gmin = options.gmin ?? 1e-12;
  if (!system.linear) return nonlinearOperatingPoint(system, b, values, gmin, options);
  try {
    return new DcSolution(system, new RealLU(system.dcMatrix()).solve(b), values, false);
  } catch (e) {
    if (!(e instanceof ElecMapError) || e.code !== "SINGULAR_MATRIX" || gmin === 0) throw e;
  }
  try {
    return new DcSolution(system, new RealLU(system.dcMatrix(gmin), 0).solve(b), values, true);
  } catch (e) {
    if (e instanceof ElecMapError && e.code === "SINGULAR_MATRIX") {
      throw new ElecMapError(
        "SINGULAR_MATRIX",
        "The circuit has no unique DC solution (check for voltage-source / inductor loops or current-source cut sets)",
        e.details as Record<string, unknown>,
      );
    }
    throw e;
  }
}

function nonlinearOperatingPoint(
  system: MnaSystem,
  b: readonly number[],
  values: SourceValues,
  gmin: number,
  options: NewtonOptions,
): DcSolution {
  const zero = new Array<number>(system.size).fill(0);
  let iterations = 0;
  const done = (x: number[], gminUsed: boolean) =>
    new DcSolution(system, x, values, gminUsed, iterations);

  // 1. Plain Newton from zero (then with gmin to ground if the linear part is singular).
  for (const g of gmin > 0 ? [0, gmin] : [0]) {
    const r = newtonSolve(system, system.dcMatrix(g), b, zero, new Map(), options, true);
    if (r) {
      iterations += r.iterations;
      return done(r.x, g > 0);
    }
    iterations += options.maxIterations ?? 100;
  }

  // 2. Gmin stepping: a large conductance to ground makes the problem almost linear,
  //    then it is decreased by decades, each solve starting from the previous one.
  {
    const states: DeviceStates = new Map();
    let x: number[] | undefined = zero;
    for (let g = 1e-2; x && g >= Math.max(gmin, 1e-12) / 1.001; g /= 10) {
      const r = newtonSolve(system, system.dcMatrix(g), b, x, states, options, x === zero);
      x = r?.x;
      iterations += r?.iterations ?? 0;
    }
    if (x) {
      const r = newtonSolve(system, system.dcMatrix(0), b, x, states, options);
      if (r) {
        iterations += r.iterations;
        return done(r.x, false);
      }
      if (gmin > 0) return done(x, true);
    }
  }

  // 3. Source stepping: every independent source ramped from 0 to its value.
  {
    let states: DeviceStates = new Map();
    const A = system.dcMatrix(gmin);
    let x = zero;
    let lambda = 0;
    let step = 0.1;
    while (lambda < 1) {
      const target = Math.min(1, lambda + step);
      const trial: DeviceStates = new Map([...states].map(([k, v]) => [k, { ...v }]));
      const r = newtonSolve(
        system,
        A,
        b.map((v) => v * target),
        x,
        trial,
        options,
        lambda === 0,
      );
      if (r) {
        iterations += r.iterations;
        x = r.x;
        states = trial;
        lambda = target;
        step = Math.min(step * 2, 0.5);
      } else {
        step /= 4;
        if (step < 1e-4) break;
      }
    }
    if (lambda >= 1) return done(x, gmin > 0);
  }

  throw new ElecMapError(
    "NO_CONVERGENCE",
    `DC operating point did not converge (Newton-Raphson, gmin and source stepping failed). Non-linear devices: ${system.nonlinear.map((c) => c.id).join(", ")}`,
    { devices: system.nonlinear.map((c) => c.id) },
  );
}

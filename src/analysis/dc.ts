import { ElecMapError } from "../core/errors";
import { RealLU } from "../math/linear";
import type { MnaSystem } from "../mna/system";
import { dcValues } from "../mna/system";
import type { SourceValues } from "../mna/system";
import { DcSolution } from "./solution";

/** Options for {@link operatingPoint}. */
export interface DcOptions {
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
 * @throws {@link ElecMapError} `SINGULAR_MATRIX` if the circuit has no unique DC solution
 */
export function operatingPoint(system: MnaSystem, options: DcOptions = {}): DcSolution {
  const values = options.values ?? dcValues;
  const b = system.rhs(values).map((v) => v.re);
  const gmin = options.gmin ?? 1e-12;
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

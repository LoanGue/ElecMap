import { compile } from "../core/circuit";
import type { CircuitJSON, ComponentJSON } from "../format/types";
import type { ValidationIssue } from "../format/validate";
import { MnaSystem } from "../mna/system";
import { operatingPoint } from "./dc";
import { transferFunction } from "./transfer";
import type { TransferOptions } from "./transfer";

/** Finite op-amp put in place of each ideal one by {@link feedbackWarnings}. */
export const CHECK_OPAMP = { gain: 1e5, gbw: 1e6 } as const;

/**
 * Checks that the transfer function of a circuit with ideal op-amps (no `gain`)
 * has a physical meaning. An ideal op-amp has no dynamics, so the linear result
 * looks stable even in positive feedback (a comparator, a Schmitt trigger).
 * The same transfer function is computed with each ideal op-amp replaced by
 * {@link CHECK_OPAMP} (rails ignored, other devices linearised at their
 * operating point). Right-half-plane poles there give a `POSITIVE_FEEDBACK`
 * warning. Without ideal op-amps, or if the check itself fails, returns `[]`.
 */
export function feedbackWarnings(system: MnaSystem, options: TransferOptions): ValidationIssue[] {
  const doc = system.circuit.toJSON();
  const ideal = doc.components.filter((c) => c.type === "opamp" && c.gain === undefined);
  if (ideal.length === 0) return [];
  let unstable: boolean;
  try {
    const checked = new MnaSystem(compile(withFiniteOpamps(doc)));
    const linear = checked.linear ? checked : checked.smallSignal(operatingPoint(checked).x);
    unstable = transferFunction(linear, options)
      .poles()
      .some((p) => p.re > 1e-9 * Math.max(1, p.abs()));
  } catch {
    return [];
  }
  if (!unstable) return [];
  const ids = ideal.map((c) => c.id).join(", ");
  return [
    {
      severity: "warning",
      code: "POSITIVE_FEEDBACK",
      message: `Unstable with a real op-amp (${ids} as GAIN=1e5 GBW=1e6): positive feedback, the linear result has no physical meaning`,
      ...(ideal.length === 1 ? { componentId: (ideal[0] as ComponentJSON).id } : {}),
    },
  ];
}

/** The circuit with every ideal op-amp made finite and every rail removed. */
function withFiniteOpamps(doc: CircuitJSON): CircuitJSON {
  const components = doc.components.map((c): ComponentJSON => {
    if (c.type !== "opamp") return c;
    const { vpos: _vpos, vneg: _vneg, ...linear } = c;
    return c.gain === undefined ? { ...linear, ...CHECK_OPAMP } : linear;
  });
  return { ...doc, components };
}

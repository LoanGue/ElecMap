/**
 * Transfer function between two voltages of the circuit, `H = V(out) / V(in)`,
 * where `in` is a node (or a pair of nodes) rather than a source. Both voltages
 * are computed for the same driving source, then divided; the common factors
 * (the circuit's own poles) cancel.
 */
import { ElecMapError } from "../core/errors";
import { Rational } from "../math/rational";
import type { MnaSystem } from "../mna/system";
import { singleSource } from "../mna/system";
import type { OutputSpec, VoltageInput } from "./transfer";
import {
  cancelCommon,
  computeRational,
  outputForm,
  resolveInput,
  TransferFunction,
} from "./transfer";

/** `V(output) / V(input.voltage)`, both driven by `input.source`. */
export function voltageRatio(
  system: MnaSystem,
  output: OutputSpec,
  input: VoltageInput,
): TransferFunction {
  const source = resolveInput(system, input.source);
  const values = singleSource(source, 1);
  const b = system.rhs(values);
  const out = outputForm(system, output);
  const inp = outputForm(system, input.voltage);
  const hIn = computeRational(system, b, inp.form, values);
  if (hIn.isZero()) {
    throw new ElecMapError(
      "INVALID_ARGUMENT",
      `${inp.label} does not depend on ${source}: the ratio is undefined`,
      { source },
    );
  }
  const ratio = computeRational(system, b, out.form, values).div(hIn);
  const { num, den } = cancelCommon(ratio.num, ratio.den);
  return new TransferFunction(new Rational(num, den), { input: inp.label, output: out.label });
}

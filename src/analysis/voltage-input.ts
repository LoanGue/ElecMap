/**
 * Transfer function between two voltages of the circuit, `H = V(out) / V(in)`,
 * where `in` is a node (or a pair of nodes) rather than a source. Both voltages
 * are computed for the same driving source, then divided; the poles they share
 * (the circuit's own, often repeated) cancel.
 */
import { ElecMapError } from "../core/errors";
import { Complex } from "../math/complex";
import { Polynomial } from "../math/polynomial";
import { Rational } from "../math/rational";
import { polynomialRoots } from "../math/roots";
import type { MnaSystem } from "../mna/system";
import { singleSource } from "../mna/system";
import type { OutputSpec, VoltageInput } from "./transfer";
import { computeRational, outputForm, resolveInput, TransferFunction } from "./transfer";

/**
 * Relative distance under which a root of the numerator and one of the
 * denominator are taken as the same. Repeated roots come out of the root
 * finder spread by about `ε^(1/m)`, so this is far looser than for simple roots.
 */
const SAME_ROOT = 1e-3;

const rootsOf = (p: Polynomial): Complex[] => (p.degree > 0 ? polynomialRoots(p) : []);

const near = (a: Complex, b: Complex): boolean =>
  a.sub(b).abs() <= SAME_ROOT * Math.max(a.abs(), b.abs(), 1e-300);

/**
 * Cancels the roots found on both sides. Roots are grouped in clusters (a
 * multiple root comes out as a small cluster around the true value); a
 * cluster with more roots on top than at the bottom keeps the difference on
 * top, all placed at the cluster's centroid, which is accurate.
 */
function cancel(top: Complex[], bottom: Complex[]): [Complex[], Complex[]] {
  const all = [...top.map((r) => ({ r, side: 1 })), ...bottom.map((r) => ({ r, side: -1 }))];
  const done = new Set<number>();
  const kept: [Complex[], Complex[]] = [[], []];
  all.forEach(({ r }, i) => {
    if (done.has(i)) return;
    const group = all.flatMap((q, j) => (!done.has(j) && near(r, q.r) ? [j] : []));
    for (const j of group) done.add(j);
    const pick = (j: number) => all[j] as { r: Complex; side: number };
    const excess = group.reduce((n, j) => n + pick(j).side, 0);
    const centre = group.reduce((acc, j) => acc.add(pick(j).r), Complex.ZERO).mul(1 / group.length);
    const side = excess > 0 ? kept[0] : kept[1];
    for (let k = 0; k < Math.abs(excess); k++) side.push(group.length === 1 ? r : centre);
  });
  return kept;
}

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
  const hOut = computeRational(system, b, out.form, values);
  const meta = { input: inp.label, output: out.label };
  if (hOut.isZero()) return new TransferFunction(Rational.constant(0), meta);
  // (No / Do) / (Ni / Di) = No·Di / (Do·Ni), each factor's roots found on its own.
  const [zeros, poles] = cancel(
    [...rootsOf(hOut.num), ...rootsOf(hIn.den)],
    [...rootsOf(hOut.den), ...rootsOf(hIn.num)],
  );
  // The shape comes from the roots; the gain is set from the exact ratio at one
  // frequency, away from the roots, so root-finding error does not reach it.
  const all = [...zeros, ...poles].map((r) => r.abs()).filter((m) => m > 0);
  const w = all.length ? Math.exp(all.reduce((a, m) => a + Math.log(m), 0) / all.length) : 1;
  const at = new Complex(0, 1.37 * w);
  const num = Polynomial.fromRoots(zeros);
  const den = Polynomial.fromRoots(poles);
  const exact = hOut.evaluate(at).div(hIn.evaluate(at));
  const gain = exact.div(new Rational(num, den).evaluate(at)).re;
  return new TransferFunction(new Rational(num.scale(gain), den), meta);
}

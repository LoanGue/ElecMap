/**
 * Shortest decimal form of `x` at 12 significant digits, for display: hides
 * floating-point noise such as `9.999999999999998` or `0.00009999999999999999`.
 */
export function displayNumber(x: number): string {
  if (!Number.isFinite(x) || x === 0) return String(x === 0 ? 0 : x);
  return String(Number(x.toPrecision(12)));
}

import type { Polynomial } from "../math/polynomial";

/** Options for LaTeX number and polynomial formatting. */
export interface LatexNumberOptions {
  /** Significant digits (default 4). */
  digits?: number;
}

/** Options for {@link polynomialToLatex}. */
export interface LatexPolynomialOptions extends LatexNumberOptions {
  /** Variable name (default `s`). */
  variable?: string;
  /** Term order (default `"ascending"`, i.e. `1 + a s + b s^{2}`). */
  order?: "ascending" | "descending";
}

/**
 * Formats a number for LaTeX: plain decimals between 10⁻³ and 10⁴, otherwise
 * scientific notation `m \times 10^{e}`.
 */
export function latexNumber(value: number, options: LatexNumberOptions = {}): string {
  const digits = options.digits ?? 4;
  if (value === 0) return "0";
  if (!Number.isFinite(value)) return value > 0 ? "\\infty" : "-\\infty";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e-3 && abs < 1e4) return sign + trimNumber(abs.toPrecision(digits));
  const [mantissa, exponent] = abs.toExponential(digits - 1).split("e") as [string, string];
  const m = trimNumber(mantissa);
  const e = Number(exponent);
  return m === "1" ? `${sign}10^{${e}}` : `${sign}${m} \\times 10^{${e}}`;
}

function trimNumber(text: string): string {
  if (text.includes("e")) return String(Number(text));
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/** Formats a polynomial for LaTeX, e.g. `1 + 10^{-4}\,s + 2.5 \times 10^{-9}\,s^{2}`. */
export function polynomialToLatex(p: Polynomial, options: LatexPolynomialOptions = {}): string {
  const variable = options.variable ?? "s";
  const terms: { k: number; c: number }[] = [];
  p.coeffs.forEach((c, k) => {
    if (c !== 0) terms.push({ k, c });
  });
  if (terms.length === 0) return "0";
  if (options.order === "descending") terms.reverse();

  let out = "";
  terms.forEach(({ k, c }, i) => {
    const power = k === 0 ? "" : k === 1 ? variable : `${variable}^{${k}}`;
    const n = latexNumber(Math.abs(c), options);
    let body: string;
    if (k === 0) body = n;
    else if (n === "1") body = power;
    else body = n.includes("\\times") ? `\\left(${n}\\right) ${power}` : `${n}\\,${power}`;
    if (i === 0) out += (c < 0 ? "-" : "") + body;
    else out += (c < 0 ? " - " : " + ") + body;
  });
  return out;
}

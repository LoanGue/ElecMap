/**
 * Pure formatting and parsing helpers of the playground: HTML escaping, SPICE
 * numbers, SI values, error messages. No DOM, no module state.
 */
import { ElecMapError, formatSI } from "../../src";
import type { Complex } from "../../src";

export function esc(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );
}

/** SPICE-style number for the input boxes: 0.002 → "2m". */
export function spice(v: number): string {
  const table: [number, string][] = [
    [1e9, "g"],
    [1e6, "meg"],
    [1e3, "k"],
    [1, ""],
    [1e-3, "m"],
    [1e-6, "u"],
    [1e-9, "n"],
    [1e-12, "p"],
  ];
  const a = Math.abs(v);
  for (const [scale, suffix] of table) {
    if (a >= scale * 0.9995) return `${Number((v / scale).toPrecision(4))}${suffix}`;
  }
  return `${v}`;
}

/** Parses "2m", "1.5k", "10meg", "3e-6" (empty or invalid → undefined). */
export function parseNumber(text: string): number | undefined {
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(meg|[fpnumkgt]|µ)?/i.exec(text);
  if (!m) return undefined;
  const scale: Record<string, number> = {
    f: 1e-15,
    p: 1e-12,
    n: 1e-9,
    u: 1e-6,
    µ: 1e-6,
    m: 1e-3,
    k: 1e3,
    meg: 1e6,
    g: 1e9,
    t: 1e12,
  };
  const v = Number(m[1]) * (m[2] ? (scale[m[2].toLowerCase()] ?? 1) : 1);
  return Number.isFinite(v) ? v : undefined;
}

export const si = (v: number, unit: string, digits = 4): string =>
  Number.isFinite(v) ? formatSI(v, unit, digits) : v > 0 ? "∞" : v < 0 ? "−∞" : "—";

export function complexText(z: Complex, unit = ""): string {
  if (Math.abs(z.im) < 1e-12 * Math.max(1, Math.abs(z.re))) return si(z.re, unit);
  const sign = z.im < 0 ? "−" : "+";
  return `${si(z.re, "")} ${sign} j${si(Math.abs(z.im), "")}${unit ? ` ${unit}` : ""}`;
}

export function message(err: unknown): string {
  if (err instanceof ElecMapError) {
    const issues = err.details?.["issues"];
    if (Array.isArray(issues) && issues.length > 0) {
      return issues
        .map((i: { message?: string }) => i.message ?? "")
        .filter(Boolean)
        .join("\n");
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export function option(value: string, label: string, current: string): string {
  return `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(label)}</option>`;
}

/** A node name inside LaTeX. */
export const texName = (name: string): string => `\\mathrm{${name.replace(/[_#%&${}]/g, "\\$&")}}`;

export function attempt<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}

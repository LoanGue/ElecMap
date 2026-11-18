/**
 * SI / SPICE number parsing and formatting.
 *
 * @module
 */

/**
 * SPICE scale suffixes (case-insensitive) as powers of ten. `M` is milli and
 * `MEG` is mega, as in SPICE. `mil` (25.4 µm) is handled separately.
 */
const SUFFIX_EXPONENTS: Record<string, number> = {
  t: 12,
  g: 9,
  meg: 6,
  k: 3,
  r: 0,
  m: -3,
  u: -6,
  µ: -6,
  μ: -6,
  n: -9,
  p: -12,
  f: -15,
};

const VALUE_RE = /^([+-]?(?:\d+\.?\d*|\.\d+))(?:e([+-]?\d+))?(meg|mil|[tgkmuµμnpf])?([a-zΩ]*)$/i;
/** European "4k7" notation: suffix used as decimal point. */
const INFIX_RE = /^([+-]?\d+)(meg|[tgkmuµμnpfr])(\d+)([a-zΩ]*)$/i;

/** Builds `mantissa × 10^exponent` through decimal text, so that `100n` is exactly `1e-7`. */
function scaled(mantissa: string, exponent: number): number {
  return Number(`${mantissa}e${exponent}`);
}

/**
 * Parses a SPICE-style value: `1k`, `4.7u`, `100nF`, `1e-3`, `2MEG`, `4k7`, `1R5`.
 * Trailing unit letters (`F`, `H`, `ohm`, `Hz`…) are ignored, as in SPICE —
 * beware that, as in SPICE, `1F` means 1 femto and `1M` means 1 milli.
 *
 * @returns the value in SI units, or `undefined` if the text is not a number.
 */
export function parseValue(text: string): number | undefined {
  const t = text.trim();
  const m = VALUE_RE.exec(t);
  if (m) {
    const exp = m[2] === undefined ? 0 : Number(m[2]);
    const suffix = m[3]?.toLowerCase();
    if (suffix === "mil") return scaled(m[1] as string, exp) * 25.4e-6;
    return scaled(m[1] as string, exp + (suffix ? (SUFFIX_EXPONENTS[suffix] as number) : 0));
  }
  const inf = INFIX_RE.exec(t);
  if (inf) {
    const suffix = (inf[2] as string).toLowerCase();
    return scaled(`${inf[1]}.${inf[3]}`, SUFFIX_EXPONENTS[suffix] as number);
  }
  return undefined;
}

const PREFIXES: [number, string][] = [
  [1e12, "T"],
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
  [1, ""],
  [1e-3, "m"],
  [1e-6, "µ"],
  [1e-9, "n"],
  [1e-12, "p"],
  [1e-15, "f"],
];

/**
 * Formats a number with an SI prefix: `formatSI(4700, "Ω") → "4.7 kΩ"`.
 *
 * @param digits significant digits (default 3)
 */
export function formatSI(value: number, unit = "", digits = 3): string {
  if (!Number.isFinite(value)) return `${value} ${unit}`.trim();
  if (value === 0) return `0 ${unit}`.trim();
  const abs = Math.abs(value);
  const [scale, prefix] = PREFIXES.find(([s]) => abs >= s * 0.9995) ?? [1e-15, "f"];
  const n = Number((value / scale).toPrecision(digits));
  return `${n} ${prefix}${unit}`.trim();
}

/**
 * Formats a number in SPICE notation, round-trippable through {@link parseValue}:
 * `formatSpice(4700) → "4.7k"`, `formatSpice(1e6) → "1meg"`.
 */
export function formatSpice(value: number): string {
  if (value === 0 || !Number.isFinite(value)) return `${value}`;
  const abs = Math.abs(value);
  const table: [number, string][] = [
    [1e12, "t"],
    [1e9, "g"],
    [1e6, "meg"],
    [1e3, "k"],
    [1, ""],
    [1e-3, "m"],
    [1e-6, "u"],
    [1e-9, "n"],
    [1e-12, "p"],
    [1e-15, "f"],
  ];
  for (const [scale, suffix] of table) {
    if (abs >= scale * 0.9999999) {
      const n = Number((value / scale).toPrecision(12));
      return `${n}${suffix}`;
    }
  }
  return `${value}`;
}

/** One term `c · Π xᵢ^{eᵢ}` of a {@link MPoly}. */
export interface MTerm {
  /** Exponent of every variable (fixed length). */
  readonly exps: readonly number[];
  /** Coefficient. */
  readonly c: number;
  /**
   * Magnitude of the contributions that summed into `c` (used to detect
   * floating-point cancellation when some values are numeric).
   */
  readonly mag: number;
}

const keyOf = (exps: readonly number[]): string => exps.join(",");

/** Relative threshold below which a cancelled coefficient is considered zero. */
const CANCEL = 1e-11;

/**
 * Sparse multivariate polynomial with real coefficients over a fixed number of
 * variables. Immutable.
 */
export class MPoly {
  private constructor(
    /** Number of variables. */
    readonly nvars: number,
    private readonly map: ReadonlyMap<string, MTerm>,
  ) {}

  /** The zero polynomial. */
  static zero(nvars: number): MPoly {
    return new MPoly(nvars, new Map());
  }

  /** A constant. */
  static constant(nvars: number, c: number): MPoly {
    if (c === 0) return MPoly.zero(nvars);
    const exps = new Array<number>(nvars).fill(0);
    return new MPoly(nvars, new Map([[keyOf(exps), { exps, c, mag: Math.abs(c) }]]));
  }

  /** The monomial `c · x_index`. */
  static variable(nvars: number, index: number, c = 1): MPoly {
    const exps = new Array<number>(nvars).fill(0);
    exps[index] = 1;
    return new MPoly(nvars, new Map([[keyOf(exps), { exps, c, mag: Math.abs(c) }]]));
  }

  /** Builds a polynomial from terms (like terms are summed). */
  static fromTerms(nvars: number, terms: Iterable<MTerm>): MPoly {
    const map = new Map<string, MTerm>();
    for (const t of terms) MPoly.accumulate(map, t.exps, t.c, t.mag);
    return new MPoly(nvars, MPoly.clean(map));
  }

  private static accumulate(
    map: Map<string, MTerm>,
    exps: readonly number[],
    c: number,
    mag: number,
  ): void {
    const k = keyOf(exps);
    const t = map.get(k);
    if (t) map.set(k, { exps: t.exps, c: t.c + c, mag: t.mag + mag });
    else map.set(k, { exps, c, mag });
  }

  private static clean(map: Map<string, MTerm>): Map<string, MTerm> {
    for (const [k, t] of map) {
      if (t.c === 0 || Math.abs(t.c) <= CANCEL * t.mag) map.delete(k);
    }
    return map;
  }

  /** Terms (unordered). */
  get terms(): MTerm[] {
    return [...this.map.values()];
  }

  /** Number of terms. */
  get size(): number {
    return this.map.size;
  }

  isZero(): boolean {
    return this.map.size === 0;
  }

  add(other: MPoly): MPoly {
    if (other.isZero()) return this;
    if (this.isZero()) return other;
    const map = new Map(this.map);
    for (const t of other.map.values()) MPoly.accumulate(map, t.exps, t.c, t.mag);
    return new MPoly(this.nvars, MPoly.clean(map));
  }

  sub(other: MPoly): MPoly {
    return this.add(other.neg());
  }

  neg(): MPoly {
    return this.scale(-1);
  }

  scale(k: number): MPoly {
    if (k === 0) return MPoly.zero(this.nvars);
    const map = new Map<string, MTerm>();
    for (const [key, t] of this.map) {
      map.set(key, { exps: t.exps, c: t.c * k, mag: t.mag * Math.abs(k) });
    }
    return new MPoly(this.nvars, map);
  }

  mul(other: MPoly): MPoly {
    if (this.isZero() || other.isZero()) return MPoly.zero(this.nvars);
    const map = new Map<string, MTerm>();
    for (const a of this.map.values()) {
      for (const b of other.map.values()) {
        const exps = a.exps.map((e, i) => e + (b.exps[i] as number));
        MPoly.accumulate(map, exps, a.c * b.c, a.mag * b.mag);
      }
    }
    return new MPoly(this.nvars, MPoly.clean(map));
  }

  /** Applies `f` to the exponent vector of every term (terms that collide are summed). */
  mapExponents(f: (exps: readonly number[]) => number[]): MPoly {
    return MPoly.fromTerms(
      this.nvars,
      this.terms.map((t) => ({ exps: f(t.exps), c: t.c, mag: t.mag })),
    );
  }

  /** Highest exponent of a variable (0 for the zero polynomial). */
  degreeIn(index: number): number {
    let d = 0;
    for (const t of this.map.values()) d = Math.max(d, t.exps[index] as number);
    return d;
  }

  /** Lowest exponent of every variable over all terms (the monomial content). */
  minExponents(): number[] {
    const out = new Array<number>(this.nvars).fill(Infinity);
    for (const t of this.map.values())
      t.exps.forEach((e, i) => (out[i] = Math.min(out[i] as number, e)));
    return out.map((e) => (e === Infinity ? 0 : e));
  }

  /** Evaluates the polynomial for the given variable values. */
  evaluate(values: readonly number[]): number {
    let acc = 0;
    for (const t of this.map.values()) {
      let v = t.c;
      t.exps.forEach((e, i) => {
        if (e !== 0) v *= (values[i] as number) ** e;
      });
      acc += v;
    }
    return acc;
  }

  /**
   * Coefficients of the powers of variable `index`, as polynomials in the
   * other variables: `[p₀, p₁, …]` with `this = Σ pₖ·x^k`.
   */
  coefficientsIn(index: number): MPoly[] {
    const out = Array.from({ length: this.degreeIn(index) + 1 }, () => [] as MTerm[]);
    for (const t of this.map.values()) {
      const k = t.exps[index] as number;
      const exps = [...t.exps];
      exps[index] = 0;
      (out[k] as MTerm[]).push({ exps, c: t.c, mag: t.mag });
    }
    return out.map((terms) => MPoly.fromTerms(this.nvars, terms));
  }
}

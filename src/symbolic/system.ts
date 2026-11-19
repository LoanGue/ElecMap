import { ElecMapError } from "../core/errors";
import type { ComponentJSON } from "../format/types";
import type { MnaSystem } from "../mna/system";
import { MPoly } from "./mpoly";

/** Kind of quantity a symbol stands for (used to order and describe symbols). */
export type SymbolKind =
  | "resistance"
  | "inductance"
  | "capacitance"
  | "mutual"
  | "gain"
  | "transconductance"
  | "transresistance"
  | "pole";

/** A literal symbol of a symbolic expression. */
export interface CircuitSymbol {
  /** Component the symbol belongs to. */
  id: string;
  /** LaTeX rendering, e.g. `R_{1}`. */
  latex: string;
  /** Plain-text name, e.g. `R1` (or `A_E1` for a gain). */
  name: string;
  kind: SymbolKind;
  /** Numeric value of the symbol in the circuit. */
  value: number;
}

/** Options shared by the symbolic analyses. */
export interface SymbolicOptions {
  /**
   * Ids of the components kept as literal symbols (default: every passive and
   * controlled element). The others are replaced by their numeric value.
   */
  symbols?: readonly string[];
  /** Custom LaTeX of some symbols, by component id (e.g. `{ Rf: "R_{f}" }`). */
  names?: Readonly<Record<string, string>>;
}

/** Variable of the symbolic MNA system. */
export interface SymVariable {
  /** `null` for the Laplace variable `s` and for hidden conductances. */
  symbol: CircuitSymbol | null;
  /** For a hidden conductance `G = 1/R`: index of the resistance variable. */
  inverseOf?: number;
}

/** Linear form of the unknowns with polynomial coefficients. */
export interface SymForm {
  terms: { index: number; coeff: MPoly }[];
  /** Constant part (contribution of the input source itself). */
  constant: number;
}

const ORDER: Record<SymbolKind, number> = {
  resistance: 0,
  inductance: 1,
  mutual: 2,
  capacitance: 3,
  gain: 4,
  transconductance: 5,
  transresistance: 6,
  pole: 7,
};

/** LaTeX of an id: `R1` → `R_{1}`, `Rload` → `R_{load}`, `C_in` → `C_{in}`. */
export function idToLatex(id: string): string {
  const m = /^([A-Za-z])_?(.+)$/.exec(id);
  if (!m) return id;
  return `${m[1] as string}_{${escapeLatex(m[2] as string)}}`;
}

function escapeLatex(text: string): string {
  return text.replace(/[\\{}&%$#^~]/g, (c) => `\\${c}`).replace(/_/g, "\\_");
}

/**
 * MNA matrix `A(s)` of a circuit whose entries are multivariate polynomials in
 * `s` and in the component symbols. Resistors enter through hidden
 * conductance variables `G = 1/R`, cleared after the determinants are computed.
 */
export class SymbolicSystem {
  readonly variables: SymVariable[] = [{ symbol: null }];
  readonly matrix: MPoly[][];
  private readonly literal: ReadonlySet<string>;
  private readonly names: Readonly<Record<string, string>>;
  private nvarsFinal = 0;
  private readonly entries: { row: number; col: number; build: () => MPoly }[] = [];
  private readonly varOf = new Map<string, number>();

  constructor(
    readonly system: MnaSystem,
    options: SymbolicOptions = {},
  ) {
    if (system.nonlinear.length > 0) {
      throw new ElecMapError(
        "UNSUPPORTED",
        `Symbolic analysis of a non-linear circuit (${system.nonlinear.map((c) => c.id).join(", ")}) is not supported: use the numeric transferFunction, linearised at the operating point`,
      );
    }
    const ids = system.circuit.components.map((c) => c.id);
    for (const id of options.symbols ?? []) {
      if (!ids.includes(id)) {
        throw new ElecMapError("NOT_FOUND", `Unknown component "${id}" in \`symbols\``, {
          componentId: id,
        });
      }
    }
    this.literal = new Set(options.symbols ?? ids);
    this.names = options.names ?? {};
    // First pass: declare the variables, so that every polynomial has the same arity.
    for (const c of system.circuit.components) this.declare(c);
    this.sortVariables();
    this.nvarsFinal = this.variables.length;
    const n = system.size;
    const m = Array.from({ length: n }, () =>
      Array.from({ length: n }, () => MPoly.zero(this.nvarsFinal)),
    );
    for (const c of system.circuit.components) this.stamp(c);
    for (const { row, col, build } of this.entries) {
      if (row < 0 || col < 0) continue;
      const r = m[row] as MPoly[];
      r[col] = (r[col] as MPoly).add(build());
    }
    this.matrix = m;
  }

  /** Number of variables (`s` is variable 0). */
  get nvars(): number {
    return this.nvarsFinal;
  }

  /** Literal symbols, in display order. */
  get symbols(): CircuitSymbol[] {
    return this.variables.flatMap((v) => (v.symbol ? [v.symbol] : []));
  }

  // ---------------------------------------------------------------- variables

  private isLiteral(c: ComponentJSON): boolean {
    return this.literal.has(c.id);
  }

  private addVariable(key: string, symbol: CircuitSymbol | null, inverseOf?: string): void {
    const v: SymVariable = { symbol };
    if (inverseOf !== undefined) v.inverseOf = this.varOf.get(inverseOf) as number;
    this.varOf.set(key, this.variables.length);
    this.variables.push(v);
  }

  private symbol(
    c: ComponentJSON,
    kind: SymbolKind,
    value: number,
    prefix?: string,
  ): CircuitSymbol {
    const custom = this.names[c.id];
    const latex = custom ?? (prefix ? `${prefix}_{${escapeLatex(c.id)}}` : idToLatex(c.id));
    const name = prefix ? `${prefix.replace(/\\/g, "")}_${c.id}` : c.id;
    return { id: c.id, latex, name, kind, value };
  }

  private declare(c: ComponentJSON): void {
    if (!this.isLiteral(c)) return;
    switch (c.type) {
      case "resistor":
        this.addVariable(c.id, this.symbol(c, "resistance", c.value));
        this.addVariable(`G:${c.id}`, null, c.id);
        break;
      case "switch": {
        const r = c.closed ? c.ron : c.roff;
        if (r === undefined) return;
        this.addVariable(c.id, this.symbol(c, "resistance", r, "R"));
        this.addVariable(`G:${c.id}`, null, c.id);
        break;
      }
      case "capacitor":
        this.addVariable(c.id, this.symbol(c, "capacitance", c.value));
        break;
      case "inductor":
        this.addVariable(c.id, this.symbol(c, "inductance", c.value));
        break;
      case "coupling": {
        const [l1, l2] = c.inductors.map((id) => this.system.circuit.component(id));
        const v = c.k * Math.sqrt(value(l1) * value(l2));
        this.addVariable(c.id, this.symbol(c, "mutual", v, "M"));
        break;
      }
      case "vcvs":
        this.addVariable(c.id, this.symbol(c, "gain", c.gain, "A"));
        break;
      case "cccs":
        this.addVariable(c.id, this.symbol(c, "gain", c.gain, "\\beta"));
        break;
      case "vccs":
        this.addVariable(c.id, this.symbol(c, "transconductance", c.gain, "g"));
        break;
      case "ccvs":
        this.addVariable(c.id, this.symbol(c, "transresistance", c.gain, "r"));
        break;
      case "opamp":
        if (c.gain === undefined) return;
        this.addVariable(c.id, this.symbol(c, "gain", c.gain, "A"));
        if (c.gbw !== undefined) {
          const wp = (2 * Math.PI * c.gbw) / c.gain;
          this.addVariable(`P:${c.id}`, this.symbol(c, "pole", wp, "\\omega"));
        }
        break;
      default:
        break;
    }
  }

  /** Orders the symbols by kind, keeping hidden conductances after their resistance. */
  private sortVariables(): void {
    const s = this.variables[0] as SymVariable;
    const keys = [...this.varOf.entries()];
    const visible = keys.filter(([, i]) => (this.variables[i] as SymVariable).symbol !== null);
    visible.sort(
      ([, a], [, b]) =>
        ORDER[(this.variables[a] as SymVariable).symbol?.kind ?? "pole"] -
          ORDER[(this.variables[b] as SymVariable).symbol?.kind ?? "pole"] || a - b,
    );
    const hidden = keys.filter(([, i]) => (this.variables[i] as SymVariable).symbol === null);
    const order = [...visible, ...hidden];
    const remap = new Map<number, number>(order.map(([, old], k) => [old, k + 1]));
    const vars = order.map(([, old]) => {
      const v = { ...(this.variables[old] as SymVariable) };
      if (v.inverseOf !== undefined) v.inverseOf = remap.get(v.inverseOf) as number;
      return v;
    });
    this.variables.length = 0;
    this.variables.push(s, ...vars);
    for (const [key, old] of keys) this.varOf.set(key, remap.get(old) as number);
  }

  private v(key: string, c = 1): MPoly {
    return MPoly.variable(this.nvarsFinal, this.varOf.get(key) as number, c);
  }

  private k(c: number): MPoly {
    return MPoly.constant(this.nvarsFinal, c);
  }

  /** `s · p`. */
  private s(p: MPoly): MPoly {
    return MPoly.variable(this.nvarsFinal, 0).mul(p);
  }

  // ---------------------------------------------------------------- stamps

  private add(row: number, col: number, build: () => MPoly): void {
    this.entries.push({ row, col, build });
  }

  private admittance(a: number, b: number, y: () => MPoly): void {
    this.add(a, a, y);
    this.add(b, b, y);
    this.add(a, b, () => y().neg());
    this.add(b, a, () => y().neg());
  }

  private incidence(k: number, a: number, b: number): void {
    const one = () => this.k(1);
    const minus = () => this.k(-1);
    this.add(a, k, one);
    this.add(b, k, minus);
    this.add(k, a, one);
    this.add(k, b, minus);
  }

  /** Conductance of a resistor-like element. */
  private conductance(c: ComponentJSON, r: number): () => MPoly {
    return this.isLiteral(c) ? () => this.v(`G:${c.id}`) : () => this.k(1 / r);
  }

  /** Value of a linear parameter, literal or numeric. */
  private param(c: ComponentJSON, key: string, numeric: number): () => MPoly {
    return this.isLiteral(c) ? () => this.v(key) : () => this.k(numeric);
  }

  private stamp(c: ComponentJSON): void {
    const sys = this.system;
    const node = (n: string) => sys.node(n);
    switch (c.type) {
      case "resistor":
        this.admittance(node(c.nodes[0]), node(c.nodes[1]), this.conductance(c, c.value));
        break;
      case "capacitor": {
        const cap = this.param(c, c.id, c.value);
        this.admittance(node(c.nodes[0]), node(c.nodes[1]), () => this.s(cap()));
        break;
      }
      case "inductor": {
        const k = sys.branch(c.id);
        this.incidence(k, node(c.nodes[0]), node(c.nodes[1]));
        const l = this.param(c, c.id, c.value);
        this.add(k, k, () => this.s(l()).neg());
        break;
      }
      case "coupling": {
        const [l1, l2] = c.inductors.map((id) => sys.circuit.component(id));
        const m = this.param(c, c.id, c.k * Math.sqrt(value(l1) * value(l2)));
        const [k1, k2] = c.inductors.map((id) => sys.branch(id)) as [number, number];
        this.add(k1, k2, () => this.s(m()).neg());
        this.add(k2, k1, () => this.s(m()).neg());
        break;
      }
      case "vsource":
        this.incidence(sys.branch(c.id), node(c.nodes[0]), node(c.nodes[1]));
        break;
      case "isource":
        break;
      case "vcvs": {
        const k = sys.branch(c.id);
        this.incidence(k, node(c.nodes[0]), node(c.nodes[1]));
        const a = this.param(c, c.id, c.gain);
        this.add(k, node(c.control[0]), () => a().neg());
        this.add(k, node(c.control[1]), a);
        break;
      }
      case "vccs": {
        const g = this.param(c, c.id, c.gain);
        const [p, n] = [node(c.nodes[0]), node(c.nodes[1])];
        const [cp, cn] = [node(c.control[0]), node(c.control[1])];
        this.add(p, cp, g);
        this.add(p, cn, () => g().neg());
        this.add(n, cp, () => g().neg());
        this.add(n, cn, g);
        break;
      }
      case "cccs": {
        const b = this.param(c, c.id, c.gain);
        const kc = sys.branch(c.controlSource);
        this.add(node(c.nodes[0]), kc, b);
        this.add(node(c.nodes[1]), kc, () => b().neg());
        break;
      }
      case "ccvs": {
        const k = sys.branch(c.id);
        this.incidence(k, node(c.nodes[0]), node(c.nodes[1]));
        const r = this.param(c, c.id, c.gain);
        this.add(k, sys.branch(c.controlSource), () => r().neg());
        break;
      }
      case "opamp": {
        const [ip, im, out] = c.nodes.map(node) as [number, number, number];
        const k = sys.branch(c.id);
        this.add(out, k, () => this.k(1));
        if (c.gain === undefined) {
          this.add(k, ip, () => this.k(1));
          this.add(k, im, () => this.k(-1));
          break;
        }
        const a = this.param(c, c.id, c.gain);
        if (c.gbw === undefined) {
          this.add(k, out, () => this.k(1));
          this.add(k, ip, () => a().neg());
          this.add(k, im, a);
        } else {
          // Row multiplied by ωp: (ωp + s)·Vout − A·ωp·(V+ − V−) = 0
          const wp = this.param(c, `P:${c.id}`, (2 * Math.PI * c.gbw) / c.gain);
          this.add(k, out, () => wp().add(MPoly.variable(this.nvarsFinal, 0)));
          this.add(k, ip, () => a().mul(wp()).neg());
          this.add(k, im, () => a().mul(wp()));
        }
        break;
      }
      case "switch": {
        const [a, b] = [node(c.nodes[0]), node(c.nodes[1])];
        const r = c.closed ? c.ron : c.roff;
        if (r !== undefined) this.admittance(a, b, this.conductance(c, r));
        else if (c.closed) this.incidence(sys.branch(c.id), a, b);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- forms

  /** Symbolic form of `V(a) − V(b)`. */
  voltageForm(a: string, b: string = this.system.circuit.ground): SymForm {
    const terms = [
      { index: this.system.node(a), coeff: this.k(1) },
      { index: this.system.node(b), coeff: this.k(-1) },
    ].filter((t) => t.index >= 0);
    return { terms, constant: 0 };
  }

  /** Symbolic form of the current through a component (first → second node). */
  currentForm(id: string, input?: string): SymForm {
    const sys = this.system;
    const c = sys.circuit.component(id);
    const node = (n: string) => sys.node(n);
    const diff = (a: string, b: string, y: MPoly): SymForm => ({
      terms: [
        { index: node(a), coeff: y },
        { index: node(b), coeff: y.neg() },
      ].filter((t) => t.index >= 0),
      constant: 0,
    });
    const branch = (k: number): SymForm => ({
      terms: [{ index: k, coeff: this.k(1) }],
      constant: 0,
    });
    switch (c.type) {
      case "resistor":
        return diff(c.nodes[0], c.nodes[1], this.conductance(c, c.value)());
      case "capacitor":
        return diff(c.nodes[0], c.nodes[1], this.s(this.param(c, c.id, c.value)()));
      case "isource":
        return { terms: [], constant: c.id === input ? 1 : 0 };
      case "vccs":
        return diff(c.control[0], c.control[1], this.param(c, c.id, c.gain)());
      case "cccs":
        return {
          terms: [{ index: sys.branch(c.controlSource), coeff: this.param(c, c.id, c.gain)() }],
          constant: 0,
        };
      case "coupling":
        throw new ElecMapError("INVALID_ARGUMENT", `"${id}" is a coupling and carries no current`, {
          componentId: id,
        });
      case "switch": {
        const r = c.closed ? c.ron : c.roff;
        if (r !== undefined) return diff(c.nodes[0], c.nodes[1], this.conductance(c, r)());
        return c.closed ? branch(sys.branch(c.id)) : { terms: [], constant: 0 };
      }
      default:
        return branch(sys.branch(c.id));
    }
  }

  // ---------------------------------------------------------------- algebra

  /** `det(A)`. */
  determinant(): MPoly {
    return determinant(this.matrix, this.nvars);
  }

  /**
   * `N` such that `y = N / det(A)` where `A·x = b` and `y = form(x)`:
   * `N = −det([[A, b], [f, 0]]) + constant·det(A)`.
   */
  numerator(b: readonly number[], form: SymForm, det: MPoly): MPoly {
    const n = this.system.size;
    const zero = MPoly.zero(this.nvars);
    const f = new Array<MPoly>(n).fill(zero);
    for (const t of form.terms) f[t.index] = (f[t.index] as MPoly).add(t.coeff);
    const aug = this.matrix.map((row, i) => [...row, MPoly.constant(this.nvars, b[i] ?? 0)]);
    aug.push([...f, zero]);
    let num = determinant(aug, this.nvars).neg();
    if (form.constant !== 0) num = num.add(det.scale(form.constant));
    return num;
  }

  /**
   * Replaces every hidden conductance `G = 1/R` by its resistance, multiplying
   * both polynomials by `R^e` where `e` is the highest power of `G`.
   */
  clearConductances(num: MPoly, den: MPoly): [MPoly, MPoly] {
    let [n, d] = [num, den];
    this.variables.forEach((v, g) => {
      if (v.inverseOf === undefined) return;
      const r = v.inverseOf;
      const e = Math.max(n.degreeIn(g), d.degreeIn(g));
      const f = (exps: readonly number[]) => {
        const out = [...exps];
        out[r] = (out[r] as number) + e - (out[g] as number);
        out[g] = 0;
        return out;
      };
      n = n.mapExponents(f);
      d = d.mapExponents(f);
    });
    return [n, d];
  }

  /** Numeric value of every variable (`s` excluded: 0). */
  values(): number[] {
    return this.variables.map((v) => v.symbol?.value ?? 0);
  }
}

function value(c: ComponentJSON | undefined): number {
  return c && "value" in c && typeof c.value === "number" ? c.value : 0;
}

/** Largest number of memoised minors before giving up. */
const MAX_STATES = 400_000;

/**
 * Determinant of a sparse polynomial matrix by Laplace expansion along rows
 * with memoisation on the set of used columns (exact, division-free). Rows are
 * processed sparsest first.
 */
export function determinant(matrix: readonly (readonly MPoly[])[], nvars: number): MPoly {
  const n = matrix.length;
  if (n === 0) return MPoly.constant(nvars, 1);
  if (n > 30) {
    throw new ElecMapError(
      "UNSUPPORTED",
      `Circuit too large for a symbolic analysis (${n} unknowns): keep fewer literal symbols or use the numeric transfer function`,
    );
  }
  const nz = matrix.map((row) => row.flatMap((p, j) => (p.isZero() ? [] : [j])));
  const order = nz
    .map((_, i) => i)
    .sort((a, b) => (nz[a] as number[]).length - (nz[b] as number[]).length);
  // Sign of the row permutation.
  let sign = 1;
  const perm = [...order];
  for (let i = 0; i < n; i++) {
    while (perm[i] !== i) {
      const j = perm[i] as number;
      [perm[i], perm[j]] = [perm[j] as number, perm[i] as number];
      sign = -sign;
    }
  }
  const memo = new Map<number, MPoly>();
  const full = n === 31 ? 0x7fffffff : (1 << n) - 1;
  const rec = (depth: number, used: number): MPoly => {
    if (depth === n) return MPoly.constant(nvars, 1);
    const cached = memo.get(used);
    if (cached) return cached;
    const row = order[depth] as number;
    let acc = MPoly.zero(nvars);
    for (const j of nz[row] as number[]) {
      if (used & (1 << j)) continue;
      const minor = rec(depth + 1, used | (1 << j));
      if (minor.isZero()) continue;
      // Sign: parity of the free columns before j.
      const before = popcount(~used & full & ((1 << j) - 1));
      const term = ((matrix[row] as MPoly[])[j] as MPoly).mul(minor);
      acc = before % 2 === 0 ? acc.add(term) : acc.sub(term);
    }
    memo.set(used, acc);
    if (memo.size > MAX_STATES) {
      throw new ElecMapError(
        "UNSUPPORTED",
        "Symbolic determinant too large: keep fewer literal symbols (option `symbols`)",
      );
    }
    return acc;
  };
  const det = rec(0, 0);
  return sign === 1 ? det : det.neg();
}

function popcount(x: number): number {
  let v = x >>> 0;
  let c = 0;
  while (v) {
    v &= v - 1;
    c++;
  }
  return c;
}

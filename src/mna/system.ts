import type { CompiledCircuit } from "../core/circuit";
import { ElecMapError } from "../core/errors";
import type { ComponentJSON, NodeName } from "../format/types";
import { Complex } from "../math/complex";
import { Polynomial } from "../math/polynomial";
import { modelOf } from "./models";
import type { FormContext, LinearForm, StampContext } from "./models";

/** Value assigned to each independent source for a given analysis. */
export type SourceValues = (component: ComponentJSON) => number | Complex;

/**
 * Modified Nodal Analysis system `(G + s·C)·x = b` of a compiled circuit.
 *
 * Unknowns `x` are the non-ground node voltages (in {@link CompiledCircuit.nodes}
 * order) followed by the branch currents of the components that need one
 * (voltage sources, inductors, controlled voltage sources, op-amps, ideal switches).
 *
 * The same matrices serve every analysis: `s = 0` (DC), `s = jω` (AC), a
 * polynomial matrix in `s` (transfer functions), and companion models (transient).
 */
export class MnaSystem {
  /** Circuit this system was built from. */
  readonly circuit: CompiledCircuit;
  /** Total number of unknowns. */
  readonly size: number;
  /** Number of node-voltage unknowns. */
  readonly nodeCount: number;
  /** Static (conductance) matrix. */
  readonly G: readonly (readonly number[])[];
  /** Dynamic matrix (coefficients of `s`). */
  readonly C: readonly (readonly number[])[];
  /** Human-readable name of each unknown: `V(node)` or `I(component)`. */
  readonly unknowns: readonly string[];

  private readonly branches: ReadonlyMap<string, number>;

  constructor(circuit: CompiledCircuit) {
    this.circuit = circuit;
    this.nodeCount = circuit.nodeCount;
    const branches = new Map<string, number>();
    const unknowns = circuit.nodes.map((n) => `V(${n})`);
    for (const c of circuit.components) {
      if (modelOf(c).branches(c) > 0) {
        branches.set(c.id, unknowns.length);
        unknowns.push(`I(${c.id})`);
      }
    }
    this.branches = branches;
    this.unknowns = unknowns;
    this.size = unknowns.length;

    const G = Array.from({ length: this.size }, () => new Array<number>(this.size).fill(0));
    const C = Array.from({ length: this.size }, () => new Array<number>(this.size).fill(0));
    const add = (m: number[][]) => (row: number, col: number, value: number) => {
      if (row < 0 || col < 0) return;
      (m[row] as number[])[col] = ((m[row] as number[])[col] as number) + value;
    };
    const ctx: StampContext = {
      node: (n) => this.node(n),
      branch: (id) => this.branch(id),
      addG: add(G),
      addC: add(C),
      component: (id) => circuit.component(id),
    };
    for (const c of circuit.components) modelOf(c).stamp(c, ctx);
    this.G = G;
    this.C = C;
  }

  /** Unknown index of a node, `-1` for ground. */
  node(name: NodeName): number {
    return this.circuit.nodeIndex(name);
  }

  /** True if the component has a branch-current unknown. */
  hasBranch(id: string): boolean {
    return this.branches.has(id);
  }

  /**
   * Unknown index of a component's branch current.
   * @throws {@link ElecMapError} `NOT_FOUND`
   */
  branch(id: string): number {
    const k = this.branches.get(id);
    if (k === undefined) {
      throw new ElecMapError("NOT_FOUND", `Component "${id}" has no branch current`, {
        componentId: id,
      });
    }
    return k;
  }

  /** Complex matrix `G + s·C`. */
  matrixAt(s: Complex): Complex[][] {
    return this.G.map((row, i) =>
      row.map((g, j) => {
        const c = (this.C[i] as readonly number[])[j] as number;
        return c === 0 ? new Complex(g) : new Complex(g + s.re * c, s.im * c);
      }),
    );
  }

  /** Real matrix `G + gmin` (with an optional conductance from every node to ground). */
  dcMatrix(gmin = 0): number[][] {
    return this.G.map((row, i) =>
      row.map((g, j) => (i === j && i < this.nodeCount ? g + gmin : g)),
    );
  }

  /** Polynomial matrix `G + s·C`. */
  polynomialMatrix(): Polynomial[][] {
    return this.G.map((row, i) =>
      row.map((g, j) => new Polynomial([g, (this.C[i] as readonly number[])[j] as number])),
    );
  }

  /** Right-hand side `b` for the given independent-source values. */
  rhs(values: SourceValues): Complex[] {
    const b = new Array<Complex>(this.size).fill(Complex.ZERO);
    const ctx = this.stampContext();
    for (const c of this.circuit.components) {
      const model = modelOf(c);
      if (!model.source) continue;
      const v = Complex.from(values(c));
      if (v.isZero()) continue;
      for (const { index, factor } of model.source(c, ctx).entries) {
        b[index] = (b[index] as Complex).add(v.mul(factor));
      }
    }
    return b;
  }

  /** Linear form of the voltage `V(a) − V(b)`. */
  voltageForm(a: NodeName, b: NodeName = this.circuit.ground): LinearForm {
    const terms = [
      { index: this.node(a), g: 1, c: 0 },
      { index: this.node(b), g: -1, c: 0 },
    ].filter((t) => t.index >= 0);
    return { terms, sources: [] };
  }

  /** Linear form of the current through a component (first node → second node). */
  currentForm(id: string): LinearForm {
    const c = this.circuit.component(id);
    if (c.type === "coupling") {
      throw new ElecMapError("INVALID_ARGUMENT", `"${id}" is a coupling and carries no current`, {
        componentId: id,
      });
    }
    const ctx: FormContext = {
      node: (n) => this.node(n),
      branch: (k) => this.branch(k),
      component: (k) => this.circuit.component(k),
    };
    return modelOf(c).current(c, ctx);
  }

  /** Evaluates a linear form for a solution `x` at complex frequency `s`. */
  evaluate(form: LinearForm, x: readonly Complex[], s: Complex, values: SourceValues): Complex {
    let acc = Complex.ZERO;
    for (const t of form.terms) {
      const coeff = new Complex(t.g + s.re * t.c, s.im * t.c);
      acc = acc.add(coeff.mul(x[t.index] as Complex));
    }
    for (const { id, factor } of form.sources) {
      acc = acc.add(Complex.from(values(this.circuit.component(id))).mul(factor));
    }
    return acc;
  }

  private stampContext(): StampContext {
    return {
      node: (n) => this.node(n),
      branch: (id) => this.branch(id),
      addG: () => undefined,
      addC: () => undefined,
      component: (id) => this.circuit.component(id),
    };
  }
}

/** DC value of an independent source (`dc`, default 0). */
export const dcValues: SourceValues = (c) =>
  c.type === "vsource" || c.type === "isource" ? (c.dc ?? 0) : 0;

/** AC phasor of an independent source (`ac.mag ∠ ac.phase`, default 0). */
export const acValues: SourceValues = (c) =>
  (c.type === "vsource" || c.type === "isource") && c.ac
    ? Complex.fromPolar(c.ac.mag, ((c.ac.phase ?? 0) * Math.PI) / 180)
    : 0;

/** Excites a single source with the given phasor, all others at zero. */
export const singleSource =
  (id: string, value: number | Complex = 1): SourceValues =>
  (c) =>
    c.id === id ? value : 0;

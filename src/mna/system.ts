import type { CompiledCircuit } from "../core/circuit";
import { ElecMapError } from "../core/errors";
import type { ComponentJSON, NodeName } from "../format/types";
import { Complex } from "../math/complex";
import { Polynomial } from "../math/polynomial";
import type { ProbeForm } from "./behavioral";
import { modelOf } from "./models";
import type {
  FormContext,
  Junction,
  LinearForm,
  LoadContext,
  StampContext,
  Terminal,
} from "./models";

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
 *
 * Non-linear devices (diodes…) leave their equation rows empty in `G`: DC and
 * transient analyses fill them at each Newton iteration, and small-signal
 * analyses use {@link MnaSystem.smallSignal}, linearised around an operating point.
 * Their junction charges are non-linear too: `C` only holds their capacitances
 * in a small-signal system, and transient analysis integrates the charges
 * themselves ({@link MnaSystem.charges}).
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

  /** Non-linear components, linearised by Newton-Raphson. */
  readonly nonlinear: readonly ComponentJSON[];
  /** Operating point this system is linearised around (small-signal systems only). */
  readonly bias: readonly number[] | undefined;

  private readonly branches: ReadonlyMap<string, number>;
  /** Junction charges of the non-linear devices, with the id of their device. */
  private readonly junctions: readonly (Junction & { id: string })[];

  /**
   * @param bias operating point (MNA unknowns) around which the non-linear devices
   *   are linearised; prefer {@link MnaSystem.smallSignal}.
   */
  constructor(circuit: CompiledCircuit, bias?: readonly number[]) {
    this.circuit = circuit;
    this.nodeCount = circuit.nodeCount;
    const branches = new Map<string, number>();
    const unknowns = circuit.nodes.map((n) => `V(${n})`);
    for (const c of circuit.components) {
      const model = modelOf(c);
      const count = model.branches(c);
      if (count === 0) continue;
      branches.set(c.id, unknowns.length);
      unknowns.push(`I(${c.id})`);
      for (let i = 1; i < count; i++)
        unknowns.push(`I(${c.id}${model.branchSuffixes?.[i - 1] ?? `#${i}`})`);
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
    this.nonlinear = circuit.components.filter((c) => modelOf(c).load !== undefined);
    this.junctions = this.nonlinear.flatMap((c) =>
      (modelOf(c).junctions?.(c, ctx) ?? []).map((j) => ({ ...j, id: c.id })),
    );
    this.bias = bias;
    if (bias) {
      if (bias.length !== this.size) {
        throw new ElecMapError(
          "DIMENSION_MISMATCH",
          `Bias has ${bias.length} values, expected ${this.size}`,
        );
      }
      this.load(G, new Array<number>(this.size).fill(0), bias, undefined, 1e-12);
      // Junction capacitances at the operating point.
      for (const j of this.junctions) {
        const { c } = j.charge(junctionVoltage(j, bias));
        for (const { row, sign } of j.rows) {
          for (const { index, coef } of j.voltage) add(C)(row, index, sign * c * coef);
        }
      }
    }
    this.G = G;
    this.C = C;
  }

  /** True if `G` and `C` fully describe the circuit (no device or already linearised). */
  get linear(): boolean {
    return this.nonlinear.length === 0 || this.bias !== undefined;
  }

  /**
   * Small-signal system: the non-linear devices replaced by their linearisation
   * (conductances, transconductances) at the operating point `x`. Returns `this`
   * for a linear circuit.
   */
  smallSignal(x: readonly number[]): MnaSystem {
    return this.nonlinear.length === 0 ? this : new MnaSystem(this.circuit, x);
  }

  /**
   * Adds the Newton linearisation of every non-linear device at `x` to `matrix`
   * and `rhs` (in place). Returns true if a device limited its voltage step.
   * `states` (one record per device id) enables step limiting.
   *
   * With `charge = a`, the junction charges are added as `a·Q(x)` (the
   * companion term of an integration step `a·(q − q_prev)`), linearised too.
   */
  load(
    matrix: number[][],
    rhs: number[],
    x: readonly number[],
    states: Map<string, Record<string, number>> | undefined,
    gmin: number,
    initial = false,
    charge?: number,
    time = 0,
  ): boolean {
    let limited = false;
    for (const c of this.nonlinear) {
      let state: Record<string, number> | undefined;
      if (states) {
        state = states.get(c.id);
        if (!state) states.set(c.id, (state = {}));
      }
      const ctx: LoadContext = {
        node: (n) => this.node(n),
        branch: (id) => this.branch(id),
        x,
        addJ: (row, col, value) => {
          if (row >= 0 && col >= 0)
            (matrix[row] as number[])[col] = ((matrix[row] as number[])[col] as number) + value;
        },
        addB: (row, value) => {
          if (row >= 0) rhs[row] = (rhs[row] as number) + value;
        },
        state,
        initial,
        limited: () => (limited = true),
        gmin,
        time,
        current: (id) => this.currentProbe(id),
      };
      modelOf(c).load?.(c, ctx);
    }
    if (charge !== undefined) {
      for (const j of this.junctions) {
        // The voltage the device was linearised at (limited), else the iterate's.
        const v = states?.get(j.id)?.[j.key] ?? junctionVoltage(j, x);
        const { q, c } = j.charge(v);
        for (const { row, sign } of j.rows) {
          if (row < 0) continue;
          for (const { index, coef } of j.voltage) {
            if (index >= 0) {
              const r = matrix[row] as number[];
              r[index] = (r[index] as number) + charge * sign * c * coef;
            }
          }
          rhs[row] = (rhs[row] as number) - charge * sign * (q - c * v);
        }
      }
    }
    return limited;
  }

  /**
   * Current of a component as a combination of unknowns, for the `I()` of a
   * behavioural expression.
   * @throws {@link ElecMapError} `UNSUPPORTED` if it depends on `s` or on a source value
   */
  private currentProbe(id: string): ProbeForm {
    const comp = this.circuit.component(id);
    const f = modelOf(comp).current(comp, {
      node: (n) => this.node(n),
      branch: (b) => this.branch(b),
      component: (b) => this.circuit.component(b),
    });
    if (f.sources.length > 0 || f.terms.some((t) => t.c !== 0)) {
      throw new ElecMapError(
        "UNSUPPORTED",
        `The current of ${id} (${comp.type}) cannot be used in a behavioural expression`,
        { componentId: id },
      );
    }
    return f.terms.filter((t) => t.g !== 0).map((t) => ({ index: t.index, coef: t.g }));
  }

  /** True if some device stores a junction charge (bias-dependent capacitance). */
  get hasCharges(): boolean {
    return this.junctions.length > 0;
  }

  /**
   * Junction charges at `x`, as a vector over the MNA rows (`sign·Q` in each
   * row a junction enters). Transient analysis adds it to `C·x`.
   */
  charges(x: readonly number[]): number[] {
    const out = new Array<number>(this.size).fill(0);
    for (const j of this.junctions) {
      const { q } = j.charge(junctionVoltage(j, x));
      for (const { row, sign } of j.rows) if (row >= 0) out[row] = (out[row] as number) + sign * q;
    }
    return out;
  }

  private requireLinear(): void {
    if (!this.linear) {
      throw new ElecMapError(
        "UNSUPPORTED",
        `Non-linear circuit (${this.nonlinear.map((c) => c.id).join(", ")}): linearise it first with system.smallSignal(operatingPoint.x)`,
      );
    }
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
    this.requireLinear();
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
    this.requireLinear();
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

  /**
   * Linear form of the current through a component (first node → second node).
   * For a transistor, `"Q1"` is the collector (drain) current and `"Q1:b"` /
   * `"Q1:base"` the current flowing into one terminal.
   */
  currentForm(id: string): LinearForm {
    const sep = id.lastIndexOf(":");
    if (sep > 0 && !this.circuit.hasComponent(id) && this.circuit.hasComponent(id.slice(0, sep))) {
      return this.terminalForm(id.slice(0, sep), id.slice(sep + 1));
    }
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

  /**
   * Terminals of a multi-terminal device (transistor), with the current flowing
   * into each one; `undefined` for other components.
   */
  terminals(id: string): Terminal[] | undefined {
    const c = this.circuit.component(id);
    return modelOf(c).terminals?.(c, this.formContext());
  }

  /**
   * Power terms of a component: absorbed power `Σ v·i` with each `v` a voltage form
   * and each `i` the current form it multiplies.
   */
  powerTerms(id: string): { v: LinearForm; i: LinearForm }[] {
    const c = this.circuit.component(id);
    if (c.type === "coupling") return [];
    const terminals = this.terminals(id);
    if (terminals) return terminals.map((t) => ({ v: this.voltageForm(t.node), i: t.form }));
    if (c.type === "opamp") return [{ v: this.voltageForm(c.nodes[2]), i: this.currentForm(id) }];
    return [{ v: this.voltageForm(c.nodes[0], c.nodes[1]), i: this.currentForm(id) }];
  }

  private terminalForm(id: string, name: string): LinearForm {
    const terminals = this.terminals(id);
    if (!terminals) {
      throw new ElecMapError(
        "INVALID_ARGUMENT",
        `"${id}" has no terminal currents ("${id}:${name}"): use current("${id}")`,
        { componentId: id },
      );
    }
    const key = name.toLowerCase();
    const t = terminals.find((x) => x.name === key || x.alias === key);
    if (!t) {
      throw new ElecMapError(
        "INVALID_ARGUMENT",
        `"${id}" has no terminal "${name}" (expected ${terminals.map((x) => x.name).join(", ")})`,
        { componentId: id },
      );
    }
    return t.form;
  }

  private formContext(): FormContext {
    return {
      node: (n) => this.node(n),
      branch: (k) => this.branch(k),
      component: (k) => this.circuit.component(k),
    };
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

/** Controlling voltage of a junction at `x`. */
function junctionVoltage(j: Junction, x: readonly number[]): number {
  let v = 0;
  for (const { index, coef } of j.voltage) if (index >= 0) v += coef * (x[index] as number);
  return v;
}

import type { ComponentJSON, ComponentType, NodeName } from "../format/types";
import { diodeCurrent, diodeParams, limitDiode } from "./devices";

/**
 * One term `(g + s·c) · x[index]` of a {@link LinearForm}.
 */
export interface LinearTerm {
  index: number;
  /** Coefficient of the static (resistive) part. */
  g: number;
  /** Coefficient of the `s` (derivative) part. */
  c: number;
}

/**
 * Linear functional of the MNA unknowns, used to express any circuit quantity
 * (node voltage difference, branch current) in every analysis:
 *
 * `value(s) = Σ (gᵢ + s·cᵢ)·x[indexᵢ] + Σ factorⱼ · u(sourceⱼ)`
 *
 * where `u(source)` is the value of an independent source (only used by
 * current sources, whose current is their own value).
 */
export interface LinearForm {
  terms: LinearTerm[];
  sources: { id: string; factor: number }[];
}

/** Interface given to component models to write their contribution into the MNA matrices. */
export interface StampContext {
  /** Unknown index of a node (`-1` for ground). */
  node(name: NodeName): number;
  /** Unknown index of the branch current of a component. */
  branch(id: string): number;
  /** Adds `value` to `G[row][col]` (ignored if row or col is ground). */
  addG(row: number, col: number, value: number): void;
  /** Adds `value` to `C[row][col]`, the coefficient of `s`. */
  addC(row: number, col: number, value: number): void;
  /** Looks up another component (e.g. the inductors of a coupling). */
  component(id: string): ComponentJSON;
}

/** Context used to build linear forms for component currents. */
export interface FormContext {
  node(name: NodeName): number;
  branch(id: string): number;
  /** Looks up another component (e.g. the controlling source of a CCCS). */
  component(id: string): ComponentJSON;
}

/** Where an independent source writes its value in the right-hand side. */
export interface SourceIncidence {
  /** `b[index] += factor · value` */
  entries: { index: number; factor: number }[];
}

/**
 * Interface given to non-linear models to write their linearisation at the
 * current Newton iterate: `J·x = b` rows replacing the device equations.
 */
export interface LoadContext {
  node(name: NodeName): number;
  branch(id: string): number;
  /** Current iterate (MNA unknown vector). */
  readonly x: readonly number[];
  /** Adds `value` to the Jacobian entry `[row][col]` (ignored for ground). */
  addJ(row: number, col: number, value: number): void;
  /** Adds `value` to the right-hand side `b[row]`. */
  addB(row: number, value: number): void;
  /**
   * Memory of this device across iterations (previous junction voltages), or
   * `undefined` when no limiting is wanted (small-signal linearisation).
   */
  readonly state: Record<string, number> | undefined;
  /**
   * First iteration of a solve started from scratch: junctions start at their
   * default guess instead of the (meaningless) voltages of `x`.
   */
  readonly initial: boolean;
  /** Tells the solver that a voltage was limited: the iterate cannot be accepted yet. */
  limited(): void;
  /** Conductance placed across every junction (S). */
  readonly gmin: number;
}

/**
 * MNA model of a component type: how many extra unknowns (branch currents) it
 * needs, how it stamps `G` and `C` (the system is `(G + s·C)·x = b`), how its
 * current is expressed, and — for independent sources — where its value goes
 * in `b`.
 */
export interface ComponentModel<T extends ComponentJSON = ComponentJSON> {
  /** Number of branch-current unknowns (0 or 1). */
  branches(c: T): number;
  stamp(c: T, ctx: StampContext): void;
  /** Current through the component, from its first node to its second node. */
  current(c: T, ctx: FormContext): LinearForm;
  /** Right-hand-side incidence of an independent source. */
  source?(c: T, ctx: StampContext): SourceIncidence;
  /**
   * Non-linear devices only: stamps the Newton linearisation of the device at
   * `ctx.x`. The device equations live in its own branch rows, which
   * {@link ComponentModel.stamp} leaves empty.
   */
  load?(c: T, ctx: LoadContext): void;
}

const term = (index: number, g: number, c = 0): LinearTerm => ({ index, g, c });
const form = (terms: LinearTerm[], sources: LinearForm["sources"] = []): LinearForm => ({
  terms: terms.filter((t) => t.index >= 0),
  sources,
});

/** Stamps a conductance between two nodes. */
function stampAdmittance(ctx: StampContext, a: number, b: number, g: number, c: number): void {
  if (g !== 0) {
    ctx.addG(a, a, g);
    ctx.addG(b, b, g);
    ctx.addG(a, b, -g);
    ctx.addG(b, a, -g);
  }
  if (c !== 0) {
    ctx.addC(a, a, c);
    ctx.addC(b, b, c);
    ctx.addC(a, b, -c);
    ctx.addC(b, a, -c);
  }
}

/** KCL incidence of a branch current flowing from `a` to `b` through the element. */
function stampBranchIncidence(ctx: StampContext, k: number, a: number, b: number): void {
  ctx.addG(a, k, 1);
  ctx.addG(b, k, -1);
}

/** Branch current form `x[k]`. */
const branchForm = (k: number): LinearForm => form([term(k, 1)]);

/** Admittance current form `(g + s·c)·(Va − Vb)`. */
const admittanceForm = (a: number, b: number, g: number, c: number): LinearForm =>
  form([term(a, g, c), term(b, -g, -c)]);

export type ModelMap = {
  [K in ComponentType]: ComponentModel<Extract<ComponentJSON, { type: K }>>;
};

/** Switch behaviour: ideal short (needs a branch), resistor, or open. */
function switchMode(c: Extract<ComponentJSON, { type: "switch" }>): "short" | "resistor" | "open" {
  if (c.closed) return c.ron ? "resistor" : "short";
  return c.roff ? "resistor" : "open";
}

/** Built-in MNA models of every component type. */
export const MODELS: ModelMap = {
  resistor: {
    branches: () => 0,
    stamp(c, ctx) {
      stampAdmittance(ctx, ctx.node(c.nodes[0]), ctx.node(c.nodes[1]), 1 / c.value, 0);
    },
    current: (c, ctx) => admittanceForm(ctx.node(c.nodes[0]), ctx.node(c.nodes[1]), 1 / c.value, 0),
  },

  capacitor: {
    branches: () => 0,
    stamp(c, ctx) {
      stampAdmittance(ctx, ctx.node(c.nodes[0]), ctx.node(c.nodes[1]), 0, c.value);
    },
    current: (c, ctx) => admittanceForm(ctx.node(c.nodes[0]), ctx.node(c.nodes[1]), 0, c.value),
  },

  inductor: {
    // Va − Vb − s·L·I = 0
    branches: () => 1,
    stamp(c, ctx) {
      const [a, b, k] = [ctx.node(c.nodes[0]), ctx.node(c.nodes[1]), ctx.branch(c.id)];
      stampBranchIncidence(ctx, k, a, b);
      ctx.addG(k, a, 1);
      ctx.addG(k, b, -1);
      ctx.addC(k, k, -c.value);
    },
    current: (c, ctx) => branchForm(ctx.branch(c.id)),
  },

  coupling: {
    // Mutual inductance M = k·√(L₁·L₂): adds −s·M·I₂ to the branch equation of L₁ and vice versa.
    branches: () => 0,
    stamp(c, ctx) {
      const [l1, l2] = c.inductors.map((id) => ctx.component(id)) as [ComponentJSON, ComponentJSON];
      if (l1.type !== "inductor" || l2.type !== "inductor") return;
      const m = c.k * Math.sqrt(l1.value * l2.value);
      const [k1, k2] = [ctx.branch(l1.id), ctx.branch(l2.id)];
      ctx.addC(k1, k2, -m);
      ctx.addC(k2, k1, -m);
    },
    current: () => form([]),
  },

  vsource: {
    // Vp − Vn = E
    branches: () => 1,
    stamp(c, ctx) {
      const [p, n, k] = [ctx.node(c.nodes[0]), ctx.node(c.nodes[1]), ctx.branch(c.id)];
      stampBranchIncidence(ctx, k, p, n);
      ctx.addG(k, p, 1);
      ctx.addG(k, n, -1);
    },
    current: (c, ctx) => branchForm(ctx.branch(c.id)),
    source: (c, ctx) => ({ entries: [{ index: ctx.branch(c.id), factor: 1 }] }),
  },

  isource: {
    // Current flows p → n through the source: drawn from p, injected into n.
    branches: () => 0,
    stamp: () => undefined,
    current: (c) => form([], [{ id: c.id, factor: 1 }]),
    source: (c, ctx) => ({
      entries: [
        { index: ctx.node(c.nodes[0]), factor: -1 },
        { index: ctx.node(c.nodes[1]), factor: 1 },
      ].filter((e) => e.index >= 0),
    }),
  },

  vcvs: {
    // Vp − Vn − A·(Vcp − Vcn) = 0
    branches: () => 1,
    stamp(c, ctx) {
      const [p, n, k] = [ctx.node(c.nodes[0]), ctx.node(c.nodes[1]), ctx.branch(c.id)];
      const [cp, cn] = [ctx.node(c.control[0]), ctx.node(c.control[1])];
      stampBranchIncidence(ctx, k, p, n);
      ctx.addG(k, p, 1);
      ctx.addG(k, n, -1);
      ctx.addG(k, cp, -c.gain);
      ctx.addG(k, cn, c.gain);
    },
    current: (c, ctx) => branchForm(ctx.branch(c.id)),
  },

  vccs: {
    // I(p→n) = gm·(Vcp − Vcn)
    branches: () => 0,
    stamp(c, ctx) {
      const [p, n] = [ctx.node(c.nodes[0]), ctx.node(c.nodes[1])];
      const [cp, cn] = [ctx.node(c.control[0]), ctx.node(c.control[1])];
      ctx.addG(p, cp, c.gain);
      ctx.addG(p, cn, -c.gain);
      ctx.addG(n, cp, -c.gain);
      ctx.addG(n, cn, c.gain);
    },
    current: (c, ctx) =>
      form([term(ctx.node(c.control[0]), c.gain), term(ctx.node(c.control[1]), -c.gain)]),
  },

  cccs: {
    // I(p→n) = β·I(Vctrl)
    branches: () => 0,
    stamp(c, ctx) {
      const [p, n, kc] = [ctx.node(c.nodes[0]), ctx.node(c.nodes[1]), ctx.branch(c.controlSource)];
      ctx.addG(p, kc, c.gain);
      ctx.addG(n, kc, -c.gain);
    },
    current: (c, ctx) => form([term(ctx.branch(c.controlSource), c.gain)]),
  },

  ccvs: {
    // Vp − Vn − r·I(Vctrl) = 0
    branches: () => 1,
    stamp(c, ctx) {
      const [p, n, k] = [ctx.node(c.nodes[0]), ctx.node(c.nodes[1]), ctx.branch(c.id)];
      stampBranchIncidence(ctx, k, p, n);
      ctx.addG(k, p, 1);
      ctx.addG(k, n, -1);
      ctx.addG(k, ctx.branch(c.controlSource), -c.gain);
    },
    current: (c, ctx) => branchForm(ctx.branch(c.id)),
  },

  opamp: {
    // Output branch current I flows from `out` into the op-amp (towards ground).
    // Ideal:       V+ − V− = 0
    // Finite gain: Vout·(1 + s/ωp) − A·(V+ − V−) = 0, ωp = 2π·GBW / A
    branches: () => 1,
    stamp(c, ctx) {
      const [ip, im, out] = c.nodes.map((n) => ctx.node(n)) as [number, number, number];
      const k = ctx.branch(c.id);
      ctx.addG(out, k, 1);
      if (c.gain === undefined) {
        ctx.addG(k, ip, 1);
        ctx.addG(k, im, -1);
      } else {
        ctx.addG(k, out, 1);
        ctx.addG(k, ip, -c.gain);
        ctx.addG(k, im, c.gain);
        if (c.gbw !== undefined) ctx.addC(k, out, c.gain / (2 * Math.PI * c.gbw));
      }
    },
    current: (c, ctx) => branchForm(ctx.branch(c.id)),
  },

  switch: {
    branches: (c) => (switchMode(c) === "short" ? 1 : 0),
    stamp(c, ctx) {
      const [a, b] = [ctx.node(c.nodes[0]), ctx.node(c.nodes[1])];
      const mode = switchMode(c);
      if (mode === "short") {
        const k = ctx.branch(c.id);
        stampBranchIncidence(ctx, k, a, b);
        ctx.addG(k, a, 1);
        ctx.addG(k, b, -1);
      } else if (mode === "resistor") {
        stampAdmittance(ctx, a, b, 1 / ((c.closed ? c.ron : c.roff) as number), 0);
      }
    },
    current(c, ctx) {
      const mode = switchMode(c);
      if (mode === "short") return branchForm(ctx.branch(c.id));
      if (mode === "open") return form([]);
      const r = (c.closed ? c.ron : c.roff) as number;
      return admittanceForm(ctx.node(c.nodes[0]), ctx.node(c.nodes[1]), 1 / r, 0);
    },
  },

  diode: {
    // Branch current I (anode → cathode), equation I = Id(Va − Vk − rs·I), linearised
    // around Vj₀: (1 + gd·rs)·I − gd·Va + gd·Vk = Id(Vj₀) − gd·Vj₀.
    branches: () => 1,
    stamp(c, ctx) {
      const [a, k, b] = [ctx.node(c.nodes[0]), ctx.node(c.nodes[1]), ctx.branch(c.id)];
      stampBranchIncidence(ctx, b, a, k);
      if (c.cjo) stampAdmittance(ctx, a, k, 0, c.cjo);
    },
    current(c, ctx) {
      const [a, k, b] = [ctx.node(c.nodes[0]), ctx.node(c.nodes[1]), ctx.branch(c.id)];
      const cj = c.cjo ?? 0;
      return form(cj ? [term(b, 1), term(a, 0, cj), term(k, 0, -cj)] : [term(b, 1)]);
    },
    load(c, ctx) {
      const p = diodeParams(c);
      const [a, k, b] = [ctx.node(c.nodes[0]), ctx.node(c.nodes[1]), ctx.branch(c.id)];
      const at = (i: number) => (i < 0 ? 0 : (ctx.x[i] as number));
      let vj = at(a) - at(k) - p.rs * at(b);
      if (ctx.state) {
        const old = ctx.state["vj"];
        if (ctx.initial) vj = p.vcrit;
        else if (old !== undefined) {
          const r = limitDiode(vj, old, p);
          if (r.limited) ctx.limited();
          vj = r.v;
        }
        ctx.state["vj"] = vj;
      }
      const d = diodeCurrent(vj, p);
      const g = d.g + ctx.gmin;
      const i = d.i + ctx.gmin * vj;
      ctx.addJ(b, b, 1 + g * p.rs);
      ctx.addJ(b, a, -g);
      ctx.addJ(b, k, g);
      ctx.addB(b, i - g * vj);
    },
  },
};

/** Returns the built-in model of a component. */
export function modelOf(c: ComponentJSON): ComponentModel {
  return MODELS[c.type] as ComponentModel;
}

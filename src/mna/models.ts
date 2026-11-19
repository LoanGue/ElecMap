import type { ComponentJSON, ComponentType, NodeName } from "../format/types";
import {
  bjtCharges,
  bjtCurrents,
  bjtParams,
  type Charge,
  diodeCharge,
  diodeCurrent,
  diodeParams,
  limitDiode,
  limitDrain,
  limitGate,
  limitJunction,
  mosfetCurrent,
  mosfetParams,
  mosfetThreshold,
} from "./devices";

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
 * Charge stored in a junction of a non-linear device. Its current `dQ/dt`
 * enters the device's own branch rows, so that the branch unknowns are the
 * total terminal currents.
 */
export interface Junction {
  /** Controlling voltage `v = Σ coef·x[index]` (ground indices are ignored). */
  voltage: { index: number; coef: number }[];
  /** Key of the device state holding the (limited) voltage during Newton iterations. */
  key: string;
  /** Branch rows the charge enters: the row equation contains `sign·dQ/dt`. */
  rows: { row: number; sign: number }[];
  /** Charge and capacitance at the voltage `v`. */
  charge(v: number): Charge;
}

/** One terminal of a multi-terminal device, with the current flowing into it. */
export interface Terminal {
  /** Short name used in `"Q1:b"` (`c`, `b`, `e`, `d`, `g`, `s`…). */
  name: string;
  /** Long name, also accepted (`collector`, `base`…). */
  alias: string;
  /** Node the terminal is connected to. */
  node: NodeName;
  /** Current flowing into the device through this terminal. */
  form: LinearForm;
}

/**
 * MNA model of a component type: how many extra unknowns (branch currents) it
 * needs, how it stamps `G` and `C` (the system is `(G + s·C)·x = b`), how its
 * current is expressed, and — for independent sources — where its value goes
 * in `b`.
 */
export interface ComponentModel<T extends ComponentJSON = ComponentJSON> {
  /**
   * Number of branch-current unknowns. They are contiguous: `ctx.branch(id)` is
   * the first one, `ctx.branch(id) + 1` the next…
   */
  branches(c: T): number;
  /** Names of the extra branch unknowns (after the first), e.g. `[":b"]` → `I(Q1:b)`. */
  branchSuffixes?: readonly string[];
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
  /** Multi-terminal devices: the current into each terminal (they sum to zero). */
  terminals?(c: T, ctx: FormContext): Terminal[];
  /** Non-linear devices with stored charge: their junctions (empty or absent without one). */
  junctions?(c: T, ctx: FormContext): Junction[];
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

/**
 * Stamps one linearised device row `I = sign·F(u)`, where each controlling
 * voltage is `uⱼ = sign·(V(aⱼ) − V(bⱼ))` and `gⱼ = ∂F/∂uⱼ` at the point `uⱼ`:
 * `I − Σ gⱼ·(V(aⱼ) − V(bⱼ)) = sign·(F − Σ gⱼ·uⱼ)`.
 */
function stampDeviceRow(
  ctx: LoadContext,
  row: number,
  sign: number,
  f: number,
  parts: { a: number; b: number; g: number; u: number }[],
): void {
  ctx.addJ(row, row, 1);
  let rhs = f;
  for (const { a, b, g, u } of parts) {
    ctx.addJ(row, a, -g);
    ctx.addJ(row, b, g);
    rhs -= g * u;
  }
  ctx.addB(row, sign * rhs);
}

/** Value of unknown `i` in the iterate (0 for ground). */
const valueAt = (ctx: LoadContext, i: number): number => (i < 0 ? 0 : (ctx.x[i] as number));

type BjtModel = ComponentModel<Extract<ComponentJSON, { type: "bjt" }>>;
type MosfetModel = ComponentModel<Extract<ComponentJSON, { type: "mosfet" }>>;

const bjtTerminals: BjtModel["terminals"] = (c, ctx) => {
  const k = ctx.branch(c.id);
  return [
    { name: "c", alias: "collector", node: c.nodes[0], form: form([term(k, 1)]) },
    { name: "b", alias: "base", node: c.nodes[1], form: form([term(k + 1, 1)]) },
    { name: "e", alias: "emitter", node: c.nodes[2], form: form([term(k, -1), term(k + 1, -1)]) },
  ];
};

const bjtModel: BjtModel = {
  // Two branch unknowns: the collector current Ic (collector → emitter) and the
  // base current Ib (base → emitter), junction charges included; the emitter
  // carries −(Ic + Ib).
  branches: () => 2,
  branchSuffixes: [":b"],
  stamp(c, ctx) {
    const [nc, nb, ne] = c.nodes.map((n) => ctx.node(n)) as [number, number, number];
    const k = ctx.branch(c.id);
    stampBranchIncidence(ctx, k, nc, ne);
    stampBranchIncidence(ctx, k + 1, nb, ne);
  },
  current(c, ctx) {
    return (bjtTerminals(c, ctx) as [Terminal])[0].form;
  },
  terminals: bjtTerminals,
  junctions(c, ctx) {
    const p = bjtParams(c);
    if (p.cje === 0 && p.cjc === 0 && p.tf === 0 && p.tr === 0) return [];
    const [nc, nb, ne] = c.nodes.map((n) => ctx.node(n)) as [number, number, number];
    const k = ctx.branch(c.id);
    const s = p.sign;
    // Ic row: Ic = ic − dQbc/dt; Ib row: Ib = ib + dQbe/dt + dQbc/dt (NPN-normalised charges).
    return [
      {
        voltage: [
          { index: nb, coef: s },
          { index: ne, coef: -s },
        ],
        key: "vbe",
        rows: [{ row: k + 1, sign: -s }],
        charge: (v) => bjtCharges(v, 0, p).be,
      },
      {
        voltage: [
          { index: nb, coef: s },
          { index: nc, coef: -s },
        ],
        key: "vbc",
        rows: [
          { row: k, sign: s },
          { row: k + 1, sign: -s },
        ],
        charge: (v) => bjtCharges(0, v, p).bc,
      },
    ];
  },
  load(c, ctx) {
    const p = bjtParams(c);
    const [nc, nb, ne] = c.nodes.map((n) => ctx.node(n)) as [number, number, number];
    const k = ctx.branch(c.id);
    let vbe = p.sign * (valueAt(ctx, nb) - valueAt(ctx, ne));
    let vbc = p.sign * (valueAt(ctx, nb) - valueAt(ctx, nc));
    if (ctx.state) {
      const s = ctx.state;
      if (ctx.initial) {
        vbe = p.vcritBe;
        vbc = 0;
      } else if (s["vbe"] !== undefined && s["vbc"] !== undefined) {
        const be = limitJunction(vbe, s["vbe"], p.vtf, p.vcritBe);
        const bc = limitJunction(vbc, s["vbc"], p.vtr, p.vcritBc);
        if (be.limited || bc.limited) ctx.limited();
        vbe = be.v;
        vbc = bc.v;
      }
      s["vbe"] = vbe;
      s["vbc"] = vbc;
    }
    const d = bjtCurrents(vbe, vbc, p, ctx.gmin);
    stampDeviceRow(ctx, k, p.sign, d.ic, [
      { a: nb, b: ne, g: d.dicBe, u: vbe },
      { a: nb, b: nc, g: d.dicBc, u: vbc },
    ]);
    stampDeviceRow(ctx, k + 1, p.sign, d.ib, [
      { a: nb, b: ne, g: d.dibBe, u: vbe },
      { a: nb, b: nc, g: d.dibBc, u: vbc },
    ]);
  },
};

const mosfetTerminals: MosfetModel["terminals"] = (c, ctx) => {
  const [nd, ng, ns] = c.nodes.map((n) => ctx.node(n)) as [number, number, number, number];
  const k = ctx.branch(c.id);
  const { cgs, cgd } = mosfetParams(c);
  const clean = (terms: LinearTerm[]) => form(terms.filter((x) => x.g !== 0 || x.c !== 0));
  return [
    {
      name: "d",
      alias: "drain",
      node: c.nodes[0],
      form: clean([term(k, 1), term(nd, 0, cgd), term(ng, 0, -cgd)]),
    },
    {
      name: "g",
      alias: "gate",
      node: c.nodes[1],
      form: clean([term(ng, 0, cgs + cgd), term(ns, 0, -cgs), term(nd, 0, -cgd)]),
    },
    {
      name: "s",
      alias: "source",
      node: c.nodes[2],
      form: clean([term(k, -1), term(ns, 0, cgs), term(ng, 0, -cgs)]),
    },
    { name: "b", alias: "bulk", node: c.nodes[3], form: form([]) },
  ];
};

const mosfetModel: MosfetModel = {
  // One branch unknown: the drain current Id (drain → source through the channel).
  branches: () => 1,
  stamp(c, ctx) {
    const [nd, ng, ns] = c.nodes.map((n) => ctx.node(n)) as [number, number, number, number];
    stampBranchIncidence(ctx, ctx.branch(c.id), nd, ns);
    const { cgs, cgd } = mosfetParams(c);
    if (cgs) stampAdmittance(ctx, ng, ns, 0, cgs);
    if (cgd) stampAdmittance(ctx, ng, nd, 0, cgd);
  },
  current(c, ctx) {
    return (mosfetTerminals(c, ctx) as [Terminal])[0].form;
  },
  terminals: mosfetTerminals,
  load(c, ctx) {
    const p = mosfetParams(c);
    const [nd, ng, ns, nb] = c.nodes.map((n) => ctx.node(n)) as [number, number, number, number];
    const k = ctx.branch(c.id);
    const vs = valueAt(ctx, ns);
    let vgs = p.sign * (valueAt(ctx, ng) - vs);
    let vds = p.sign * (valueAt(ctx, nd) - vs);
    const vbs = p.sign * (valueAt(ctx, nb) - vs);
    if (ctx.state) {
      const s = ctx.state;
      const [ogs, ods, obs] = [s["vgs"], s["vds"], s["vbs"]];
      if (ctx.initial) {
        vgs = p.vto;
        vds = 0;
      } else if (ogs !== undefined && ods !== undefined && obs !== undefined) {
        const von = mosfetThreshold(obs, p).vth;
        let ngs: number;
        let nds: number;
        if (ods >= 0) {
          ngs = limitGate(vgs, ogs, von);
          nds = limitDrain(ngs === vgs ? vds : ngs - (vgs - vds), ods);
        } else {
          const vgd = vgs - vds;
          const ngd = limitGate(vgd, ogs - ods, von);
          nds = -limitDrain(-(ngd === vgd ? vds : vgs - ngd), -ods);
          ngs = ngd === vgd && nds === vds ? vgs : ngd + nds;
        }
        if (ngs !== vgs || nds !== vds) ctx.limited();
        vgs = ngs;
        vds = nds;
      }
      s["vgs"] = vgs;
      s["vds"] = vds;
      s["vbs"] = vbs;
    }
    const m = mosfetCurrent(vgs, vds, vbs, p);
    stampDeviceRow(ctx, k, p.sign, m.id + ctx.gmin * vds, [
      { a: ng, b: ns, g: m.gm, u: vgs },
      { a: nd, b: ns, g: m.gds + ctx.gmin, u: vds },
      { a: nb, b: ns, g: m.gmbs, u: vbs },
    ]);
  },
};

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
    // Branch current I (anode → cathode), equation I = Id(Vj) + dQ(Vj)/dt with
    // Vj = Va − Vk − rs·I; the current part linearised around Vj₀:
    // (1 + gd·rs)·I − gd·Va + gd·Vk = Id(Vj₀) − gd·Vj₀.
    branches: () => 1,
    stamp(c, ctx) {
      const [a, k, b] = [ctx.node(c.nodes[0]), ctx.node(c.nodes[1]), ctx.branch(c.id)];
      stampBranchIncidence(ctx, b, a, k);
    },
    current(c, ctx) {
      return branchForm(ctx.branch(c.id));
    },
    junctions(c, ctx) {
      const p = diodeParams(c);
      if (p.cjo === 0 && p.tt === 0) return [];
      const [a, k, b] = [ctx.node(c.nodes[0]), ctx.node(c.nodes[1]), ctx.branch(c.id)];
      return [
        {
          voltage: [
            { index: a, coef: 1 },
            { index: k, coef: -1 },
            { index: b, coef: -p.rs },
          ],
          key: "vj",
          rows: [{ row: b, sign: -1 }],
          charge: (v) => diodeCharge(v, p),
        },
      ];
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

  bjt: bjtModel,
  mosfet: mosfetModel,
};

/** Returns the built-in model of a component. */
export function modelOf(c: ComponentJSON): ComponentModel {
  return MODELS[c.type] as ComponentModel;
}

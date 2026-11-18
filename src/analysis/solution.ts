import { Complex } from "../math/complex";
import type { NodeName } from "../format/types";
import type { MnaSystem, SourceValues } from "../mna/system";

/** Result of a DC (operating point) analysis. All values are real. */
export class DcSolution {
  /** @internal */
  constructor(
    private readonly system: MnaSystem,
    /** Raw MNA unknown vector (node voltages, then branch currents). */
    readonly x: readonly number[],
    private readonly values: SourceValues,
    /** True if a small conductance to ground had to be added to make the system solvable. */
    readonly gminUsed: boolean,
  ) {}

  /** Voltage `V(a) − V(b)` in volts (`b` defaults to ground). */
  voltage(a: NodeName, b?: NodeName): number {
    const xs = this.x.map((v) => new Complex(v));
    return this.system.evaluate(this.system.voltageForm(a, b), xs, Complex.ZERO, this.values).re;
  }

  /** Current through a component, from its first node to its second node, in amperes. */
  current(id: string): number {
    const xs = this.x.map((v) => new Complex(v));
    return this.system.evaluate(this.system.currentForm(id), xs, Complex.ZERO, this.values).re;
  }

  /**
   * Power absorbed by a component, `V(a,b)·I(a→b)`, in watts. Negative values mean the
   * component delivers power (sources).
   */
  power(id: string): number {
    const c = this.system.circuit.component(id);
    if (c.type === "coupling") return 0;
    if (c.type === "opamp") return this.voltage(c.nodes[2]) * this.current(id);
    return this.voltage(c.nodes[0], c.nodes[1]) * this.current(id);
  }

  /** Every node voltage referenced to ground (ground included, at 0 V). */
  nodeVoltages(): Record<NodeName, number> {
    const out: Record<NodeName, number> = { [this.system.circuit.ground]: 0 };
    this.system.circuit.nodes.forEach((n, i) => (out[n] = this.x[i] as number));
    return out;
  }

  /** Current through every component (couplings excluded). */
  currents(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of this.system.circuit.components)
      if (c.type !== "coupling") out[c.id] = this.current(c.id);
    return out;
  }
}

/** Result of an AC (small-signal, sinusoidal steady state) analysis at one frequency. Values are phasors. */
export class AcSolution {
  /** Angular frequency ω = 2πf (rad/s). */
  readonly omega: number;

  /** @internal */
  constructor(
    private readonly system: MnaSystem,
    /** Frequency in hertz. */
    readonly freq: number,
    /** Raw MNA unknown vector. */
    readonly x: readonly Complex[],
    private readonly values: SourceValues,
  ) {
    this.omega = 2 * Math.PI * freq;
  }

  private get s(): Complex {
    return new Complex(0, this.omega);
  }

  /** Voltage phasor `V(a) − V(b)` (`b` defaults to ground). */
  voltage(a: NodeName, b?: NodeName): Complex {
    return this.system.evaluate(this.system.voltageForm(a, b), this.x, this.s, this.values);
  }

  /** Current phasor through a component, from its first node to its second node. */
  current(id: string): Complex {
    return this.system.evaluate(this.system.currentForm(id), this.x, this.s, this.values);
  }

  /**
   * Complex power absorbed by a component, `S = ½·V·I*` (peak phasors): `re` is the
   * average (active) power in W, `im` the reactive power in var. Sources delivering
   * power have a negative real part.
   */
  power(id: string): Complex {
    const c = this.system.circuit.component(id);
    if (c.type === "coupling") return Complex.ZERO;
    const v = c.type === "opamp" ? this.voltage(c.nodes[2]) : this.voltage(c.nodes[0], c.nodes[1]);
    return v.mul(this.current(id).conj()).mul(0.5);
  }

  /** Every node voltage phasor referenced to ground. */
  nodeVoltages(): Record<NodeName, Complex> {
    const out: Record<NodeName, Complex> = { [this.system.circuit.ground]: Complex.ZERO };
    this.system.circuit.nodes.forEach((n, i) => (out[n] = this.x[i] as Complex));
    return out;
  }

  /** Current phasor through every component (couplings excluded). */
  currents(): Record<string, Complex> {
    const out: Record<string, Complex> = {};
    for (const c of this.system.circuit.components)
      if (c.type !== "coupling") out[c.id] = this.current(c.id);
    return out;
  }
}

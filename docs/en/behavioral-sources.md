---
title: Behavioural sources
category: Guides
---

# Behavioural sources

A behavioural source (SPICE `B`) is a voltage or a current given by **any expression** of the circuit's voltages and currents: a multiplier, a squarer, a `tanh` transconductance, a logarithmic amplifier, a voltage-controlled gain… It models a function without drawing the transistors that implement it.

```text
Bname n+ n- V=expression     voltage V(n+) − V(n-)
Bname n+ n- I=expression     current from n+ to n- through the source
```

Like diodes and transistors, a `B` source makes the circuit non-linear: DC and transients are solved by Newton-Raphson, and small-signal analyses use the expression linearised at the operating point.

## A first behavioural source

A squarer: `V(out) = V(in)² / 2`.

```ts
import { ElecMap } from "elecmap";

const squarer = new ElecMap(`
V1 in 0 DC 3 AC 1
R1 in 0 1k
B1 out 0 V=V(in)^2/2
RL out 0 1k
`);

squarer.voltage("out"); // 4.5 V       3² / 2
squarer.current("B1"); // -0.0045 A    flows from out to 0 through B1: it feeds RL
squarer.operatingPoint().iterations; // 4
```

<figure class="em-figure">
{@include ./figures/behavioral-squarer.svg}
</figure>

The current of a `B` source follows the convention of every source: positive from `n+` to `n-` **through the source**. Here B1 drives 4.5 mA into RL, so its current is −4.5 mA.

### Small signal

Around its operating point, the squarer is a gain equal to the slope of `V²/2`, i.e. `V(in)` = 3:

```ts
squarer.transferFunction({ input: "V1", output: "out" }).dcGain(); // 3
```

Each analysis uses the linearisation automatically: `ac`, `transferFunction`, `impedance`, `thevenin`, `sensitivity`…

## Writing an expression

| Element                                           | Meaning                                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `V(a)`, `V(a,b)`                                  | voltage of node `a`, voltage between `a` and `b`                                                                 |
| `I(id)`                                           | current of a component: source, inductor, resistor, controlled source, op-amp output, diode, another `B` source… |
| `time`                                            | time (s), 0 outside transient analysis                                                                           |
| `1k`, `26m`, `pi`, `e`                            | numbers with SPICE suffixes, constants                                                                           |
| `+ - * / ^`                                       | arithmetic (`**` is also a power), `-2^2` = −4                                                                   |
| `< <= > >= == != && \|\| !`                       | comparisons and logic: 1 when true, 0 otherwise                                                                  |
| `sqrt exp ln log log10 abs`                       | `log` is the natural logarithm, like `ln`                                                                        |
| `sin cos tan asin acos atan atan2 sinh cosh tanh` | trigonometric and hyperbolic functions                                                                           |
| `min max pow limit if`                            | `limit(x, lo, hi)` clamps `x`, `if(c, a, b)` is `a` when `c ≠ 0`                                                 |
| `u uramp sgn floor ceil round`                    | `u(x)` is the unit step, `uramp(x) = max(x, 0)`                                                                  |

`I(id)` accepts the components whose current is a combination of the circuit unknowns. A capacitor (its current depends on `dV/dt`) and an independent current source (its current is known) are refused; measure them with a 0 V source in series, as in SPICE.

```ts
const meter = new ElecMap(`
V1 a 0 10
RL a 0 50
BP pw 0 V=V(a)*I(RL)
`);
meter.voltage("pw"); // 2    the power of RL (W), as a voltage
```

Parameters (`.param`, subcircuit parameters) are replaced by their values when the netlist is read, with or without braces. Subcircuits rename their probes like their nodes:

```ts
const log = new ElecMap(`
.param GAIN=10
.subckt LOGAMP in out PARAMS: IS=1n
B1 out 0 V=-26m*ln(V(in)/(10k*{IS}))
.ends
V1 a 0 1
X1 a y LOGAMP IS=10n
B2 z 0 V={GAIN}*V(y)
R1 z 0 1k
R2 y 0 1k
`);
log.components()[1]; // { id: "X1.B1", type: "bsource", kind: "voltage", expression: "-0.026*ln(V(a)/0.0001)", … }
log.voltage("y"); // -0.23947 V    −26 mV · ln(10⁴)
log.voltage("z"); // -2.3947 V
```

In JSON, a behavioural source is written `{ "type": "bsource", "nodes": [p, n], "kind": "voltage" | "current", "expression": "…" }`.

## A current source: transconductance

The current of a differential pair is a `tanh` of its input voltage. As a `B` source:

```ts
const ota = new ElecMap(`
VIN in 0 0
B1 0 out I=1m*tanh(V(in)/52m)
RL out 0 10k
`);

ota.transferFunction({ input: "VIN", output: "out" }).dcGain(); // 192.31    gm·RL = (1 mA / 52 mV) · 10 kΩ
ota.setValue("VIN", 0.1);
ota.voltage("out"); // 9.5817 V     close to saturation (10 V)
ota.transferFunction({ input: "VIN", output: "out" }).dcGain(); // 15.752    the gain collapses
```

The small-signal gain is the slope of the transfer curve at each operating point:

<figure class="em-figure">
{@include ./figures/behavioral-ota.svg}
</figure>

## Multipliers: modulation and variable gain

An expression may multiply two signals. In the time domain, this is an amplitude modulator:

```ts
const am = new ElecMap(`
VC c 0 SIN(0 1 10k)
VM m 0 SIN(0 1 500)
B1 am 0 V=(1+0.5*V(m))*V(c)
R1 am 0 1k
`);
const tr = am.transient({ tStop: 4e-3, tStep: 5e-6 });
Math.max(...tr.voltage("am")); // 1.4985 V    peak of the envelope 1 + 0.5
```

<figure class="em-figure">
{@include ./figures/behavioral-am.svg}
</figure>

In small signal, the gain from one input is the DC value of the other: a voltage-controlled amplifier.

```ts
const vca = new ElecMap(`
VIN in 0 DC 0 AC 1
VCTRL ctrl 0 2
B1 out 0 V=V(ctrl)*V(in)
RL out 0 10k
`);
vca.transferFunction({ input: "VIN", output: "out" }).dcGain(); // 2       = V(ctrl)
vca.transferFunction({ input: "VCTRL", output: "out" }).dcGain(); // 0     = V(in), 0 V in DC
vca.setValue("VCTRL", 0.5).transferFunction({ input: "VIN", output: "out" }).dcGain(); // 0.5
```

## Functions of time

`time` turns a `B` source into an arbitrary generator. It is 0 in DC, so the operating point sees the value at t = 0:

```ts
const burst = new ElecMap(`
B1 out 0 V=sin(2*pi*1k*time)*exp(-time/1m)
R1 out 0 1k
`);
burst.voltage("out"); // 0    at t = 0
burst.transient({ tStop: 3e-3, tStep: 1e-5 }).voltage("out")[25]; // 0.7788    t = 0.25 ms: e^−0.25
```

## Convergence

Newton-Raphson needs the slope of the expression, which ElecMap computes exactly (automatic differentiation). A few habits help it:

- **Prefer smooth functions.** `if`, `u`, `sgn`, `floor`… have a zero slope and a jump: Newton cannot "see" them coming. `tanh(x/ε)` or `limit` make a softer switch.
- **Mind the domain.** `ln`, `sqrt`, `1/x` are not defined everywhere. When an iterate falls outside (`ln 0` at the first iteration, where every voltage is 0), the source keeps its last value and Newton goes on, but an expression that stays outside the domain cannot converge: `ln(max(V(a), 1n))` is safer.
- **Keep a DC path.** As for any source, a `B` current source alone on a node leaves its voltage undefined.

A behavioural circuit has no literal transfer function: `symbolicTransferFunction` refuses it, while the numeric `transferFunction` works around the operating point.

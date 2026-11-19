---
title: Transistors
category: Guides
---

# Transistors

ElecMap simulates the two classic transistors with the SPICE models every textbook uses:

| Device                  | SPICE line                  | Model                                         |
| ----------------------- | --------------------------- | --------------------------------------------- |
| bipolar, `NPN` / `PNP`  | `Q<name> c b e [model]`     | Ebers-Moll (transport form) with Early effect |
| MOSFET, `NMOS` / `PMOS` | `M<name> d g s [b] [model]` | Shichman-Hodges (SPICE level 1), body effect  |

Like diodes, they make the circuit non-linear: the operating point and transients are solved by Newton-Raphson, and small-signal analyses (`ac`, `transferFunction`, `impedance`, Thévenin) use the transistor linearised at its bias. Everything in the [diodes guide](./diodes.md#convergence) about convergence applies here too.

## A common-emitter stage

The classic four-resistor bias: a divider sets the base, RE stabilises the collector current.

```ts
import { ElecMap } from "elecmap";

const stage = new ElecMap(`
VCC vcc 0 12
RB1 vcc b 47k
RB2 b 0 10k
RC vcc c 2.2k
RE e 0 470
Q1 c b e Q2N2222
.model Q2N2222 NPN(IS=14.34f BF=255.9 VAF=74.03 CJE=22p CJC=7.3p)
`);

const op = stage.operatingPoint();
op.voltage("b"); // 2.0177 V
op.voltage("e"); // 1.3461 V    one VBE below the base
op.voltage("c"); // 5.7227 V
op.voltage("c", "e"); // 4.3766 V    VCE: forward-active
op.iterations; // 6
```

<figure class="em-figure">
{@include ./figures/ce-stage.svg}
</figure>

### Terminal currents

`current("Q1")` is the collector current. The other terminals are reached with `"Q1:<terminal>"`, by letter or by name. Every terminal current **enters** the device, so they sum to zero:

```ts
op.current("Q1"); // 0.0028533 A    collector (same as "Q1:c" or "Q1:collector")
op.current("Q1:b"); // 0.000010619 A  base
op.current("Q1:e"); // -0.0028639 A   emitter: the current leaves
op.current("Q1") / op.current("Q1:b"); // 268.71    β, BF raised by the Early effect
op.power("Q1"); // 0.012495 W      Σ V(terminal)·I(terminal)
```

The terminals are `c`/`collector`, `b`/`base`, `e`/`emitter` for a BJT and `d`/`drain`, `g`/`gate`, `s`/`source`, `b`/`bulk` for a MOSFET.

### Small-signal gain

Add a source, a coupling capacitor and an emitter bypass capacitor: the transfer function is computed around the operating point, where the transistor is a transconductance `gm = Ic / V_T` with its junction capacitances.

```ts
const amp = new ElecMap(`
VCC vcc 0 12
VS in 0 AC 1
CIN in b 10u
RB1 vcc b 47k
RB2 b 0 10k
RC vcc c 2.2k
RE e 0 470
CE e 0 100u
Q1 c b e Q2N2222
.model Q2N2222 NPN(IS=14.34f BF=255.9 VAF=74.03 CJE=22p CJC=7.3p)
`);

const H = amp.transferFunction({ input: "VS", output: "c" });
H.evaluate(10e3).abs(); // 224.43       47.0 dB, close to gm·(RC ∥ ro)
H.evaluate(10e3).arg() * (180 / Math.PI); // -179.05°    inverting
amp.inputImpedance("VS").evaluate(10e3).abs(); // 1869.7 Ω  RB1 ∥ RB2 ∥ rπ
amp.outputImpedance("c").evaluate(10e3).abs(); // 2035.5 Ω  RC ∥ ro
```

<figure class="em-figure">
{@include ./figures/ce-bode.svg}
<figcaption>The band runs from about 170 Hz (coupling and bypass capacitors) to about 19 MHz (CJC at the reverse-biased collector junction, multiplied by the gain: the Miller effect)</figcaption>
</figure>

A transient shows what the small-signal model cannot: with a 2 mV input the output swings 0.9 V peak to peak around its bias, and a larger input distorts.

```ts
const tr = new ElecMap(amp.toSpice().replace("AC 1", "SIN(0 2m 10k)")).transient({
  tStop: 0.6e-3,
  tStep: 0.5e-6,
});
const vc = tr.voltage("c").slice(800); // after the start-up transient
Math.max(...vc); // 6.164 V
Math.min(...vc); // 5.2669 V
```

### PNP

A PNP is the mirror image: emitter at the positive rail, currents and voltages reversed. The signs follow the same convention (current entering the terminal):

```ts
const pnp = new ElecMap(`
VCC vcc 0 12
RB1 vcc b 10k
RB2 b 0 47k
RE vcc e 470
RC c 0 2.2k
Q1 c b e Q2N2907
.model Q2N2907 PNP(IS=650.6E-18 BF=231.7 VAF=115.7)
`);

const p = pnp.operatingPoint();
p.voltage("e", "b"); // 0.75035 V    VEB
p.voltage("c"); // 5.8871 V
p.current("Q1"); // -0.0026759 A  collector current leaves the device
p.current("Q1:e"); // 0.0026871 A  emitter current enters it
```

### BJT parameters

| SPICE | JSON  | Meaning                                  | Default |
| ----- | ----- | ---------------------------------------- | ------- |
| `IS`  | `is`  | transport saturation current (A)         | `1e-16` |
| `BF`  | `bf`  | forward current gain β                   | `100`   |
| `BR`  | `br`  | reverse current gain                     | `1`     |
| `NF`  | `nf`  | forward emission coefficient             | `1`     |
| `NR`  | `nr`  | reverse emission coefficient             | `1`     |
| `VAF` | `vaf` | forward Early voltage (V), `VA` accepted | ∞       |
| `VAR` | `var` | reverse Early voltage (V), `VB` accepted | ∞       |
| `CJE` | `cje` | zero-bias base-emitter capacitance (F)   | `0`     |
| `VJE` | `vje` | base-emitter junction potential (V)      | `0.75`  |
| `MJE` | `mje` | base-emitter grading coefficient         | `0.33`  |
| `CJC` | `cjc` | zero-bias base-collector capacitance (F) | `0`     |
| `VJC` | `vjc` | base-collector junction potential (V)    | `0.75`  |
| `MJC` | `mjc` | base-collector grading coefficient       | `0.33`  |
| `TF`  | `tf`  | forward transit time (s)                 | `0`     |
| `TR`  | `tr`  | reverse transit time (s)                 | `0`     |
| `FC`  | `fc`  | forward-bias capacitance coefficient     | `0.5`   |

The currents are those of the SPICE Gummel-Poon model without high-injection and series resistances:

<div class="em-math">I_C = \left(I_{BE} - I_{BC}\right)\left(1 - \frac{V_{BC}}{V_{AF}} - \frac{V_{BE}}{V_{AR}}\right) - \frac{I_{BC}}{B_R}, \qquad I_B = \frac{I_{BE}}{B_F} + \frac{I_{BC}}{B_R}, \qquad I_{BE} = I_S\left(e^{V_{BE}/N_F V_T} - 1\right)</div>

An optional substrate node (`Q1 c b e sub QMOD`) is ignored with a warning; an area factor after the model name multiplies `IS`, `CJE` and `CJC`. `PE`, `ME`, `PC` and `MC` are accepted for `VJE`, `MJE`, `VJC` and `MJC`.

Each junction stores a depletion charge that depends on its voltage, as for a [diode](./diodes.md#junction-capacitance-and-transit-time), plus the diffusion charges `TF·I_BE` (base-emitter) and `TR·I_BC` (base-collector). In small signal, `TF` adds `TF·gm` to the base-emitter capacitance and sets the transition frequency `f_T ≈ 1 / (2π·TF)` at high current.

## A MOSFET common-source stage

A MOSFET is written `M<name> drain gate source [bulk] model`, with the channel width `W` and length `L` on the line. Without a bulk node, the bulk is tied to the source.

```ts
const cs = new ElecMap(`
VDD vdd 0 10
VG g 0 DC 3 AC 1
RD vdd d 4.7k
M1 d g 0 0 NMOD W=100u L=10u
.model NMOD NMOS(VTO=1.5 KP=50u LAMBDA=0.02)
`);

const m = cs.operatingPoint();
m.current("M1"); // 0.0006411 A   drain current: ½·KP·W/L·(VGS − VTO)²·(1 + λ·VDS)
m.voltage("d"); // 6.9868 V      VDS > VGS − VTO: saturation
m.current("M1:g"); // 0 A         no gate current
m.power("M1"); // 0.0044793 W

cs.transferFunction({ input: "VG", output: "d" }).dcGain(); // -3.8158   −gm·(RD ∥ ro)
```

<figure class="em-figure">
{@include ./figures/cs-stage.svg}
</figure>

### Body effect

With a bulk node of its own, a reverse source-bulk voltage raises the threshold (`GAMMA`, `PHI`). Here the bulk sits 2 V below the source:

```ts
const body = new ElecMap(`
VDD vdd 0 10
VG g 0 3
VSB 0 sub 2
RD vdd d 4.7k
M1 d g 0 sub NMOS VTO=1.5 KP=50u W=100u L=10u GAMMA=0.4
`);

body.operatingPoint().current("M1"); // 0.00033922 A   instead of 0.0005625 A
body.operatingPoint().current("M1:b"); // 0 A            the bulk draws no current
```

When the bulk differs from the source, the schematic draws it as a fourth pin.

### MOSFET parameters

| SPICE    | JSON     | Meaning                                                                 | Default |
| -------- | -------- | ----------------------------------------------------------------------- | ------- |
| `VTO`    | `vto`    | threshold voltage (V), negative for an enhancement PMOS, `VT0` accepted | `0`     |
| `KP`     | `kp`     | transconductance parameter μ·Cox (A/V²)                                 | `2e-5`  |
| `LAMBDA` | `lambda` | channel-length modulation (1/V)                                         | `0`     |
| `GAMMA`  | `gamma`  | body-effect coefficient (√V)                                            | `0`     |
| `PHI`    | `phi`    | surface potential (V)                                                   | `0.6`   |
| `CGSO`   | `cgso`   | gate-source overlap capacitance per width (F/m)                         | `0`     |
| `CGDO`   | `cgdo`   | gate-drain overlap capacitance per width (F/m)                          | `0`     |
| `W`      | `w`      | channel width (m), on the instance line                                 | `100u`  |
| `L`      | `l`      | channel length (m), on the instance line                                | `100u`  |

With `β = KP·W/L` and `V_{th} = VTO + γ(\sqrt{Φ − V_{BS}} − \sqrt{Φ})`:

<div class="em-math">I_D = \begin{cases} 0 & V_{GS} \le V_{th} \\ \beta\left(V_{GS} - V_{th} - \tfrac{V_{DS}}{2}\right) V_{DS}\,(1 + \lambda V_{DS}) & V_{DS} < V_{GS} - V_{th} \\ \tfrac{\beta}{2}\left(V_{GS} - V_{th}\right)^2 (1 + \lambda V_{DS}) & \text{otherwise} \end{cases}</div>

The device is symmetric: when `V_DS < 0`, drain and source swap roles. Only `LEVEL=1` is supported; `AD`, `AS`, `PD`, `PS`, `NRD`, `NRS` are accepted and ignored with a warning.

## A CMOS inverter

PMOS and NMOS in series between the supply and ground, gates tied together. Parameters can be written on the line instead of a `.model` card: the bare keywords `NPN`, `PNP`, `NMOS`, `PMOS` stand for a default model.

```ts
const inv = new ElecMap(`
VDD vdd 0 5
VIN in 0 0
MP out in vdd vdd PMOS VTO=-0.7 KP=50u W=20u L=1u
MN out in 0 0 NMOS VTO=0.7 KP=110u W=10u L=1u
`);

for (const v of [0, 2, 2.5, 3, 5]) inv.setValue("VIN", v).voltage("out");
// 5   4.552   1.257   0.3626   1.057e-9
```

<figure class="em-figure">
{@include ./figures/cmos-inverter.svg}
</figure>

<figure class="em-figure">
{@include ./figures/cmos-transfer.svg}
<figcaption>Voltage transfer curve and supply current, from <code>setValue</code> sweeps: the current peaks when both transistors conduct</figcaption>
</figure>

With a load capacitor and a `PULSE` input, `transient()` gives the switching edges:

```ts
const edge = new ElecMap(`
VDD vdd 0 5
VIN in 0 PULSE(0 5 1n 0.1n 0.1n 5n 10n)
MP out in vdd vdd PMOS VTO=-0.7 KP=50u W=20u L=1u
MN out in 0 0 NMOS VTO=0.7 KP=110u W=10u L=1u
CL out 0 100f
`).transient({ tStop: 10e-9, tStep: 0.02e-9 });

// time at which V(out) crosses 2.5 V after a given instant
const v = edge.voltage("out");
const crossing = (after: number) => {
  const i = edge.time.findIndex((t, k) => t > after && (v[k - 1] - 2.5) * (v[k] - 2.5) <= 0);
  const [t0, t1, v0, v1] = [edge.time[i - 1], edge.time[i], v[i - 1], v[i]];
  return t0 + ((2.5 - v0) / (v1 - v0)) * (t1 - t0);
};
crossing(0) - 1.05e-9; // 4.7e-11 s    t_pHL: the NMOS discharges CL
crossing(5e-9) - 6.05e-9; // 1.5e-10 s  t_pLH: the weaker PMOS charges it
```

## In JSON and SPICE

Transistors are components like any other; the model name is kept so `toSpice()` writes the `.model` card back:

```ts
cs.toJSON().components[3];
// { id: "M1", type: "mosfet", nodes: ["d", "g", "0", "0"], polarity: "nmos",
//   model: "NMOD", vto: 1.5, kp: 0.00005, lambda: 0.02, w: 0.0001, l: 0.00001 }

cs.toSpice();
// VDD vdd 0 DC 10
// VG g 0 DC 3 AC 1
// RD vdd d 4.7k
// M1 d g 0 0 NMOD W=100u L=10u
// .model NMOD NMOS(VTO=1.5 KP=50u LAMBDA=20m)
```

The JSON fields are listed in the [components reference](./components.md); a BJT has `nodes: [c, b, e]` and `polarity: "npn" | "pnp"`, a MOSFET `nodes: [d, g, s, b]` and `polarity: "nmos" | "pmos"`.

## Limitations

- The MOSFET capacitances `CGSO` and `CGDO` are constant; base and emitter resistances, high-injection effects and the MOSFET Meyer capacitances are not modelled.
- MOSFETs follow level 1 only: no subthreshold conduction, no velocity saturation.
- Literal transfer functions are not available for transistor circuits:

```ts
cs.symbolicTransferFunction({ input: "VG", output: "d" });
// ElecMapError UNSUPPORTED: Symbolic analysis of a non-linear circuit (M1) is not supported:
// use the numeric transferFunction, linearised at the operating point
```

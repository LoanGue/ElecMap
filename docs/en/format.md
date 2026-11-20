# Circuit formats

ElecMap accepts two inputs, both turned into one **compiled circuit** by `compile()`:

1. a **SPICE netlist**, the industry-standard text format;
2. the **canonical JSON format**, a typed, machine-readable document that is also the form ElecMap stores internally.

```ts
import { compile } from "elecmap";

const circuit = compile(`
V1 in 0 AC 1
R1 in out 1k
C1 out 0 100n
`);

circuit.nodes; // ["in", "out"]
circuit.toJSON(); // canonical JSON
circuit.toSpice(); // netlist again
```

A string starting with `{` is parsed as JSON, any other string as SPICE. A JavaScript object is taken as a JSON document.

## SPICE netlist

### Values

Numbers accept SPICE scale suffixes (case-insensitive). Trailing unit letters are ignored.

| Suffix | Factor  | Suffix   | Factor |
| ------ | ------- | -------- | ------ |
| `T`    | 10¹²    | `m`      | 10⁻³   |
| `G`    | 10⁹     | `u`, `µ` | 10⁻⁶   |
| `MEG`  | 10⁶     | `n`      | 10⁻⁹   |
| `k`    | 10³     | `p`      | 10⁻¹²  |
| `mil`  | 25.4 µm | `f`      | 10⁻¹⁵  |

Examples: `1k`, `4.7u`, `100nF`, `1e-3`, `2MEG`. The European notation is supported too: `4k7` = 4.7 kΩ, `1R5` = 1.5 Ω, `2u2` = 2.2 µ.

> ⚠️ As in SPICE, `M` means **milli** (use `MEG` for mega) and `F` means **femto**: write `100nF`, not `100F`.

### Elements

| Line                                         | Component                                                      |
| -------------------------------------------- | -------------------------------------------------------------- |
| `Rname n1 n2 value`                          | resistor (Ω)                                                   |
| `Cname n1 n2 value [IC=v]`                   | capacitor (F), initial voltage                                 |
| `Lname n1 n2 value [IC=i]`                   | inductor (H), initial current                                  |
| `Vname n+ n- [DC v] [AC mag [phase]] [wave]` | independent voltage source                                     |
| `Iname n+ n- [DC i] [AC mag [phase]] [wave]` | independent current source                                     |
| `Ename n+ n- nc+ nc- gain`                   | voltage-controlled voltage source                              |
| `Gname n+ n- nc+ nc- gm`                     | voltage-controlled current source                              |
| `Fname n+ n- Vctrl gain`                     | current-controlled current source                              |
| `Hname n+ n- Vctrl r`                        | current-controlled voltage source                              |
| `Bname n+ n- V=expr` / `I=expr`              | behavioural source (see [guide](./behavioral-sources.md))      |
| `Kname L1 L2 k`                              | coupled inductors, `0 < k ≤ 1`                                 |
| `Xname in+ in- out OPAMP [GAIN=a] [GBW=f]`   | op-amp _(ElecMap extension)_                                   |
| `Xname node… NAME [K=v…]`                    | subcircuit instance (see [below](#subcircuits-and-parameters)) |
| `Sname n1 n2 ON\|OFF [RON=r] [ROFF=r]`       | fixed-state switch _(ElecMap extension)_                       |
| `Dname anode cathode [model] [area] [K=v…]`  | diode, Zener (see [diodes](./diodes.md))                       |
| `.model name D(IS=… N=… RS=… BV=…)`          | diode model card                                               |
| `Qname c b e [sub] [model] [area] [K=v…]`    | bipolar transistor (see [transistors](./transistors.md))       |
| `Mname d g s [b] model [W=w] [L=l] [K=v…]`   | MOSFET, bulk tied to the source if omitted                     |
| `.model name NPN                             | PNP(IS=… BF=… VAF=…)`                                          | bipolar model card          |
| `.model name NMOS                            | PMOS(VTO=… KP=… LAMBDA=…)`                                     | MOSFET model card (level 1) |

A bare number after the nodes of a source is its DC value (`V1 a 0 5`). Phases are in degrees.

**Waveforms** (transient analysis): `SIN(offset amplitude freq [delay [damping [phase]]])`, `PULSE(v1 v2 [delay rise fall width period])`, `PWL(t1 v1 t2 v2 …)`, `EXP(v1 v2 [td1 tau1 td2 tau2])`, `STEP(v1 v2 [delay])` _(extension)_. Commas and a space before `(` are allowed.

### Syntax

- `*` at the start of a line begins a comment; `;` and `$` begin inline comments.
- A line starting with `+` continues the previous line.
- **Title line:** in classic SPICE the first line is always a title. ElecMap detects it automatically: the first line is a title only if it does not parse as an element. Force it with `compile(src, { spice: { titleLine: true } })`, or use `.title My circuit`.
- `.end` stops parsing. Other directives (`.ac`, `.tran`, `.op`…) are ignored and reported in `circuit.parserWarnings`.
- The ground node is `0`; `gnd` and `GND` are aliases. Use `compile(src, { ground: "ref" })` to pick another name.

### Subcircuits and parameters

A `.subckt` block defines a reusable circuit; each `X` line places a copy of it. Parameters are written `{expression}` in element values:

```ts
const c = new ElecMap(`
* Two Sallen-Key stages: a 4th-order Butterworth low-pass
.param FC=1k R=10k
.subckt SK in out PARAMS: Q=0.7071
R1 in a {R}
R2 a b {R}
C1 a out {2*Q/(2*pi*FC*R)}
C2 b 0 {1/(2*Q*2*pi*FC*R)}
XU b out out OPAMP
.ends SK
V1 in 0 AC 1
X1 in mid SK Q=0.5412
X2 mid out SK Q=1.3066
`);

c.components().map((x) => x.id);
// ["V1", "X1.R1", "X1.R2", "X1.C1", "X1.C2", "X1.XU",
//        "X2.R1", "X2.R2", "X2.C1", "X2.C2", "X2.XU"]
c.nodes(); // ["in", "X1.a", "X1.b", "mid", "X2.a", "X2.b", "out"]
c.components().find((x) => x.id === "X1.C1")?.value; // 1.7227e-8 F = 2·0.5412 / (2π · 1 kHz · 10 kΩ)

const H = c.transferFunction({ input: "V1", output: "out" });
H.order; // 4
H.cutoffFrequency(); // 1000.0 Hz
20 * Math.log10(H.evaluate(2000).abs()); // -24.1 dB  (4th order: -24 dB per octave)
```

- **Definition:** `.subckt NAME port… [PARAMS:] [K=default…]` … `.ends [NAME]`. Blocks can appear anywhere, before or after their use. A `.subckt` inside another `.subckt` is not allowed, but a subcircuit can instantiate other subcircuits (`X` lines inside the body).
- **Instance:** `Xname node… NAME [K=value…]`, with one node per port. Instance values override the defaults; they are evaluated in the scope of the caller, so `R={2*RBASE}` can use a global parameter.
- **Flattening:** the circuit is expanded when it is read. Inside `X1`, element `R1` becomes `X1.R1` and internal node `a` becomes `X1.a`; ports are replaced by the instance nodes, and the ground (`0`, `gnd`) stays global. References to other elements of the block (`F`/`H` controlling sources, `K` inductors) are renamed the same way. Every element can then be probed: `c.voltage("X1.a")`, `c.current("X2.R1")`.
- **Parameters:** `.param K=value…` defines global parameters. Expressions accept numbers with SPICE suffixes (`1k`, `4k7`), `+ - * /`, `^` or `**`, parentheses, `pi`, `e` and the functions `sqrt exp log ln log10 abs sin cos tan atan min max pow`. Names are case-insensitive.
- `.model` cards are global, even when written inside a block. `X… OPAMP` remains the built-in op-amp.
- **Export:** `toSpice()` and `export("netlist")` write the flattened circuit (`X1.R1 in X1.a 10k`), which reads back as is: an element type is given by the first letter after the last `.`.

```json
{
  "version": 1,
  "title": "RC low-pass",
  "ground": "0",
  "components": [
    { "id": "V1", "type": "vsource", "nodes": ["in", "0"], "ac": { "mag": 1 } },
    { "id": "R1", "type": "resistor", "nodes": ["in", "out"], "value": 1000 },
    { "id": "C1", "type": "capacitor", "nodes": ["out", "0"], "value": 1e-7 }
  ]
}
```

- All values are plain SI numbers, phases are in degrees.
- `nodes` follow the port order of each type (see [components.md](./components.md)).
- The TypeScript types (`CircuitJSON`, `ComponentJSON`, …) and a JSON Schema (`CIRCUIT_SCHEMA`, draft 2020-12) are exported for editors and external validators.

## Exporting and sharing

`export(format)` writes the circuit in one of three exchange formats, and the constructor reads any of them back:

| Format      | `export` returns       | Use                                                                 |
| ----------- | ---------------------- | ------------------------------------------------------------------- |
| `"json"`    | a `CircuitJSON` object | the canonical document, used internally                             |
| `"netlist"` | SPICE text             | read by humans and by other simulators                              |
| `"base64"`  | a URL-safe token       | a single string without spaces, ready to send in a URL or a message |

```ts
const c = new ElecMap("V1 in 0 AC 1
R1 in out 1k
C1 out 0 100n");

const token = c.export("base64");
// "eyJ2ZXJzaW9uIjoxLCJjb21wb25lbnRzIjpbeyJpZCI6IlYxIiwidHlwZSI6InZzb3VyY2Ui…"
token.length; // 310    characters [A-Za-z0-9_-], safe in a URL as is

const copy = new ElecMap(token); // the format is detected
copy.transferFunction({ input: "V1", output: "out" }).cutoffFrequency(); // 1591.5 Hz

c.export("netlist");
// * ElecMap circuit
// V1 in 0 AC 1
// R1 in out 1k
// C1 out 0 100n
// .end

c.export("json");
// { version: 1, components: [
//   { id: "V1", type: "vsource", nodes: ["in", "0"], ac: { mag: 1 } }, … ], ground: "0" }
```

The format of a text input is detected: text starting with `{` is JSON, a single token without whitespace is base64, anything else is a netlist. Set it explicitly with `format`:

```ts
new ElecMap(text, { format: "netlist" }); // a netlist, even if it looks like something else
new ElecMap(token, { format: "base64" });
```

The base64 token is the compact JSON document in UTF-8, so it carries everything the JSON does. Every conversion goes through the JSON document: reading a netlist means netlist → JSON, exporting it means JSON → base64, so each format only needs a reader and a writer.

## Validation

`compile()` runs `validateCircuit()` and throws an `ElecMapError` with code `INVALID_CIRCUIT` if any error is found. Every issue is listed in `error.details.issues`, so a UI can highlight the faulty component or node. Warnings are kept in `circuit.warnings`.

| Code                  | Severity | Meaning                                                      |
| --------------------- | -------- | ------------------------------------------------------------ |
| `MALFORMED`           | error    | Document or component has the wrong shape                    |
| `UNKNOWN_TYPE`        | error    | Unsupported component type                                   |
| `INVALID_NODES`       | error    | Wrong number of nodes                                        |
| `INVALID_VALUE`       | error    | Missing, non-finite or out-of-range value                    |
| `DUPLICATE_ID`        | error    | Two components share an id                                   |
| `UNKNOWN_REFERENCE`   | error    | Controlling source, coupled inductor or control node missing |
| `EMPTY_CIRCUIT`       | error    | No component                                                 |
| `NO_GROUND`           | error    | Nothing is connected to the ground                           |
| `FLOATING_NODE`       | error    | Node without any path to ground                              |
| `VOLTAGE_SOURCE_LOOP` | error    | Loop made only of voltage sources / ideal shorts             |
| `NO_DC_PATH`          | warning  | Node only reachable through capacitors / current sources     |
| `INDUCTOR_LOOP`       | warning  | Loop of inductors and voltage sources (singular in DC)       |
| `SHORTED_COMPONENT`   | warning  | Both terminals on the same node                              |
| `DANGLING_NODE`       | warning  | Node connected to a single terminal                          |

## Compiled circuit

`CompiledCircuit` is immutable (its document is deeply frozen):

| Member                                            | Description                               |
| ------------------------------------------------- | ----------------------------------------- |
| `nodes`                                           | non-ground node names, in MNA index order |
| `nodeIndex(name)`                                 | index of a node, `-1` for ground          |
| `hasNode(name)`, `isGround(name)`                 | node lookups (aliases included)           |
| `components`, `component(id)`, `hasComponent(id)` | component lookups                         |
| `warnings`, `parserWarnings`                      | non-fatal remarks                         |
| `toJSON()`, `toSpice()`                           | export (mutable copy / netlist)           |

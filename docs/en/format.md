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

| Line                                         | Component                                |
| -------------------------------------------- | ---------------------------------------- |
| `Rname n1 n2 value`                          | resistor (Ω)                             |
| `Cname n1 n2 value [IC=v]`                   | capacitor (F), initial voltage           |
| `Lname n1 n2 value [IC=i]`                   | inductor (H), initial current            |
| `Vname n+ n- [DC v] [AC mag [phase]] [wave]` | independent voltage source               |
| `Iname n+ n- [DC i] [AC mag [phase]] [wave]` | independent current source               |
| `Ename n+ n- nc+ nc- gain`                   | voltage-controlled voltage source        |
| `Gname n+ n- nc+ nc- gm`                     | voltage-controlled current source        |
| `Fname n+ n- Vctrl gain`                     | current-controlled current source        |
| `Hname n+ n- Vctrl r`                        | current-controlled voltage source        |
| `Kname L1 L2 k`                              | coupled inductors, `0 < k ≤ 1`           |
| `Xname in+ in- out OPAMP [GAIN=a] [GBW=f]`   | op-amp _(ElecMap extension)_             |
| `Sname n1 n2 ON\|OFF [RON=r] [ROFF=r]`       | fixed-state switch _(ElecMap extension)_ |
| `Dname anode cathode [model] [area] [K=v…]`  | diode, Zener (see [diodes](./diodes.md)) |
| `.model name D(IS=… N=… RS=… BV=…)`          | diode model card                         |

A bare number after the nodes of a source is its DC value (`V1 a 0 5`). Phases are in degrees.

**Waveforms** (transient analysis): `SIN(offset amplitude freq [delay [damping [phase]]])`, `PULSE(v1 v2 [delay rise fall width period])`, `PWL(t1 v1 t2 v2 …)`, `EXP(v1 v2 [td1 tau1 td2 tau2])`, `STEP(v1 v2 [delay])` _(extension)_. Commas and a space before `(` are allowed.

### Syntax

- `*` at the start of a line begins a comment; `;` and `$` begin inline comments.
- A line starting with `+` continues the previous line.
- **Title line:** in classic SPICE the first line is always a title. ElecMap detects it automatically: the first line is a title only if it does not parse as an element. Force it with `compile(src, { spice: { titleLine: true } })`, or use `.title My circuit`.
- `.end` stops parsing. Other directives (`.ac`, `.tran`, `.op`…) are ignored and reported in `circuit.parserWarnings`. `.subckt` is not supported yet.
- The ground node is `0`; `gnd` and `GND` are aliases. Use `compile(src, { ground: "ref" })` to pick another name.

## Canonical JSON format

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

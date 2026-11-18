# Component catalogue

Every component of the canonical JSON format, with its SPICE letter, port order and fields. The same information is available at runtime through `COMPONENT_CATALOG`.

Sign conventions follow SPICE: a two-terminal component's current is counted **from its first node to its second node through the component**.

## Passive components

| Type        | SPICE | `nodes`  | Fields                                      |
| ----------- | ----- | -------- | ------------------------------------------- |
| `resistor`  | `R`   | `[a, b]` | `value` (Ω, > 0)                            |
| `capacitor` | `C`   | `[a, b]` | `value` (F, > 0), `ic?` initial voltage (V) |
| `inductor`  | `L`   | `[a, b]` | `value` (H, > 0), `ic?` initial current (A) |
| `coupling`  | `K`   | —        | `inductors: [L1, L2]`, `k` in (0, 1]        |

Coupled inductors have a mutual inductance `M = k·√(L1·L2)`. With `k = 1` and the right turns ratio they model an ideal transformer.

## Independent sources

| Type      | SPICE | `nodes`  | Fields                                     |
| --------- | ----- | -------- | ------------------------------------------ |
| `vsource` | `V`   | `[p, n]` | `dc?`, `ac?: { mag, phase? }`, `waveform?` |
| `isource` | `I`   | `[p, n]` | `dc?`, `ac?: { mag, phase? }`, `waveform?` |

- Voltage source: `V(p) − V(n) = value`.
- Current source: the current flows from `p` to `n` **through the source**, i.e. it is injected into node `n`.
- `waveform` is one of `sine`, `pulse`, `pwl`, `step`, `exp` (see [format.md](./format.md#elements)).

## Controlled sources

| Type   | SPICE | `nodes`  | Control               | Relation                       |
| ------ | ----- | -------- | --------------------- | ------------------------------ |
| `vcvs` | `E`   | `[p, n]` | `control: [cp, cn]`   | `V(p,n) = gain · V(cp,cn)`     |
| `vccs` | `G`   | `[p, n]` | `control: [cp, cn]`   | `I(p→n) = gain · V(cp,cn)` (S) |
| `cccs` | `F`   | `[p, n]` | `controlSource: "Vx"` | `I(p→n) = gain · I(Vx)`        |
| `ccvs` | `H`   | `[p, n]` | `controlSource: "Vx"` | `V(p,n) = gain · I(Vx)` (Ω)    |

The controlling current of `cccs` / `ccvs` is the current through an independent voltage source (use a 0 V source as an ammeter, as in SPICE).

## Active and switching components

| Type     | SPICE        | `nodes`           | Fields                                                     |
| -------- | ------------ | ----------------- | ---------------------------------------------------------- |
| `opamp`  | `X… OPAMP`   | `[in+, in-, out]` | `gain?` open-loop gain, `gbw?` gain-bandwidth product (Hz) |
| `switch` | `S… ON\|OFF` | `[a, b]`          | `closed`, `ron?` (default 0), `roff?` (default ∞)          |

- **Op-amp:** ideal (virtual short between the inputs, infinite input impedance, zero output impedance) when `gain` is omitted. With `gain`, the output is `A·(V+ − V−)`; adding `gbw` gives a single-pole model `A / (1 + s·A/(2π·GBW))`. The output is referenced to ground.
- **Switch:** a fixed-state switch, useful to compare configurations. It is not voltage-controlled.

## Planned (non-linear)

Diodes, Zener diodes, BJTs and MOSFETs (with `.model` cards) will come with the non-linear solver.

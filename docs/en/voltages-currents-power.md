---
title: Voltages, currents and power
category: Guides
---

# Voltages, currents and power

All examples on this page use the same RC circuit:

```ts
import { ElecMap } from "elecmap";

const rc = new ElecMap(`
V1 in 0 DC 5 AC 1
R1 in out 1k
C1 out 0 100n
`);
```

<figure class="em-figure">
{@include ./figures/rc-lowpass.svg}
</figure>

## DC or AC? The last argument decides

| Call                                | Analysis                                                | Result           |
| ----------------------------------- | ------------------------------------------------------- | ---------------- |
| `rc.voltage("out")`                 | DC operating point (capacitors open, inductors shorted) | `number` (V)     |
| `rc.voltage("out", { freq: 1000 })` | AC steady state at 1 kHz                                | `Complex` phasor |

## Voltage at a node

```ts
rc.voltage("out"); // 5
rc.voltage("out", { freq: 1000 }).abs(); // 0.8467
```

The voltage of a single node is measured **against the ground** (`0`).

## Voltage between two nodes

```ts
rc.voltage("in", "out"); // 0        V(in) − V(out), DC
rc.voltage("in", "out", { freq: 1000 }).toString(); // "0.283043199675 + 0.450477243368j"
```

## Current in a component

```ts
rc.current("R1"); // 0
rc.current("C1", { freq: 1000 }).toString(); // "0.000283043199675 + 0.000450477243368j"
```

> The current is counted **from the first node to the second node** of the component, as written in the netlist. `R1 in out` → positive when it flows from `in` to `out`.

## Drive only one source, or change its amplitude

When the circuit has several AC sources, all of them are active by default. Choose one with `input`, and scale it with `amplitude`:

```ts
rc.current("C1", { freq: 1000, input: "V1", amplitude: 2 }).toString();
// "0.00056608639935 + 0.000900954486737j"   (twice the previous value)
```

## Everything at once

### DC operating point

```ts
const op = rc.operatingPoint();
op.nodeVoltages(); // { "0": 0, in: 5, out: 5 }
op.currents(); // { V1: 0, R1: 0, C1: 0 }
```

### AC solution at one frequency

```ts
const ac = rc.ac(1000);
ac.voltage("out").abs(); // 0.8467
ac.current("R1").abs(); // 0.000532
```

### Frequency sweep

```ts
const sweep = rc.acSweep({ fStart: 100, fStop: 10e3, points: 1 }); // 1 point per decade
sweep.freqs; // [100, 1000, 10000]
sweep.voltage("out").map((v) => v.abs()); // [0.998, 0.8467, 0.1572]
```

`points` is per decade (`scale: "log"`, the default) or in total (`scale: "linear"`).

## Power

```ts
const dc = new ElecMap(`
V1 in 0 DC 10
R1 in out 1k
R2 out 0 4k
`);
dc.power(); // { V1: -0.02, R1: 0.004, R2: 0.016 }   (W, sources are negative)
```

In AC, `power` returns the complex power `S = P + jQ` of each component:

```ts
const s = rc.power({ freq: 1000 });
s.R1.toString(); // "0.000141521599838"           (W, active only)
s.C1.toString(); // "0 - 0.000225238621684j"      (var, reactive only)
```

The sum over all components is always zero: what the sources give, the others take.

## Parametric changes

```ts
const divider = new ElecMap(`
V1 in 0 DC 10
R1 in out 1k
R2 out 0 1k
`);
for (const r of [1e3, 2e3, 3e3]) {
  divider.setValue("R2", r);
  console.log(r, divider.voltage("out")); // 1000 5, 2000 6.667, 3000 7.5
}
```

`setValue` invalidates the cached results, so the next call recomputes.

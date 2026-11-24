---
title: Getting started
category: Guides
---

# Getting started

This page goes from an empty project to a solved circuit in five minutes. Every snippet runs as is; the comments show the actual output.

## Install

```sh
npm install elecmap
```

ElecMap has no dependencies and works the same in Node.js (≥ 18) and in the browser, with `import` or `require`.

## A first circuit

A circuit is written as a **SPICE netlist**: one component per line, `name node node value`. Node `0` is the ground.

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
<figcaption>The circuit above, drawn by <code>rc.toSVG({ showValues: true })</code></figcaption>
</figure>

Read each line as:

| Line                | Meaning                                                                          |
| ------------------- | -------------------------------------------------------------------------------- |
| `V1 in 0 DC 5 AC 1` | voltage source between `in` and ground: 5 V in DC, 1 V amplitude for AC analyses |
| `R1 in out 1k`      | 1 kΩ resistor between `in` and `out`                                             |
| `C1 out 0 100n`     | 100 nF capacitor between `out` and ground                                        |

Values accept engineering suffixes: `f p n u m k meg g t` (`4k7` = 4.7 kΩ, `100n` = 100 nF).

## Ask questions

### A DC voltage

```ts
rc.voltage("out"); // 5          (volts, capacitor = open circuit)
rc.current("R1"); // 0           (amperes)
```

### An AC voltage, at a given frequency

```ts
const v = rc.voltage("out", { freq: 1000 }); // Complex phasor
v.toString(); // "0.716956800325 - 0.450477243368j"
v.abs(); // 0.8467      (amplitude, V)
(v.arg() * 180) / Math.PI; // -32.14   (phase, degrees)
```

### The transfer function

```ts
const H = rc.transferFunction("out"); // V(out) / V1
H.toLatex(); // "\frac{1}{1 + 10^{-4}\,s}"
H.cutoffFrequency(); // 1591.55 (Hz)
H.filterType(); // "lowpass"
```

<div class="em-math">H(s) = \frac{1}{1 + 10^{-4}\,s}</div>

### The same, with symbols

```ts
rc.symbolicTransferFunction("out").toLatex(); // "\frac{1}{1 + R_{1} C_{1} s}"
```

<div class="em-math">H(s) = \frac{1}{1 + R_{1} C_{1} s}</div>

### A Bode plot

```ts
const bode = H.bode({ fStart: 10, fStop: 1e6 });
// bode.freq, bode.magnitudeDb, bode.phase: arrays ready for your chart library
```

<figure class="em-figure">
{@include ./figures/rc-bode.svg}
<figcaption><code>bode.magnitudeDb</code> and <code>bode.phase</code> against <code>bode.freq</code></figcaption>
</figure>

### What happens over time

```ts
const step = H.stepResponse({ tStop: 0.5e-3, points: 6 });
step.value; // [0, 0.5654, 0.8111, 0.9179, 0.9643, 0.9845, 0.9933]
H.stepInfo().riseTime; // 0.0002197  (s, 10 % → 90 %)
```

## Change a value and recompute

```ts
const divider = new ElecMap(`
V1 in 0 DC 10
R1 in out 1k
R2 out 0 1k
`);
divider.voltage("out"); // 5
divider.setValue("R2", 3000);
divider.voltage("out"); // 7.5
```

## Prefer JSON?

The same circuit can be given as a JSON object (handy when it comes from an editor or a database):

```ts
const rc = new ElecMap({
  version: 1,
  components: [
    { id: "V1", type: "vsource", nodes: ["in", "0"], dc: 5, ac: { mag: 1 } },
    { id: "R1", type: "resistor", nodes: ["in", "out"], value: 1000 },
    { id: "C1", type: "capacitor", nodes: ["out", "0"], value: 100e-9 },
  ],
});
rc.toSpice(); // back to a netlist
```

See [Netlists & JSON](./format.md) for the full syntax.

## When something is wrong

Every error is an {@link ElecMapError} with a stable `code`:

```ts
import { ElecMap, ElecMapError } from "elecmap";

try {
  new ElecMap(["V1 a 0 1", "V2 a 0 2", "R1 a 0 1k"].join("\n"));
} catch (e) {
  if (e instanceof ElecMapError) {
    e.code; // "INVALID_CIRCUIT"
    e.message; // "Invalid circuit: V2 closes a loop made only of voltage sources / ideal shorts"
  }
}
```

## Next steps

- [Voltages, currents & power](./voltages-currents-power.md): every way to measure the circuit.
- [Transfer functions](./transfer-functions.md): filters, Bode, poles, responses to sines.
- [Schematics](./schematics.md): drawing options and interactivity.

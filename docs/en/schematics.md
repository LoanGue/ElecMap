---
title: Schematics
category: Guides
---

# Schematics

`toSVG()` draws the circuit automatically: no coordinates to give, no external library. Every drawing on this site comes from it.

## One line

```ts
import { ElecMap } from "elecmap";

const amp = new ElecMap(`
V1 in 0 AC 1
R1 in n 1k
Rf n out 10k
X1 0 n out OPAMP
RL out 0 10k
`);

const svg = amp.toSVG({ showValues: true }); // a standalone <svg> string
document.body.innerHTML = svg; // in a browser
// or: fs.writeFileSync("amp.svg", svg) in Node.js
```

<figure class="em-figure">
{@include ./figures/inverting-iec.svg}
<figcaption><code>amp.toSVG({ showValues: true })</code></figcaption>
</figure>

## IEC or ANSI symbols

```ts
amp.toSVG({ style: "ansi", showValues: true }); // zig-zag resistors, +/− on sources
```

<figure class="em-figure">
{@include ./figures/inverting-ansi.svg}
<figcaption><code>style: "ansi"</code></figcaption>
</figure>

## Highlight components and nodes

```ts
filter.toSVG({ highlight: ["C1", "out"], nodeLabels: true });
```

<figure class="em-figure">
{@include ./figures/highlight.svg}
<figcaption>C1 and the <code>out</code> node in the accent colour; every node named</figcaption>
</figure>

## Close the circuit, or not

By default the grounds are joined by a rail along the bottom, which closes the circuit like in a textbook: the current loop is visible at a glance. When a ground cannot reach that rail by a straight drop (an op-amp input buried in the circuit, a bridge…), each grounded pin gets its own ground symbol instead, which keeps big circuits readable. Force either drawing with `ground`:

```ts
const ladder = new ElecMap(`
V1 in 0 AC 1
R1 in a 1k
C1 a 0 100n
R2 a out 1k
C2 out 0 100n
`);

ladder.toSVG(); // ground: "auto": the rail here
ladder.toSVG({ ground: "symbols" }); // one ground symbol per grounded pin
ladder.toSVG({ ground: "rail" }); // always the rail, routed around obstacles if needed
```

<figure class="em-figure">
{@include ./figures/ground-rail.svg}
<figcaption><code>ground: "rail"</code> (what <code>"auto"</code> picks here)</figcaption>
</figure>
<figure class="em-figure">
{@include ./figures/ground-symbols.svg}
<figcaption><code>ground: "symbols"</code></figcaption>
</figure>

The rail is the ground node's wire: it carries `data-node="0"` like any other node.

## All the options

```ts
circuit.toSVG({
  style: "iec", // "iec" (default) or "ansi"
  showValues: true, // "10 kΩ", "AC 1 V"…
  showIds: true, // "R1", "C2"…
  nodeLabels: "named", // true: all nodes, false: none, "named": hides numeric SPICE nodes
  highlight: ["R1", "out"], // component ids and/or node names
  ground: "auto", // "rail" (closed circuit), "symbols", or "auto": the rail when it stays clean
  theme: "auto", // "light", "dark", "auto" (follows the system) or "none"
  scale: 20, // pixels per grid unit
  background: false, // fill the background
  title: "My filter", // <title>, read by screen readers
});
```

With `theme: "none"` the SVG has no colours of its own: style it from your page with CSS (this site does).

## Make it interactive

Every element carries `data-*` attributes:

```html
<g class="c" data-id="R1" data-type="resistor">…</g> <path class="w" data-node="out" d="…" />
```

```ts
container.innerHTML = circuit.toSVG();
container.addEventListener("click", (event) => {
  const target = event.target as Element;
  const id = target.closest("[data-id]")?.getAttribute("data-id");
  const node = target.closest("[data-node]")?.getAttribute("data-node");
  if (id) console.log("current in", id, circuit.current(id, { freq: 1000 }).abs());
  if (node) console.log("voltage at", node, circuit.voltage(node, { freq: 1000 }).abs());
});
```

## More examples

<div class="em-row">
<figure class="em-figure">
{@include ./figures/transformer.svg}
<figcaption>Coupled inductors (<code>K1 L1 L2 0.99</code>)</figcaption>
</figure>
<figure class="em-figure">
{@include ./figures/rlc.svg}
<figcaption>Series RLC</figcaption>
</figure>
</div>

## Use the layout yourself

To draw with your own tools (canvas, React, a schematic editor), take the placement instead of the SVG:

```ts
const layout = amp.layout();
layout.components; // [{ id, type, x, y, orientation, pins: [{ node, x, y }] }, …]
layout.nets; // wires: segments and junction dots per node
layout.grounds; // ground symbols
amp.layout({ ground: "symbols" }); // same options as toSVG for the ground
layout.bounds; // size of the drawing, in grid units
```

How it works: nodes are ordered from the source to the output, components to the ground hang vertically, feedback goes above, and wires are routed on a grid so that two different nodes never touch. Details in [Algorithms](./algorithms.md#schematic-layout).

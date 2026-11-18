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

## All the options

```ts
circuit.toSVG({
  style: "iec", // "iec" (default) or "ansi"
  showValues: true, // "10 kΩ", "AC 1 V"…
  showIds: true, // "R1", "C2"…
  nodeLabels: "named", // true: all nodes, false: none, "named": hides numeric SPICE nodes
  highlight: ["R1", "out"], // component ids and/or node names
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
layout.bounds; // size of the drawing, in grid units
```

How it works: nodes are ordered from the source to the output, components to the ground hang vertically, feedback goes above, and wires are routed on a grid so that two different nodes never touch. Details in [Algorithms](./algorithms.md#schematic-layout).

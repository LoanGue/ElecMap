---
title: Schémas
category: Guides
---

# Schémas

`toSVG()` dessine le circuit automatiquement : aucune coordonnée à fournir, aucune bibliothèque externe. Tous les dessins de ce site en sont issus.

## Une ligne

```ts
import { ElecMap } from "elecmap";

const amp = new ElecMap(`
V1 in 0 AC 1
R1 in n 1k
Rf n out 10k
X1 0 n out OPAMP
RL out 0 10k
`);

const svg = amp.toSVG({ showValues: true }); // une chaîne <svg> autonome
document.body.innerHTML = svg; // dans un navigateur
// ou : fs.writeFileSync("amp.svg", svg) sous Node.js
```

<figure class="em-figure">
{@include ./figures/inverting-iec.svg}
<figcaption><code>amp.toSVG({ showValues: true })</code></figcaption>
</figure>

## Symboles CEI ou ANSI

```ts
amp.toSVG({ style: "ansi", showValues: true }); // résistances en zigzag, +/− sur les sources
```

<figure class="em-figure">
{@include ./figures/inverting-ansi.svg}
<figcaption><code>style: "ansi"</code></figcaption>
</figure>

## Mettre en évidence des composants et des nœuds

```ts
filter.toSVG({ highlight: ["C1", "out"], nodeLabels: true });
```

<figure class="em-figure">
{@include ./figures/highlight.svg}
<figcaption>C1 et le nœud <code>out</code> dans la couleur d'accent ; tous les nœuds sont nommés</figcaption>
</figure>

## Toutes les options

```ts
circuit.toSVG({
  style: "iec", // "iec" (par défaut) ou "ansi"
  showValues: true, // "10 kΩ", "AC 1 V"…
  showIds: true, // "R1", "C2"…
  nodeLabels: "named", // true : tous les nœuds, false : aucun, "named" : masque les nœuds SPICE numériques
  highlight: ["R1", "out"], // identifiants de composants et/ou noms de nœuds
  theme: "auto", // "light", "dark", "auto" (suit le système) ou "none"
  scale: 20, // pixels par unité de grille
  background: false, // remplir l'arrière-plan
  title: "My filter", // <title>, lu par les lecteurs d'écran
});
```

Avec `theme: "none"`, le SVG n'a pas de couleurs propres : stylez-le depuis votre page en CSS (c'est ce que fait ce site).

## Le rendre interactif

Chaque élément porte des attributs `data-*` :

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

## Autres exemples

<div class="em-row">
<figure class="em-figure">
{@include ./figures/transformer.svg}
<figcaption>Bobines couplées (<code>K1 L1 L2 0.99</code>)</figcaption>
</figure>
<figure class="em-figure">
{@include ./figures/rlc.svg}
<figcaption>RLC série</figcaption>
</figure>
</div>

## Utiliser le placement vous-même

Pour dessiner avec vos propres outils (canvas, React, un éditeur de schémas), récupérez le placement au lieu du SVG :

```ts
const layout = amp.layout();
layout.components; // [{ id, type, x, y, orientation, pins: [{ node, x, y }] }, …]
layout.nets; // fils : segments et points de jonction par nœud
layout.grounds; // symboles de masse
layout.bounds; // taille du dessin, en unités de grille
```

Principe : les nœuds sont ordonnés de la source vers la sortie, les composants reliés à la masse pendent verticalement, la contre-réaction passe au-dessus, et les fils sont routés sur une grille de sorte que deux nœuds différents ne se touchent jamais. Détails dans [Algorithmes](./algorithms.md#placement-des-schémas).

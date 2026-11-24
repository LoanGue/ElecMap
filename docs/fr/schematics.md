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

## Fermer le circuit, ou non

Par défaut, les masses sont reliées par une ligne en bas du schéma, qui ferme le circuit comme dans un manuel : la boucle du courant se voit d'un coup d'œil. Quand une masse ne peut pas rejoindre cette ligne par une descente droite (entrée d'amplificateur opérationnel au milieu du circuit, pont…), chaque broche reliée à la masse reçoit son propre symbole, ce qui garde les grands circuits lisibles. Imposez l'un ou l'autre rendu avec `ground` :

```ts
const ladder = new ElecMap(`
V1 in 0 AC 1
R1 in a 1k
C1 a 0 100n
R2 a out 1k
C2 out 0 100n
`);

ladder.toSVG(); // ground: "auto" : la ligne de masse ici
ladder.toSVG({ ground: "symbols" }); // un symbole de masse par broche reliée à la masse
ladder.toSVG({ ground: "rail" }); // toujours la ligne, contournant les obstacles si besoin
```

<figure class="em-figure">
{@include ./figures/ground-rail.svg}
<figcaption><code>ground: "rail"</code> (le choix de <code>"auto"</code> ici)</figcaption>
</figure>
<figure class="em-figure">
{@include ./figures/ground-symbols.svg}
<figcaption><code>ground: "symbols"</code></figcaption>
</figure>

La ligne de masse est le fil du nœud de masse : elle porte `data-node="0"` comme n'importe quel autre nœud.

## Toutes les options

```ts
circuit.toSVG({
  style: "iec", // "iec" (par défaut) ou "ansi"
  showValues: true, // "10 kΩ", "AC 1 V"…
  showIds: true, // "R1", "C2"…
  nodeLabels: "named", // true : tous les nœuds, false : aucun, "named" : masque les nœuds SPICE numériques
  highlight: ["R1", "out"], // identifiants de composants et/ou noms de nœuds
  ground: "auto", // "rail" (circuit fermé), "symbols", ou "auto" : la ligne quand elle reste propre
  theme: "auto", // "light", "dark", "auto" (suit le système) ou "none"
  scale: 20, // pixels par unité de grille
  background: false, // remplir l'arrière-plan
  title: "My filter", // <title>, lu par les lecteurs d'écran
});
```

Avec `theme: "none"`, le SVG n'a pas de couleurs propres : stylez-le depuis la page en CSS (c'est ce que fait ce site).

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

## Utiliser le placement directement

Pour dessiner avec des outils personnalisés (canvas, React, un éditeur de schémas), récupérez le placement au lieu du SVG :

```ts
const layout = amp.layout();
layout.components; // [{ id, type, x, y, orientation, pins: [{ node, x, y }] }, …]
layout.nets; // fils : segments et points de jonction par nœud
layout.grounds; // symboles de masse
amp.layout({ ground: "symbols" }); // mêmes options de masse que toSVG
layout.bounds; // taille du dessin, en unités de grille
```

Principe : les nœuds sont ordonnés de la source vers la sortie, les composants reliés à la masse pendent verticalement, la contre-réaction passe au-dessus, et les fils sont routés sur une grille de sorte que deux nœuds différents ne se touchent jamais. Détails dans [Algorithmes](./algorithms.md#placement-des-schémas).

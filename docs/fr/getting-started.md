---
title: Premiers pas
category: Guides
---

# Premiers pas

Cette page vous mène d'un projet vide à un circuit résolu en cinq minutes. Chaque extrait s'exécute tel quel ; les commentaires montrent la sortie réelle.

## Installation

```sh
npm install elecmap
```

ElecMap n'a aucune dépendance et fonctionne de la même façon sous Node.js (≥ 18) et dans le navigateur, avec `import` ou `require`.

## Votre premier circuit

Un circuit s'écrit sous forme de **netlist SPICE** : un composant par ligne, `nom nœud nœud valeur`. Le nœud `0` est la masse.

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
<figcaption>Le circuit ci-dessus, dessiné par <code>rc.toSVG({ showValues: true })</code></figcaption>
</figure>

Chaque ligne se lit ainsi :

| Ligne               | Signification                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `V1 in 0 DC 5 AC 1` | source de tension entre `in` et la masse : 5 V en continu, amplitude de 1 V pour les analyses AC |
| `R1 in out 1k`      | résistance de 1 kΩ entre `in` et `out`                                                           |
| `C1 out 0 100n`     | condensateur de 100 nF entre `out` et la masse                                                   |

Les valeurs acceptent les suffixes d'ingénieur : `f p n u m k meg g t` (`4k7` = 4,7 kΩ, `100n` = 100 nF).

## Poser des questions

### Une tension continue

```ts
rc.voltage("out"); // 5          (volts, condensateur = circuit ouvert)
rc.current("R1"); // 0           (ampères)
```

### Une tension alternative, à une fréquence donnée

```ts
const v = rc.voltage("out", { freq: 1000 }); // phaseur Complex
v.toString(); // "0.716956800325 - 0.450477243368j"
v.abs(); // 0.8467      (amplitude, V)
(v.arg() * 180) / Math.PI; // -32.14   (phase, degrés)
```

### La fonction de transfert

```ts
const H = rc.transferFunction("out"); // V(out) / V1
H.toLatex(); // "\frac{1}{1 + 10^{-4}\,s}"
H.cutoffFrequency(); // 1591.55 (Hz)
H.filterType(); // "lowpass"
```

<div class="em-math">H(s) = \frac{1}{1 + 10^{-4}\,s}</div>

### La même, avec des symboles

```ts
rc.symbolicTransferFunction("out").toLatex(); // "\frac{1}{1 + R_{1} C_{1} s}"
```

<div class="em-math">H(s) = \frac{1}{1 + R_{1} C_{1} s}</div>

### Un diagramme de Bode

```ts
const bode = H.bode({ fStart: 10, fStop: 1e6 });
// bode.freq, bode.magnitudeDb, bode.phase : tableaux prêts pour votre bibliothèque de graphiques
```

<figure class="em-figure">
{@include ./figures/rc-bode.svg}
<figcaption><code>bode.magnitudeDb</code> et <code>bode.phase</code> en fonction de <code>bode.freq</code></figcaption>
</figure>

### Ce qui se passe au cours du temps

```ts
const step = H.stepResponse({ tStop: 0.5e-3, points: 6 });
step.value; // [0, 0.5654, 0.8111, 0.9179, 0.9643, 0.9845, 0.9933]
H.stepInfo().riseTime; // 0.0002197  (s, 10 % → 90 %)
```

## Changer une valeur et recalculer

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

## Vous préférez le JSON ?

Le même circuit peut être fourni sous forme d'objet JSON (pratique lorsqu'il provient d'un éditeur ou d'une base de données) :

```ts
const rc = new ElecMap({
  version: 1,
  components: [
    { id: "V1", type: "vsource", nodes: ["in", "0"], dc: 5, ac: { mag: 1 } },
    { id: "R1", type: "resistor", nodes: ["in", "out"], value: 1000 },
    { id: "C1", type: "capacitor", nodes: ["out", "0"], value: 100e-9 },
  ],
});
rc.toSpice(); // retour à une netlist
```

Voir [Netlists et JSON](./format.md) pour la syntaxe complète.

## Quand quelque chose ne va pas

Chaque erreur est une {@link ElecMapError} avec un `code` stable :

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

## Pour aller plus loin

- [Tensions, courants et puissance](./voltages-currents-power.md) : toutes les façons de mesurer le circuit.
- [Fonctions de transfert](./transfer-functions.md) : filtres, Bode, pôles, réponses aux sinusoïdes.
- [Schémas](./schematics.md) : options de dessin et interactivité.

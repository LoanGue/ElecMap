---
title: Tensions, courants et puissance
category: Guides
---

# Tensions, courants et puissance

Tous les exemples de cette page utilisent le même circuit RC :

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

## Continu ou alternatif ? Le dernier argument décide

| Appel                               | Analyse                                                                           | Résultat          |
| ----------------------------------- | --------------------------------------------------------------------------------- | ----------------- |
| `rc.voltage("out")`                 | point de fonctionnement continu (condensateurs ouverts, bobines court-circuitées) | `number` (V)      |
| `rc.voltage("out", { freq: 1000 })` | régime sinusoïdal établi à 1 kHz                                                  | phaseur `Complex` |

## Tension en un nœud

```ts
rc.voltage("out"); // 5
rc.voltage("out", { freq: 1000 }).abs(); // 0.8467
```

La tension d'un nœud seul est mesurée **par rapport à la masse** (`0`).

## Tension entre deux nœuds

```ts
rc.voltage("in", "out"); // 0        V(in) − V(out), continu
rc.voltage("in", "out", { freq: 1000 }).toString(); // "0.283043199675 + 0.450477243368j"
```

## Courant dans un composant

```ts
rc.current("R1"); // 0
rc.current("C1", { freq: 1000 }).toString(); // "0.000283043199675 + 0.000450477243368j"
```

> Le courant est compté **du premier nœud vers le second nœud** du composant, tels qu'écrits dans la netlist. `R1 in out` → positif lorsqu'il circule de `in` vers `out`.

## N'activer qu'une source, ou changer son amplitude

Lorsque le circuit comporte plusieurs sources AC, elles sont toutes actives par défaut. Choisissez-en une avec `input`, et mettez-la à l'échelle avec `amplitude` :

```ts
rc.current("C1", { freq: 1000, input: "V1", amplitude: 2 }).toString();
// "0.00056608639935 + 0.000900954486737j"   (le double de la valeur précédente)
```

## Tout d'un coup

### Point de fonctionnement continu

```ts
const op = rc.operatingPoint();
op.nodeVoltages(); // { "0": 0, in: 5, out: 5 }
op.currents(); // { V1: 0, R1: 0, C1: 0 }
```

### Solution AC à une fréquence

```ts
const ac = rc.ac(1000);
ac.voltage("out").abs(); // 0.8467
ac.current("R1").abs(); // 0.000532
```

### Balayage en fréquence

```ts
const sweep = rc.acSweep({ fStart: 100, fStop: 10e3, points: 1 }); // 1 point par décade
sweep.freqs; // [100, 1000, 10000]
sweep.voltage("out").map((v) => v.abs()); // [0.998, 0.8467, 0.1572]
```

`points` est donné par décade (`scale: "log"`, par défaut) ou au total (`scale: "linear"`).

## Puissance

```ts
const dc = new ElecMap(`
V1 in 0 DC 10
R1 in out 1k
R2 out 0 4k
`);
dc.power(); // { V1: -0.02, R1: 0.004, R2: 0.016 }   (W, les sources sont négatives)
```

En alternatif, `power` renvoie la puissance complexe `S = P + jQ` de chaque composant :

```ts
const s = rc.power({ freq: 1000 });
s.R1.toString(); // "0.000141521599838"           (W, active uniquement)
s.C1.toString(); // "0 - 0.000225238621684j"      (var, réactive uniquement)
```

La somme sur tous les composants est toujours nulle : ce que les sources fournissent, les autres le consomment.

## Variations paramétriques

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

`setValue` invalide les résultats en cache, de sorte que l'appel suivant recalcule.

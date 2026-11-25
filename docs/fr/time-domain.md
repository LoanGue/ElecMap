---
title: Domaine temporel
category: Guides
---

# Domaine temporel

Deux outils complémentaires :

| Outil                               | Ce qu'il fait                            | Idéal pour                                                      |
| ----------------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| `H.stepResponse()`, `H.response()`… | réponse exacte calculée à partir de H(s) | une entrée, une sortie, état initial nul                        |
| `circuit.transient()`               | simulation pas à pas du circuit complet  | toutes les tensions et tous les courants, formes d'onde réelles |

## Réponse indicielle

```ts
import { ElecMap } from "elecmap";

const rlc = new ElecMap(`
V1 in 0 AC 1
R1 in a 20
L1 a out 10m
C1 out 0 1u
`);
const H = rlc.transferFunction("out");

const step = H.stepResponse({ tStop: 2e-3 });
step.time; // s
step.value; // V(out) quand V1 passe de 0 à 1 V
```

Les grandeurs qui la caractérisent :

```ts
H.stepInfo();
// {
//   finalValue: 1,
//   peak: 1.7286,          valeur maximale
//   peakTime: 0.00032,     s
//   overshoot: 72.86,      %
//   riseTime: 0.000111,    s, 10 % → 90 %
//   settlingTime: 0.00384  s, à 2 % de la valeur finale
// }
```

## Réponse impulsionnelle

```ts
const rc = new ElecMap(`
V1 in 0 AC 1
R1 in out 1k
C1 out 0 100n
`).transferFunction("out");

rc.impulseResponse({ tStop: 2e-4, points: 3 }).value;
// [10000, 5134.2, 2636.0, 1353.4]    h(t) = (1/RC)·e^(−t/RC)
```

Si H(s) a une transmission directe (même degré au numérateur et au dénominateur), sa partie de Dirac est renvoyée séparément dans `impulse`.

## Réponse à un signal d'entrée quelconque

```ts
const sine = (t: number) => Math.sin(2 * Math.PI * 1000 * t);
const out = rc.response(sine, { tStop: 3e-3, points: 300 });
// out.time, out.value : inclut le régime transitoire de démarrage, contrairement à apply()
```

## Simulation transitoire

`transient` simule le circuit complet. Les sources conservent la forme d'onde écrite dans la netlist (`SIN`, `PULSE`, `PWL`, `EXP`) :

<figure class="em-figure">
{@include ./figures/rlc.svg}
</figure>

```ts
const circuit = new ElecMap(`
V1 in 0 PULSE(0 1 0 1n 1n 0.5m 1m)
R1 in a 20
L1 a out 10m
C1 out 0 1u
`);

const tr = circuit.transient({ tStop: 2e-3, tStep: 2e-6 });
tr.time; // s
tr.voltage("out"); // V, une valeur par instant
tr.current("L1"); // A
tr.power("R1"); // W
```

<figure class="em-figure">
{@include ./figures/rlc-transient.svg}
<figcaption>La simulation (orange) coïncide avec la réponse indicielle exacte calculée à partir de H(s) (pointillés) jusqu'à la retombée de l'entrée à 0,5 ms</figcaption>
</figure>

### Options

```ts
circuit.transient({
  tStop: 10e-3, // instant final (s)
  tStep: 1e-6, // pas de temps (s), par défaut tStop / 1000
  method: "gear2", // "gear2" (par défaut), "trap" ou "euler"
  initial: "op", // partir du point de fonctionnement continu ("op"), des valeurs IC= ("ic"), ou "auto"
  inputs: {
    // remplacer une source : objet forme d'onde, constante, ou toute fonction du temps
    V1: { kind: "pulse", v1: 0, v2: 5, width: 1e-3, period: 2e-3 },
  },
});
```

### Conditions initiales

Les condensateurs et les bobines acceptent une valeur initiale avec `IC=` :

```ts
const discharge = new ElecMap(`
R1 a 0 1k
C1 a 0 1u IC=5
`);
const d = discharge.transient({ tStop: 5e-3 });
d.voltage("a"); // part de 5 V, décroît avec τ = 1 ms
```

## Saturation d'un AOP : un trigger de Schmitt

`VSAT=v` (ou `VPOS=v VNEG=v`) borne la sortie d'un AOP : elle sature progressivement entre les rails, un élément non linéaire résolu par Newton-Raphson. Dans un trigger de Schmitt inverseur, la réaction positive `R1`, `R2` place les seuils à `±VSAT·R1/(R1 + R2) = ±7,5 V` :

```ts
const netlist = (v1: string) => `
V1 n1 0 ${v1}
R3 in n1 1k
X1 n2 in out OPAMP VSAT=15
R2 n2 out 1k
R1 n2 0 1k
`;
new ElecMap(netlist("DC 5")).operatingPoint().voltage("out"); // -15.000025
new ElecMap(netlist("DC -5")).operatingPoint().voltage("out"); // 15.000025

const r = new ElecMap(netlist("SIN(0 10 1)")).transient({ tStop: 2, tStep: 1e-3 });
const vin = r.voltage("n1");
const out = r.voltage("out");
r.time
  .map((t, i) => [t, vin[i], out[i]])
  .filter(([, , o], i) => i > 1 && Math.sign(o) !== Math.sign(out[i - 1]));
// [[0.635, -7.5, 15], [1.135, 7.5, -15], [1.635, -7.5, 15]]   (s, V, V; rounded)
```

- Dans la bande d'hystérésis, les deux sorties sont solutions. Le calcul DC part de 0 V : la sortie va au rail opposé à l'entrée.
- Un AOP idéal avec rails utilise un gain en boucle ouverte de 10⁶. Aucune dynamique supplémentaire n'est nécessaire : chaque résolution de Newton part de la réponse en boucle ouverte aux entrées, donc la sortie bascule en un pas de temps au franchissement d'un seuil.
- Avec `GBW`, la sortie suit le pôle `A/(2π·GBW)` derrière un étage de gain saturé : sa vitesse de balayage vaut environ `VSAT·2π·GBW/A` (940 V/s pour `GAIN=1e5 GBW=1e6`).
- Les analyses petit signal sont linéarisées au point de fonctionnement : un AOP saturé a un gain d'environ 0.

```ts
const amp = new ElecMap("V1 p 0 10\nX1 p m out OPAMP GAIN=1e5 VSAT=15\nR2 m out 1k\nR1 m 0 1k");
amp.operatingPoint().voltage("out"); // 15.0000005
amp.transferFunction("out").dcGain(); // 2e-7
```

## Formes d'onde

| SPICE                                       | `kind` JSON | Forme                                         |
| ------------------------------------------- | ----------- | --------------------------------------------- |
| `SIN(offset amplitude freq …)`              | `sine`      | sinusoïde, retard et amortissement optionnels |
| `PULSE(v1 v2 delay rise fall width period)` | `pulse`     | train d'impulsions trapézoïdales              |
| `PWL(t1 v1 t2 v2 …)`                        | `pwl`       | linéaire par morceaux                         |
| `EXP(v1 v2 td1 tau1 td2 tau2)`              | `exp`       | montée et descente exponentielles             |
| JSON uniquement                             | `step`      | échelon de `v1` à `v2` à l'instant `delay`    |

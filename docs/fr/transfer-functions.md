---
title: Fonctions de transfert
category: Guides
---

# Fonctions de transfert

Une fonction de transfert H(s) relie une sortie (une tension, un courant) à une source d'entrée. ElecMap la calcule exactement à partir du circuit, sous la forme d'un rapport de deux polynômes en `s`.

## Obtenir H(s)

```ts
import { ElecMap } from "elecmap";

const filter = new ElecMap(`
V1 in 0 AC 1
R1 in a 10k
R2 a b 10k
C1 a out 22n
C2 b 0 10n
X1 b out out OPAMP
`);

const H = filter.transferFunction("out"); // V(out) / V1
```

<figure class="em-figure">
{@include ./figures/sallen-key.svg}
<figcaption>Un filtre passe-bas de Sallen-Key (<code>X1</code> est un amplificateur opérationnel idéal : <code>X1 in+ in- out OPAMP</code>)</figcaption>
</figure>

### Choisir l'entrée et la sortie

```ts
filter.transferFunction("out"); // V(out) / l'unique source AC
filter.transferFunction({ input: "V1", output: "out" }); // entrée explicite
filter.transferFunction({ input: "V1", output: ["a", "b"] }); // V(a) − V(b)
filter.transferFunction({ input: "V1", output: { current: "R1" } }); // I(R1) / V1 (admittance)
```

### Entre deux tensions du circuit

L'entrée peut aussi être la tension d'un nœud plutôt qu'une source : `H = V(out) / V(in)`. Le circuit reste alimenté par sa source ; le chemin de la source jusqu'à `in` se simplifie.

```ts
const stage = new ElecMap(`
V1 s 0 AC 1
R0 s in 470
R1 in out 1k
C1 out 0 100n`);
const H = stage.transferFunction({ input: { voltage: "in" }, output: "out" });
H.toString(); // "V(out)/V(in): (1) / (1 + 0.0001·s)"
H.cutoffFrequency(); // 1591.55
stage
  .transferFunction({ input: { voltage: ["in", "out"], source: "V1" }, output: "out" })
  .toString(); // "V(out)/V(in,out): (10000) / (s)", V(C1) / V(R1) : un intégrateur
```

La tension doit dépendre de la source ; sinon le rapport n'est pas défini et une erreur `INVALID_ARGUMENT` est levée.
Quand le circuit a une seule source AC, c'est elle qui attaque, comme pour une entrée de type source.

Sans `source`, un circuit à plusieurs sources fonctionne aussi : chaque source qui atteint la tension d'entrée est essayée, et le rapport est retenu quand toutes donnent le même. C'est le cas de sources en série, par exemple des harmoniques additionnées dans `ve`. Quand le rapport dépend de la source qui attaque, une erreur `INVALID_ARGUMENT` nomme les sources et `source` doit être précisé.

```ts
const sum = new ElecMap(`
V1 ve m SIN(0 1 1k) AC 1
V2 m 0 SIN(0 0.33 3k) AC 1
R1 ve out 1k
C1 out 0 1u`);
sum.transferFunction({ input: { voltage: "ve" }, output: "out" }).toString();
// "V(out)/V(ve): (1) / (1 + 0.001·s)"
```

## L'afficher en LaTeX

```ts
H.toLatex();
// "\frac{1}{1 + \left(2 \times 10^{-4}\right) s + \left(2.2 \times 10^{-8}\right) s^{2}}"
```

<div class="em-math">\frac{1}{1 + \left(2 \times 10^{-4}\right) s + \left(2.2 \times 10^{-8}\right) s^{2}}</div>

Les options changent la présentation, jamais la valeur :

```ts
const rc = new ElecMap(`
V1 in 0 AC 1
R1 in out 1k
C1 out 0 100n
`).transferFunction("out");

rc.toLatex(); // "\frac{1}{1 + 10^{-4}\,s}"
rc.toLatex({ name: "H(s)", normalize: "monic" }); // "H(s) = \frac{10^{4}}{s + 10^{4}}"
rc.toLatex({ order: "descending" }); // "\frac{1}{10^{-4}\,s + 1}"
rc.toLatex({ variable: "p", digits: 3 }); // autre nom de variable, 3 chiffres significatifs
rc.toString(); // "V(out)/V1: (1) / (1 + 0.0001·s)"
```

## Évaluer à une fréquence

```ts
rc.evaluate(1000).toString(); // "0.716956800325 - 0.450477243368j"   H(j·2π·1000)
rc.magnitude(1000); // 0.8467
rc.magnitudeDb(1000); // -1.445   (dB)
rc.phase(1000); // -32.14   (degrés)
```

## Diagramme de Bode

```ts
const bode = H.bode({ fStart: 10, fStop: 1e5, points: 30 }); // 30 points par décade
bode.freq; // Hz
bode.magnitudeDb; // dB
bode.phase; // degrés, déroulée (pas de sauts de ±180°)
```

<figure class="em-figure">
{@include ./figures/sallen-key-bode.svg}
<figcaption>Diagramme de Bode du filtre de Sallen-Key pour trois valeurs de C1 (voir les <a href="./literal-transfer-functions.md">fonctions de transfert littérales</a> pour recalculer H(s) pour chacune)</figcaption>
</figure>

Sans argument, `bode()` choisit une plage autour des pôles et des zéros.

## Caractéristiques du filtre

```ts
H.filterType(); // "lowpass"
H.naturalFrequency(); // 1073.0   f₀ (Hz)
H.qFactor(); // 0.742
H.dampingRatio(); // 0.674
H.cutoffFrequency(); // 1122.9   −3 dB (Hz)
H.dcGain(); // 1
H.highFrequencyGain(); // 0
```

Pour un passe-bande, il y a deux fréquences de coupure :

```ts
const bandPass = new ElecMap(`
V1 in 0 AC 1
C1 in a 100n
R1 a 0 10k
R2 a out 10k
C2 out 0 1n
`).transferFunction("out");

bandPass.filterType(); // "bandpass"
bandPass.cutoffFrequencies(); // [154.6, 16388]
bandPass.peakFrequency(); // 1591.5
bandPass.peakGain(); // 0.980
```

`filterType()` renvoie l'une des valeurs `"lowpass"`, `"highpass"`, `"bandpass"`, `"bandstop"`, `"allpass"`, `"flat"`, `"other"`.

## Pôles et zéros

```ts
const rlc = new ElecMap(`
V1 in 0 AC 1
R1 in a 20
L1 a out 10m
C1 out 0 1u
`).transferFunction("out");

rlc.poles().map(String); // ["-1000 - 9949.87437107j", "-1000 + 9949.87437107j"]   (rad/s)
rlc.zeros(); // []
rlc.isStable(); // true   (tous les pôles dans le demi-plan gauche)
rlc.timeConstants(); // [0.001]   (s, 1/|Re p|)
rlc.order; // 2
```

### Avertissement de réaction positive

Un AOP idéal n'a pas de dynamique : la fonction de transfert d'un circuit en réaction positive paraît stable, ce trigger de Schmitt donne `H = 2`. `transferWarnings` (mêmes arguments que `transferFunction`) calcule la même fonction avec chaque AOP idéal en `GAIN=1e5 GBW=1e6`, et renvoie un avertissement `POSITIVE_FEEDBACK` si elle a des pôles à partie réelle positive. Le panneau Transfert du playground l'affiche.

```ts
const schmitt = new ElecMap(`
V1 n1 0 1
R3 in n1 1k
X1 n2 in out OPAMP
R2 n2 out 1k
R1 n2 0 1k
`);
schmitt.transferFunction("out").dcGain(); // 2
schmitt.transferWarnings("out");
// [{ severity: "warning", code: "POSITIVE_FEEDBACK", componentId: "X1",
//    message: "Unstable with a real op-amp (X1 as GAIN=1e5 GBW=1e6): positive feedback, the linear result has no physical meaning" }]
```

## Réponse à une sinusoïde

`apply` donne la sortie en régime établi pour une sinusoïde (ou une somme de sinusoïdes) en entrée :

```ts
const out = rc.apply({ amplitude: 2, freq: 1000, phase: 0 });
out.components[0].amplitude; // 1.693   (V)
out.components[0].phase; // -32.14  (degrés)
out.at(0.25e-3); // 1.434   valeur à t = 0.25 ms
```

Une somme de sinusoïdes se passe sous forme de tableau, éventuellement avec une composante continue :

```ts
rc.apply({
  offset: 1,
  components: [
    { amplitude: 1, freq: 100 },
    { amplitude: 1, freq: 10_000 }, // filtrée
  ],
});
```

Pour les régimes transitoires (échelons, impulsions, tout signal), voir [Domaine temporel](./time-domain.md).

---
title: Fonctions de transfert littérales
category: Guides
---

# Fonctions de transfert littérales

Au lieu de nombres, obtenez H(s) écrite avec les noms des composants, comme dans un manuel. Le résultat est exact, et des valeurs peuvent y être réinjectées à tout moment.

## Du circuit à la formule

```ts
import { ElecMap } from "elecmap";

const rc = new ElecMap(`
V1 in 0 AC 1
R1 in out 1k
C1 out 0 100n
`);

rc.symbolicTransferFunction("out").toLatex(); // "\frac{1}{1 + R_{1} C_{1} s}"
```

<div class="em-math">H(s) = \frac{1}{1 + R_{1} C_{1} s}</div>

Cela fonctionne pour tout circuit linéaire. Le filtre de Sallen-Key :

<figure class="em-figure">
{@include ./figures/sallen-key.svg}
</figure>

```ts
const filter = new ElecMap(`
V1 in 0 AC 1
R1 in a 10k
R2 a b 10k
C1 a out 22n
C2 b 0 10n
X1 b out out OPAMP
`);

const H = filter.symbolicTransferFunction("out");
H.toLatex({ name: "H(s)" });
```

<div class="em-math">H(s) = \frac{1}{1 + C_{2} \left(R_{1} + R_{2}\right) s + R_{1} R_{2} C_{1} C_{2} s^{2}}</div>

L'amplificateur inverseur donne le bien connu `−Rf/R1` :

```ts
new ElecMap(`
V1 in 0 AC 1
R1 in n 1k
Rf n out 10k
X1 0 n out OPAMP
`)
  .symbolicTransferFunction("out")
  .toLatex(); // "-\frac{R_{f}}{R_{1}}"
```

<div class="em-math">-\frac{R_{f}}{R_{1}}</div>

## Texte brut

```ts
H.toString();
// "V(out)/V1 = (1) / (1 + s*R1*C2 + s*R2*C2 + s^2*R1*R2*C1*C2)"
```

## Réinjecter des valeurs

`substitute` transforme la formule en une {@link TransferFunction} numérique. Les composants non mentionnés conservent leur valeur de la netlist :

```ts
const tuned = H.substitute({ C1: 20e-9 });
tuned.qFactor(); // 0.7071   (Butterworth)
tuned.naturalFrequency(); // 1125.4  (Hz)
tuned.bode(); // et toutes les autres méthodes de TransferFunction
```

C'est la façon la plus rapide d'explorer une conception : la formule est calculée une seule fois, puis chaque `substitute` est instantané.

<figure class="em-figure">
{@include ./figures/sallen-key-bode.svg}
<figcaption>Trois valeurs de C1, trois appels à <code>substitute</code></figcaption>
</figure>

## Ne garder littéraux que certains composants

Les autres composants sont remplacés par leur valeur :

```ts
filter.symbolicTransferFunction({ output: "out", symbols: ["C1", "C2"] }).toLatex();
```

<div class="em-math">\frac{1}{1 + \left(2 \times 10^{4}\right) C_{2} s + 10^{8} C_{1} C_{2} s^{2}}</div>

Cela garde aussi les grands circuits rapides : le coût croît avec le nombre de symboles.

## Renommer les symboles

```ts
filter.symbolicTransferFunction({ output: "out", names: { R1: "R_a", R2: "R_b" } }).toLatex();
// utilise R_a et R_b au lieu de R_{1} et R_{2}
```

## Puissances décroissantes

```ts
H.toLatex({ order: "descending" });
```

<div class="em-math">\frac{1}{R_{1} R_{2} C_{1} C_{2} s^{2} + C_{2} \left(R_{1} + R_{2}\right) s + 1}</div>

## Impédance littérale

```ts
new ElecMap(`
V1 in 0 AC 1
R1 in a 1k
R2 a 0 2k
C1 a 0 1u
`)
  .symbolicImpedance("a")
  .toLatex();
```

<div class="em-math">Z(s) = \frac{R_{1} R_{2}}{R_{1} + R_{2} + R_{1} R_{2} C_{1} s}</div>

L'impédance est vue entre `a` et la masse, sources éteintes (V1 devient un fil, donc R1 se retrouve en parallèle avec R2 et C1).

## Noms des symboles

| Composant                    | Symbole                            |
| ---------------------------- | ---------------------------------- |
| `R1`, `L1`, `C1`, `Rf`       | `R_{1}`, `L_{1}`, `C_{1}`, `R_{f}` |
| couplage `K1`                | inductance mutuelle `M_{K1}`       |
| `E1` (VCVS), `H1` (CCVS)     | `A_{E1}`, `r_{H1}`                 |
| `G1` (VCCS), `F1` (CCCS)     | `g_{G1}`, `\beta_{F1}`             |
| ampli-op `X1 … GAIN=… GBW=…` | `A_{X1}`, `\omega_{X1}`            |

Un amplificateur opérationnel réel fait apparaître la bande passante :

```ts
new ElecMap(`
V1 in 0 AC 1
R1 in n 1k
Rf n out 10k
X1 0 n out OPAMP GAIN=1e5 GBW=1e6
`)
  .symbolicTransferFunction("out")
  .toLatex();
```

<div class="em-math">-\frac{R_{f} A_{X1} \omega_{X1}}{\omega_{X1} \left(R_{1} + R_{f} + R_{1} A_{X1}\right) + \left(R_{1} + R_{f}\right) s}</div>

## Limites

- Les facteurs communs constitués d'un seul terme (`R_{1}`, `2`, `s`…) sont simplifiés ; un facteur comme `(1 + R_{1} C_{1} s)` partagé par le numérateur et le dénominateur ne l'est pas.
- Jusqu'à environ 30 inconnues. Au-delà, ne gardez littéraux que les composants intéressants avec `symbols`.

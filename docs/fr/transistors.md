---
title: Transistors
category: Guides
---

# Transistors

ElecMap simule les deux transistors classiques avec les modèles SPICE de tous les manuels :

| Composant                | Ligne SPICE                 | Modèle                                              |
| ------------------------ | --------------------------- | --------------------------------------------------- |
| bipolaire, `NPN` / `PNP` | `Q<nom> c b e [modèle]`     | Ebers-Moll (forme transport) avec effet Early       |
| MOSFET, `NMOS` / `PMOS`  | `M<nom> d g s [b] [modèle]` | Shichman-Hodges (niveau 1 SPICE), effet de substrat |

Comme les diodes, ils rendent le circuit non linéaire : le point de fonctionnement et les régimes transitoires sont résolus par Newton-Raphson, et les analyses petits signaux (`ac`, `transferFunction`, `impedance`, Thévenin) utilisent le transistor linéarisé à son point de repos. Tout ce que dit le [guide des diodes](./diodes.md#convergence) sur la convergence s'applique ici aussi.

## Un étage émetteur commun

La polarisation classique à quatre résistances : un pont fixe la base, RE stabilise le courant de collecteur.

```ts
import { ElecMap } from "elecmap";

const stage = new ElecMap(`
VCC vcc 0 12
RB1 vcc b 47k
RB2 b 0 10k
RC vcc c 2.2k
RE e 0 470
Q1 c b e Q2N2222
.model Q2N2222 NPN(IS=14.34f BF=255.9 VAF=74.03 CJE=22p CJC=7.3p)
`);

const op = stage.operatingPoint();
op.voltage("b"); // 2.0177 V
op.voltage("e"); // 1.3461 V    un VBE sous la base
op.voltage("c"); // 5.7227 V
op.voltage("c", "e"); // 4.3766 V    VCE : régime linéaire (actif direct)
op.iterations; // 6
```

<figure class="em-figure">
{@include ./figures/ce-stage.svg}
</figure>

### Courants des bornes

`current("Q1")` est le courant de collecteur. Les autres bornes s'obtiennent avec `"Q1:<borne>"`, par lettre ou par nom. Chaque courant de borne **entre** dans le composant, leur somme est donc nulle :

```ts
op.current("Q1"); // 0.0028533 A    collecteur (comme "Q1:c" ou "Q1:collector")
op.current("Q1:b"); // 0.000010619 A  base
op.current("Q1:e"); // -0.0028639 A   émetteur : le courant sort
op.current("Q1") / op.current("Q1:b"); // 268.71    β, BF augmenté par l'effet Early
op.power("Q1"); // 0.012495 W      Σ V(borne)·I(borne)
```

Les bornes sont `c`/`collector`, `b`/`base`, `e`/`emitter` pour un BJT et `d`/`drain`, `g`/`gate`, `s`/`source`, `b`/`bulk` pour un MOSFET.

### Gain petits signaux

Ajoutons une source, un condensateur de liaison et un condensateur de découplage d'émetteur : la fonction de transfert est calculée autour du point de fonctionnement, où le transistor est une transconductance `gm = Ic / V_T` avec ses capacités de jonction.

```ts
const amp = new ElecMap(`
VCC vcc 0 12
VS in 0 AC 1
CIN in b 10u
RB1 vcc b 47k
RB2 b 0 10k
RC vcc c 2.2k
RE e 0 470
CE e 0 100u
Q1 c b e Q2N2222
.model Q2N2222 NPN(IS=14.34f BF=255.9 VAF=74.03 CJE=22p CJC=7.3p)
`);

const H = amp.transferFunction({ input: "VS", output: "c" });
H.evaluate(10e3).abs(); // 224.43       47,0 dB, proche de gm·(RC ∥ ro)
H.evaluate(10e3).arg() * (180 / Math.PI); // -179.05°    inverseur
amp.inputImpedance("VS").evaluate(10e3).abs(); // 1869.7 Ω  RB1 ∥ RB2 ∥ rπ
amp.outputImpedance("c").evaluate(10e3).abs(); // 2035.5 Ω  RC ∥ ro
```

<figure class="em-figure">
{@include ./figures/ce-bode.svg}
<figcaption>La bande va d'environ 170 Hz (condensateurs de liaison et de découplage) à environ 19 MHz (CJC de la jonction collecteur polarisée en inverse, multipliée par le gain : l'effet Miller)</figcaption>
</figure>

Un transitoire montre ce que le modèle petits signaux ne peut pas voir : avec 2 mV en entrée, la sortie varie de 0,9 V crête à crête autour de son point de repos, et une entrée plus forte est déformée.

```ts
const tr = new ElecMap(amp.toSpice().replace("AC 1", "SIN(0 2m 10k)")).transient({
  tStop: 0.6e-3,
  tStep: 0.5e-6,
});
const vc = tr.voltage("c").slice(800); // après le régime de démarrage
Math.max(...vc); // 6.164 V
Math.min(...vc); // 5.2669 V
```

### PNP

Un PNP est l'image miroir : émetteur côté rail positif, courants et tensions inversés. Les signes suivent la même convention (courant entrant dans la borne) :

```ts
const pnp = new ElecMap(`
VCC vcc 0 12
RB1 vcc b 10k
RB2 b 0 47k
RE vcc e 470
RC c 0 2.2k
Q1 c b e Q2N2907
.model Q2N2907 PNP(IS=650.6E-18 BF=231.7 VAF=115.7)
`);

const p = pnp.operatingPoint();
p.voltage("e", "b"); // 0.75035 V    VEB
p.voltage("c"); // 5.8871 V
p.current("Q1"); // -0.0026759 A  le courant de collecteur sort du composant
p.current("Q1:e"); // 0.0026871 A  le courant d'émetteur y entre
```

### Paramètres du BJT

| SPICE | JSON  | Signification                                     | Défaut  |
| ----- | ----- | ------------------------------------------------- | ------- |
| `IS`  | `is`  | courant de saturation de transport (A)            | `1e-16` |
| `BF`  | `bf`  | gain en courant direct β                          | `100`   |
| `BR`  | `br`  | gain en courant inverse                           | `1`     |
| `NF`  | `nf`  | coefficient d'émission direct                     | `1`     |
| `NR`  | `nr`  | coefficient d'émission inverse                    | `1`     |
| `VAF` | `vaf` | tension d'Early directe (V), `VA` accepté         | ∞       |
| `VAR` | `var` | tension d'Early inverse (V), `VB` accepté         | ∞       |
| `CJE` | `cje` | capacité base-émetteur à polarisation nulle (F)   | `0`     |
| `VJE` | `vje` | potentiel de la jonction base-émetteur (V)        | `0.75`  |
| `MJE` | `mje` | coefficient de gradualité base-émetteur           | `0.33`  |
| `CJC` | `cjc` | capacité base-collecteur à polarisation nulle (F) | `0`     |
| `VJC` | `vjc` | potentiel de la jonction base-collecteur (V)      | `0.75`  |
| `MJC` | `mjc` | coefficient de gradualité base-collecteur         | `0.33`  |
| `TF`  | `tf`  | temps de transit direct (s)                       | `0`     |
| `TR`  | `tr`  | temps de transit inverse (s)                      | `0`     |
| `FC`  | `fc`  | coefficient de capacité en direct                 | `0.5`   |

Les courants sont ceux du modèle Gummel-Poon de SPICE sans forte injection ni résistances série :

<div class="em-math">I_C = \left(I_{BE} - I_{BC}\right)\left(1 - \frac{V_{BC}}{V_{AF}} - \frac{V_{BE}}{V_{AR}}\right) - \frac{I_{BC}}{B_R}, \qquad I_B = \frac{I_{BE}}{B_F} + \frac{I_{BC}}{B_R}, \qquad I_{BE} = I_S\left(e^{V_{BE}/N_F V_T} - 1\right)</div>

Un nœud de substrat optionnel (`Q1 c b e sub QMOD`) est ignoré avec un avertissement ; un facteur de surface après le nom du modèle multiplie `IS`, `CJE` et `CJC`. `PE`, `ME`, `PC` et `MC` sont acceptés pour `VJE`, `MJE`, `VJC` et `MJC`.

Chaque jonction stocke une charge de déplétion qui dépend de sa tension, comme pour une [diode](./diodes.md#capacité-de-jonction-et-temps-de-transit), plus les charges de diffusion `TF·I_BE` (base-émetteur) et `TR·I_BC` (base-collecteur). En petits signaux, `TF` ajoute `TF·gm` à la capacité base-émetteur et fixe la fréquence de transition `f_T ≈ 1 / (2π·TF)` à fort courant.

## Un étage MOSFET source commune

Un MOSFET s'écrit `M<nom> drain grille source [substrat] modèle`, avec la largeur `W` et la longueur `L` du canal sur la ligne. Sans nœud de substrat, le substrat est relié à la source.

```ts
const cs = new ElecMap(`
VDD vdd 0 10
VG g 0 DC 3 AC 1
RD vdd d 4.7k
M1 d g 0 0 NMOD W=100u L=10u
.model NMOD NMOS(VTO=1.5 KP=50u LAMBDA=0.02)
`);

const m = cs.operatingPoint();
m.current("M1"); // 0.0006411 A   courant de drain : ½·KP·W/L·(VGS − VTO)²·(1 + λ·VDS)
m.voltage("d"); // 6.9868 V      VDS > VGS − VTO : saturation
m.current("M1:g"); // 0 A         aucun courant de grille
m.power("M1"); // 0.0044793 W

cs.transferFunction({ input: "VG", output: "d" }).dcGain(); // -3.8158   −gm·(RD ∥ ro)
```

<figure class="em-figure">
{@include ./figures/cs-stage.svg}
</figure>

### Effet de substrat

Avec un nœud de substrat propre, une tension source-substrat inverse élève le seuil (`GAMMA`, `PHI`). Ici le substrat est 2 V sous la source :

```ts
const body = new ElecMap(`
VDD vdd 0 10
VG g 0 3
VSB 0 sub 2
RD vdd d 4.7k
M1 d g 0 sub NMOS VTO=1.5 KP=50u W=100u L=10u GAMMA=0.4
`);

body.operatingPoint().current("M1"); // 0.00033922 A   au lieu de 0.0005625 A
body.operatingPoint().current("M1:b"); // 0 A            le substrat ne consomme rien
```

Quand le substrat diffère de la source, le schéma le dessine comme une quatrième broche.

### Paramètres du MOSFET

| SPICE    | JSON     | Signification                                                               | Défaut |
| -------- | -------- | --------------------------------------------------------------------------- | ------ |
| `VTO`    | `vto`    | tension de seuil (V), négative pour un PMOS à enrichissement, `VT0` accepté | `0`    |
| `KP`     | `kp`     | paramètre de transconductance μ·Cox (A/V²)                                  | `2e-5` |
| `LAMBDA` | `lambda` | modulation de longueur de canal (1/V)                                       | `0`    |
| `GAMMA`  | `gamma`  | coefficient d'effet de substrat (√V)                                        | `0`    |
| `PHI`    | `phi`    | potentiel de surface (V)                                                    | `0.6`  |
| `CGSO`   | `cgso`   | capacité de recouvrement grille-source par largeur (F/m)                    | `0`    |
| `CGDO`   | `cgdo`   | capacité de recouvrement grille-drain par largeur (F/m)                     | `0`    |
| `W`      | `w`      | largeur du canal (m), sur la ligne d'instance                               | `100u` |
| `L`      | `l`      | longueur du canal (m), sur la ligne d'instance                              | `100u` |

Avec `β = KP·W/L` et `V_{th} = VTO + γ(\sqrt{Φ − V_{BS}} − \sqrt{Φ})` :

<div class="em-math">I_D = \begin{cases} 0 & V_{GS} \le V_{th} \\ \beta\left(V_{GS} - V_{th} - \tfrac{V_{DS}}{2}\right) V_{DS}\,(1 + \lambda V_{DS}) & V_{DS} < V_{GS} - V_{th} \\ \tfrac{\beta}{2}\left(V_{GS} - V_{th}\right)^2 (1 + \lambda V_{DS}) & \text{sinon} \end{cases}</div>

Le composant est symétrique : quand `V_DS < 0`, drain et source échangent leurs rôles. Seul `LEVEL=1` est pris en charge ; `AD`, `AS`, `PD`, `PS`, `NRD`, `NRS` sont acceptés et ignorés avec un avertissement.

## Un inverseur CMOS

Un PMOS et un NMOS en série entre l'alimentation et la masse, grilles reliées. Les paramètres peuvent être écrits sur la ligne au lieu d'une carte `.model` : les mots-clés seuls `NPN`, `PNP`, `NMOS`, `PMOS` désignent un modèle par défaut.

```ts
const inv = new ElecMap(`
VDD vdd 0 5
VIN in 0 0
MP out in vdd vdd PMOS VTO=-0.7 KP=50u W=20u L=1u
MN out in 0 0 NMOS VTO=0.7 KP=110u W=10u L=1u
`);

for (const v of [0, 2, 2.5, 3, 5]) inv.setValue("VIN", v).voltage("out");
// 5   4.552   1.257   0.3626   1.057e-9
```

<figure class="em-figure">
{@include ./figures/cmos-inverter.svg}
</figure>

<figure class="em-figure">
{@include ./figures/cmos-transfer.svg}
<figcaption>Caractéristique de transfert et courant d'alimentation, obtenus par balayage avec <code>setValue</code> : le courant est maximal quand les deux transistors conduisent</figcaption>
</figure>

Avec un condensateur de charge et une entrée `PULSE`, `transient()` donne les fronts de commutation :

```ts
const edge = new ElecMap(`
VDD vdd 0 5
VIN in 0 PULSE(0 5 1n 0.1n 0.1n 5n 10n)
MP out in vdd vdd PMOS VTO=-0.7 KP=50u W=20u L=1u
MN out in 0 0 NMOS VTO=0.7 KP=110u W=10u L=1u
CL out 0 100f
`).transient({ tStop: 10e-9, tStep: 0.02e-9 });

// instant où V(out) passe par 2,5 V après un instant donné
const v = edge.voltage("out");
const crossing = (after: number) => {
  const i = edge.time.findIndex((t, k) => t > after && (v[k - 1] - 2.5) * (v[k] - 2.5) <= 0);
  const [t0, t1, v0, v1] = [edge.time[i - 1], edge.time[i], v[i - 1], v[i]];
  return t0 + ((2.5 - v0) / (v1 - v0)) * (t1 - t0);
};
crossing(0) - 1.05e-9; // 4.7e-11 s    t_pHL : le NMOS décharge CL
crossing(5e-9) - 6.05e-9; // 1.5e-10 s  t_pLH : le PMOS, plus faible, la charge
```

## En JSON et en SPICE

Les transistors sont des composants comme les autres ; le nom du modèle est conservé pour que `toSpice()` réécrive la carte `.model` :

```ts
cs.toJSON().components[3];
// { id: "M1", type: "mosfet", nodes: ["d", "g", "0", "0"], polarity: "nmos",
//   model: "NMOD", vto: 1.5, kp: 0.00005, lambda: 0.02, w: 0.0001, l: 0.00001 }

cs.toSpice();
// VDD vdd 0 DC 10
// VG g 0 DC 3 AC 1
// RD vdd d 4.7k
// M1 d g 0 0 NMOD W=100u L=10u
// .model NMOD NMOS(VTO=1.5 KP=50u LAMBDA=20m)
```

Les champs JSON sont listés dans la [référence des composants](./components.md) ; un BJT a `nodes: [c, b, e]` et `polarity: "npn" | "pnp"`, un MOSFET `nodes: [d, g, s, b]` et `polarity: "nmos" | "pmos"`.

## Limites

- Les capacités `CGSO` et `CGDO` du MOSFET sont constantes ; les résistances de base et d'émetteur, les effets de forte injection et les capacités de Meyer du MOSFET ne sont pas modélisés.
- Les MOSFET suivent uniquement le niveau 1 : pas de conduction sous le seuil, pas de saturation de vitesse.
- Les fonctions de transfert littérales ne sont pas disponibles pour les circuits à transistors :

```ts
cs.symbolicTransferFunction({ input: "VG", output: "d" });
// ElecMapError UNSUPPORTED: Symbolic analysis of a non-linear circuit (M1) is not supported:
// use the numeric transferFunction, linearised at the operating point
```

---
title: Sources comportementales
category: Guides
---

# Sources comportementales

Une source comportementale (SPICE `B`) est une tension ou un courant donné par **n'importe quelle expression** des tensions et courants du circuit : multiplieur, élévation au carré, transconductance en `tanh`, amplificateur logarithmique, gain commandé en tension… Elle modélise une fonction sans dessiner les transistors qui la réalisent.

```text
Bnom n+ n- V=expression     tension V(n+) − V(n-)
Bnom n+ n- I=expression     courant de n+ vers n- à travers la source
```

Comme les diodes et les transistors, une source `B` rend le circuit non linéaire : le continu et les transitoires sont résolus par Newton-Raphson, et les analyses petit signal utilisent l'expression linéarisée au point de repos.

## Une première source comportementale

Une élévation au carré : `V(out) = V(in)² / 2`.

```ts
import { ElecMap } from "elecmap";

const squarer = new ElecMap(`
V1 in 0 DC 3 AC 1
R1 in 0 1k
B1 out 0 V=V(in)^2/2
RL out 0 1k
`);

squarer.voltage("out"); // 4.5 V       3² / 2
squarer.current("B1"); // -0.0045 A    circule de out vers 0 à travers B1 : elle alimente RL
squarer.operatingPoint().iterations; // 4
```

<figure class="em-figure">
{@include ./figures/behavioral-squarer.svg}
</figure>

Le courant d'une source `B` suit la convention de toutes les sources : positif de `n+` vers `n-` **à travers la source**. Ici B1 fournit 4,5 mA à RL, son courant vaut donc −4,5 mA.

### Petit signal

Autour de son point de repos, l'élévation au carré est un gain égal à la pente de `V²/2`, c'est-à-dire `V(in)` = 3 :

```ts
squarer.transferFunction({ input: "V1", output: "out" }).dcGain(); // 3
```

Toutes les analyses utilisent automatiquement la linéarisation : `ac`, `transferFunction`, `impedance`, `thevenin`, `sensitivity`…

## Écrire une expression

| Élément                                           | Sens                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `V(a)`, `V(a,b)`                                  | tension du nœud `a`, tension entre `a` et `b`                                                                 |
| `I(id)`                                           | courant d'un composant : source, bobine, résistance, source commandée, sortie d'AOP, diode, autre source `B`… |
| `time`                                            | temps (s), 0 hors analyse transitoire                                                                         |
| `1k`, `26m`, `pi`, `e`                            | nombres avec suffixes SPICE, constantes                                                                       |
| `+ - * / ^`                                       | arithmétique (`**` est aussi une puissance), `-2^2` = −4                                                      |
| `< <= > >= == != && \|\| !`                       | comparaisons et logique : 1 si vrai, 0 sinon                                                                  |
| `sqrt exp ln log log10 abs`                       | `log` est le logarithme népérien, comme `ln`                                                                  |
| `sin cos tan asin acos atan atan2 sinh cosh tanh` | fonctions trigonométriques et hyperboliques                                                                   |
| `min max pow limit if`                            | `limit(x, lo, hi)` borne `x`, `if(c, a, b)` vaut `a` quand `c ≠ 0`                                            |
| `u uramp sgn floor ceil round`                    | `u(x)` est l'échelon unité, `uramp(x) = max(x, 0)`                                                            |

`I(id)` accepte les composants dont le courant est une combinaison des inconnues du circuit. Un condensateur (son courant dépend de `dV/dt`) et une source de courant indépendante (son courant est connu) sont refusés : mesurez-les avec une source de 0 V en série, comme en SPICE.

```ts
const meter = new ElecMap(`
V1 a 0 10
RL a 0 50
BP pw 0 V=V(a)*I(RL)
`);
meter.voltage("pw"); // 2    la puissance de RL (W), sous forme de tension
```

Les paramètres (`.param`, paramètres de sous-circuit) sont remplacés par leur valeur à la lecture de la netlist, avec ou sans accolades. Les sous-circuits renomment leurs sondes comme leurs nœuds :

```ts
const log = new ElecMap(`
.param GAIN=10
.subckt LOGAMP in out PARAMS: IS=1n
B1 out 0 V=-26m*ln(V(in)/(10k*{IS}))
.ends
V1 a 0 1
X1 a y LOGAMP IS=10n
B2 z 0 V={GAIN}*V(y)
R1 z 0 1k
R2 y 0 1k
`);
log.components()[1]; // { id: "X1.B1", type: "bsource", kind: "voltage", expression: "-0.026*ln(V(a)/0.0001)", … }
log.voltage("y"); // -0.23947 V    −26 mV · ln(10⁴)
log.voltage("z"); // -2.3947 V
```

En JSON, une source comportementale s'écrit `{ "type": "bsource", "nodes": [p, n], "kind": "voltage" | "current", "expression": "…" }`.

## Une source de courant : la transconductance

Le courant d'une paire différentielle est une `tanh` de sa tension d'entrée. En source `B` :

```ts
const ota = new ElecMap(`
VIN in 0 0
B1 0 out I=1m*tanh(V(in)/52m)
RL out 0 10k
`);

ota.transferFunction({ input: "VIN", output: "out" }).dcGain(); // 192.31    gm·RL = (1 mA / 52 mV) · 10 kΩ
ota.setValue("VIN", 0.1);
ota.voltage("out"); // 9.5817 V     proche de la saturation (10 V)
ota.transferFunction({ input: "VIN", output: "out" }).dcGain(); // 15.752    le gain s'effondre
```

Le gain petit signal est la pente de la caractéristique de transfert en chaque point de repos :

<figure class="em-figure">
{@include ./figures/behavioral-ota.svg}
</figure>

## Multiplieurs : modulation et gain variable

Une expression peut multiplier deux signaux. En temporel, c'est un modulateur d'amplitude :

```ts
const am = new ElecMap(`
VC c 0 SIN(0 1 10k)
VM m 0 SIN(0 1 500)
B1 am 0 V=(1+0.5*V(m))*V(c)
R1 am 0 1k
`);
const tr = am.transient({ tStop: 4e-3, tStep: 5e-6 });
Math.max(...tr.voltage("am")); // 1.4985 V    crête de l'enveloppe 1 + 0,5
```

<figure class="em-figure">
{@include ./figures/behavioral-am.svg}
</figure>

En petit signal, le gain depuis une entrée est la valeur continue de l'autre : un amplificateur à gain commandé en tension.

```ts
const vca = new ElecMap(`
VIN in 0 DC 0 AC 1
VCTRL ctrl 0 2
B1 out 0 V=V(ctrl)*V(in)
RL out 0 10k
`);
vca.transferFunction({ input: "VIN", output: "out" }).dcGain(); // 2       = V(ctrl)
vca.transferFunction({ input: "VCTRL", output: "out" }).dcGain(); // 0     = V(in), 0 V en continu
vca.setValue("VCTRL", 0.5).transferFunction({ input: "VIN", output: "out" }).dcGain(); // 0.5
```

## Fonctions du temps

`time` fait d'une source `B` un générateur arbitraire. Il vaut 0 en continu : le point de repos voit la valeur à t = 0.

```ts
const burst = new ElecMap(`
B1 out 0 V=sin(2*pi*1k*time)*exp(-time/1m)
R1 out 0 1k
`);
burst.voltage("out"); // 0    à t = 0
burst.transient({ tStop: 3e-3, tStep: 1e-5 }).voltage("out")[25]; // 0.7788    t = 0,25 ms : e^−0,25
```

## Convergence

Newton-Raphson a besoin de la pente de l'expression, qu'ElecMap calcule exactement (différentiation automatique). Quelques habitudes l'aident :

- **Préférez les fonctions lisses.** `if`, `u`, `sgn`, `floor`… ont une pente nulle et un saut : Newton ne les « voit » pas venir. `tanh(x/ε)` ou `limit` font une commutation plus douce.
- **Attention au domaine.** `ln`, `sqrt`, `1/x` ne sont pas définies partout. Quand une itération en sort (`ln 0` à la première itération, où toutes les tensions valent 0), la source garde sa dernière valeur et Newton continue, mais une expression qui reste hors du domaine ne peut pas converger : `ln(max(V(a), 1n))` est plus sûr.
- **Gardez un chemin continu.** Comme pour toute source, une source de courant `B` seule sur un nœud laisse sa tension indéterminée.

Un circuit comportemental n'a pas de fonction de transfert littérale : `symbolicTransferFunction` le refuse, tandis que la `transferFunction` numérique fonctionne autour du point de repos.

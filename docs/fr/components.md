# Catalogue des composants

Chaque composant du format JSON canonique, avec sa lettre SPICE, l'ordre de ses bornes et ses champs. Les mêmes informations sont disponibles à l'exécution via `COMPONENT_CATALOG`.

Les conventions de signe suivent SPICE : le courant d'un dipôle est compté **de son premier nœud vers son second nœud à travers le composant**.

## Composants passifs

| Type        | SPICE | `nodes`  | Champs                                       |
| ----------- | ----- | -------- | -------------------------------------------- |
| `resistor`  | `R`   | `[a, b]` | `value` (Ω, > 0)                             |
| `capacitor` | `C`   | `[a, b]` | `value` (F, > 0), `ic?` tension initiale (V) |
| `inductor`  | `L`   | `[a, b]` | `value` (H, > 0), `ic?` courant initial (A)  |
| `coupling`  | `K`   | —        | `inductors: [L1, L2]`, `k` dans (0, 1]       |

Les bobines couplées ont une inductance mutuelle `M = k·√(L1·L2)`. Avec `k = 1` et le bon rapport de transformation, elles modélisent un transformateur idéal.

## Sources indépendantes

| Type      | SPICE | `nodes`  | Champs                                     |
| --------- | ----- | -------- | ------------------------------------------ |
| `vsource` | `V`   | `[p, n]` | `dc?`, `ac?: { mag, phase? }`, `waveform?` |
| `isource` | `I`   | `[p, n]` | `dc?`, `ac?: { mag, phase? }`, `waveform?` |

- Source de tension : `V(p) − V(n) = value`.
- Source de courant : le courant circule de `p` vers `n` **à travers la source**, c'est-à-dire qu'il est injecté dans le nœud `n`.
- `waveform` est l'une des formes `sine`, `pulse`, `pwl`, `step`, `exp` (voir [format.md](./format.md#éléments)).

## Sources commandées

| Type   | SPICE | `nodes`  | Commande              | Relation                       |
| ------ | ----- | -------- | --------------------- | ------------------------------ |
| `vcvs` | `E`   | `[p, n]` | `control: [cp, cn]`   | `V(p,n) = gain · V(cp,cn)`     |
| `vccs` | `G`   | `[p, n]` | `control: [cp, cn]`   | `I(p→n) = gain · V(cp,cn)` (S) |
| `cccs` | `F`   | `[p, n]` | `controlSource: "Vx"` | `I(p→n) = gain · I(Vx)`        |
| `ccvs` | `H`   | `[p, n]` | `controlSource: "Vx"` | `V(p,n) = gain · I(Vx)` (Ω)    |

Le courant de commande de `cccs` / `ccvs` est le courant qui traverse une source de tension indépendante (utilisez une source de 0 V comme ampèremètre, comme dans SPICE).

## Composants actifs et de commutation

| Type     | SPICE        | `nodes`           | Champs                                                         |
| -------- | ------------ | ----------------- | -------------------------------------------------------------- |
| `opamp`  | `X… OPAMP`   | `[in+, in-, out]` | `gain?` gain en boucle ouverte, `gbw?` produit gain-bande (Hz) |
| `switch` | `S… ON\|OFF` | `[a, b]`          | `closed`, `ron?` (0 par défaut), `roff?` (∞ par défaut)        |

- **Amplificateur opérationnel :** idéal (court-circuit virtuel entre les entrées, impédance d'entrée infinie, impédance de sortie nulle) lorsque `gain` est omis. Avec `gain`, la sortie vaut `A·(V+ − V−)` ; ajouter `gbw` donne un modèle à un pôle `A / (1 + s·A/(2π·GBW))`. La sortie est référencée à la masse.
- **Interrupteur :** un interrupteur à état fixe, utile pour comparer des configurations. Il n'est pas commandé en tension.

## Composants non linéaires

| Type    | SPICE        | `nodes`            | Champs                                                                      |
| ------- | ------------ | ------------------ | --------------------------------------------------------------------------- |
| `diode` | `D… [model]` | `[anode, cathode]` | `model?`, `is?`, `n?`, `rs?`, `bv?`, `ibv?`, `nbv?`, `cjo?` (défauts SPICE) |

- **Diode :** loi de Shockley avec résistance série `rs` ; avec `bv`, elle claque en inverse (Zener). `cjo` est une capacité de jonction constante. Les paramètres viennent en général d'une carte `.model NOM D(...)`. Le courant est compté de l'anode vers la cathode. Voir le [guide des diodes](./diodes.md).
- Les circuits avec une diode sont résolus par Newton-Raphson ; les analyses petits signaux utilisent le circuit linéarisé au point de fonctionnement continu.

Les transistors bipolaires et MOSFET suivront.

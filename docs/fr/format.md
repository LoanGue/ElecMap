# Formats de circuit

ElecMap accepte deux entrées, toutes deux transformées en un **circuit compilé** unique par `compile()` :

1. une **netlist SPICE**, le format texte standard de l'industrie ;
2. le **format JSON canonique**, un document typé et lisible par machine, qui est aussi la forme sous laquelle ElecMap stocke les circuits en interne.

```ts
import { compile } from "elecmap";

const circuit = compile(`
V1 in 0 AC 1
R1 in out 1k
C1 out 0 100n
`);

circuit.nodes; // ["in", "out"]
circuit.toJSON(); // JSON canonique
circuit.toSpice(); // de nouveau une netlist
```

Une chaîne commençant par `{` est analysée comme du JSON, toute autre chaîne comme du SPICE. Un objet JavaScript est traité comme un document JSON.

## Netlist SPICE

### Valeurs

Les nombres acceptent les suffixes d'échelle SPICE (insensibles à la casse). Les lettres d'unité finales sont ignorées.

| Suffixe | Facteur | Suffixe  | Facteur |
| ------- | ------- | -------- | ------- |
| `T`     | 10¹²    | `m`      | 10⁻³    |
| `G`     | 10⁹     | `u`, `µ` | 10⁻⁶    |
| `MEG`   | 10⁶     | `n`      | 10⁻⁹    |
| `k`     | 10³     | `p`      | 10⁻¹²   |
| `mil`   | 25,4 µm | `f`      | 10⁻¹⁵   |

Exemples : `1k`, `4.7u`, `100nF`, `1e-3`, `2MEG`. La notation européenne est également prise en charge : `4k7` = 4,7 kΩ, `1R5` = 1,5 Ω, `2u2` = 2,2 µ.

> ⚠️ Comme dans SPICE, `M` signifie **milli** (utilisez `MEG` pour méga) et `F` signifie **femto** : écrivez `100nF`, pas `100F`.

### Éléments

| Ligne                                        | Composant                                                   |
| -------------------------------------------- | ----------------------------------------------------------- |
| `Rname n1 n2 value`                          | résistance (Ω)                                              |
| `Cname n1 n2 value [IC=v]`                   | condensateur (F), tension initiale                          |
| `Lname n1 n2 value [IC=i]`                   | bobine (H), courant initial                                 |
| `Vname n+ n- [DC v] [AC mag [phase]] [wave]` | source de tension indépendante                              |
| `Iname n+ n- [DC i] [AC mag [phase]] [wave]` | source de courant indépendante                              |
| `Ename n+ n- nc+ nc- gain`                   | source de tension commandée en tension                      |
| `Gname n+ n- nc+ nc- gm`                     | source de courant commandée en tension                      |
| `Fname n+ n- Vctrl gain`                     | source de courant commandée en courant                      |
| `Hname n+ n- Vctrl r`                        | source de tension commandée en courant                      |
| `Kname L1 L2 k`                              | bobines couplées, `0 < k ≤ 1`                               |
| `Xname in+ in- out OPAMP [GAIN=a] [GBW=f]`   | amplificateur opérationnel _(extension ElecMap)_            |
| `Sname n1 n2 ON\|OFF [RON=r] [ROFF=r]`       | interrupteur à état fixe _(extension ElecMap)_              |
| `Dname anode cathode [model] [area] [K=v…]`  | diode, Zener (voir [diodes](./diodes.md))                   |
| `.model name D(IS=… N=… RS=… BV=…)`          | carte de modèle de diode                                    |
| `Qname c b e [sub] [model] [area] [K=v…]`    | transistor bipolaire (voir [transistors](./transistors.md)) |
| `Mname d g s [b] model [W=w] [L=l] [K=v…]`   | MOSFET, substrat relié à la source s'il est omis            |
| `.model name NPN                             | PNP(IS=… BF=… VAF=…)`                                       | carte de modèle bipolaire         |
| `.model name NMOS                            | PMOS(VTO=… KP=… LAMBDA=…)`                                  | carte de modèle MOSFET (niveau 1) |

Un nombre seul après les nœuds d'une source est sa valeur continue (`V1 a 0 5`). Les phases sont en degrés.

**Formes d'onde** (analyse transitoire) : `SIN(offset amplitude freq [delay [damping [phase]]])`, `PULSE(v1 v2 [delay rise fall width period])`, `PWL(t1 v1 t2 v2 …)`, `EXP(v1 v2 [td1 tau1 td2 tau2])`, `STEP(v1 v2 [delay])` _(extension)_. Les virgules et un espace avant `(` sont autorisés.

### Syntaxe

- `*` en début de ligne commence un commentaire ; `;` et `$` commencent des commentaires en fin de ligne.
- Une ligne commençant par `+` prolonge la ligne précédente.
- **Ligne de titre :** en SPICE classique, la première ligne est toujours un titre. ElecMap la détecte automatiquement : la première ligne n'est un titre que si elle ne s'analyse pas comme un élément. Forcez ce comportement avec `compile(src, { spice: { titleLine: true } })`, ou utilisez `.title My circuit`.
- `.end` arrête l'analyse. Les autres directives (`.ac`, `.tran`, `.op`…) sont ignorées et signalées dans `circuit.parserWarnings`. `.subckt` n'est pas encore pris en charge.
- Le nœud de masse est `0` ; `gnd` et `GND` en sont des alias. Utilisez `compile(src, { ground: "ref" })` pour choisir un autre nom.

## Format JSON canonique

```json
{
  "version": 1,
  "title": "RC low-pass",
  "ground": "0",
  "components": [
    { "id": "V1", "type": "vsource", "nodes": ["in", "0"], "ac": { "mag": 1 } },
    { "id": "R1", "type": "resistor", "nodes": ["in", "out"], "value": 1000 },
    { "id": "C1", "type": "capacitor", "nodes": ["out", "0"], "value": 1e-7 }
  ]
}
```

- Toutes les valeurs sont de simples nombres en unités SI, les phases sont en degrés.
- `nodes` suit l'ordre des bornes de chaque type (voir [components.md](./components.md)).
- Les types TypeScript (`CircuitJSON`, `ComponentJSON`, …) et un JSON Schema (`CIRCUIT_SCHEMA`, draft 2020-12) sont exportés pour les éditeurs et les validateurs externes.

## Exporter et partager

`export(format)` écrit le circuit dans l'un des trois formats d'échange, et le constructeur sait tous les relire :

| Format      | `export` renvoie          | Usage                                                                         |
| ----------- | ------------------------- | ----------------------------------------------------------------------------- |
| `"json"`    | un objet `CircuitJSON`    | le document canonique, utilisé en interne                                     |
| `"netlist"` | du texte SPICE            | lisible par un humain et par d'autres simulateurs                             |
| `"base64"`  | un jeton sûr pour les URL | une seule chaîne sans espace, prête à être envoyée dans une URL ou un message |

```ts
const c = new ElecMap("V1 in 0 AC 1
R1 in out 1k
C1 out 0 100n");

const token = c.export("base64");
// "eyJ2ZXJzaW9uIjoxLCJjb21wb25lbnRzIjpbeyJpZCI6IlYxIiwidHlwZSI6InZzb3VyY2Ui…"
token.length; // 310    caractères [A-Za-z0-9_-], utilisable tel quel dans une URL

const copy = new ElecMap(token); // le format est détecté
copy.transferFunction({ input: "V1", output: "out" }).cutoffFrequency(); // 1591.5 Hz

c.export("netlist");
// * ElecMap circuit
// V1 in 0 AC 1
// R1 in out 1k
// C1 out 0 100n
// .end

c.export("json");
// { version: 1, components: [
//   { id: "V1", type: "vsource", nodes: ["in", "0"], ac: { mag: 1 } }, … ], ground: "0" }
```

Le format d'un texte est détecté : un texte commençant par `{` est du JSON, un seul mot sans espace est du base64, tout le reste est une netlist. On peut le fixer avec `format` :

```ts
new ElecMap(text, { format: "netlist" }); // une netlist, même si elle ressemble à autre chose
new ElecMap(token, { format: "base64" });
```

Le jeton base64 est le document JSON compact en UTF-8 : il transporte donc tout ce que porte le JSON. Toutes les conversions passent par le document JSON : lire une netlist, c'est netlist → JSON ; l'exporter en base64, c'est JSON → base64. Chaque format n'a donc besoin que d'un lecteur et d'un écrivain.

## Validation

`compile()` exécute `validateCircuit()` et lève une `ElecMapError` de code `INVALID_CIRCUIT` si une erreur est trouvée. Chaque problème est listé dans `error.details.issues`, de sorte qu'une interface peut mettre en évidence le composant ou le nœud fautif. Les avertissements sont conservés dans `circuit.warnings`.

| Code                  | Gravité       | Signification                                                               |
| --------------------- | ------------- | --------------------------------------------------------------------------- |
| `MALFORMED`           | erreur        | Le document ou un composant n'a pas la bonne forme                          |
| `UNKNOWN_TYPE`        | erreur        | Type de composant non pris en charge                                        |
| `INVALID_NODES`       | erreur        | Nombre de nœuds incorrect                                                   |
| `INVALID_VALUE`       | erreur        | Valeur manquante, non finie ou hors limites                                 |
| `DUPLICATE_ID`        | erreur        | Deux composants partagent un identifiant                                    |
| `UNKNOWN_REFERENCE`   | erreur        | Source de commande, bobine couplée ou nœud de commande manquant             |
| `EMPTY_CIRCUIT`       | erreur        | Aucun composant                                                             |
| `NO_GROUND`           | erreur        | Rien n'est relié à la masse                                                 |
| `FLOATING_NODE`       | erreur        | Nœud sans aucun chemin vers la masse                                        |
| `VOLTAGE_SOURCE_LOOP` | erreur        | Maille constituée uniquement de sources de tension / courts-circuits idéaux |
| `NO_DC_PATH`          | avertissement | Nœud accessible uniquement à travers des condensateurs / sources de courant |
| `INDUCTOR_LOOP`       | avertissement | Maille de bobines et de sources de tension (singulière en continu)          |
| `SHORTED_COMPONENT`   | avertissement | Les deux bornes sur le même nœud                                            |
| `DANGLING_NODE`       | avertissement | Nœud relié à une seule borne                                                |

## Circuit compilé

`CompiledCircuit` est immuable (son document est gelé en profondeur) :

| Membre                                            | Description                                             |
| ------------------------------------------------- | ------------------------------------------------------- |
| `nodes`                                           | noms des nœuds hors masse, dans l'ordre des indices MNA |
| `nodeIndex(name)`                                 | indice d'un nœud, `-1` pour la masse                    |
| `hasNode(name)`, `isGround(name)`                 | recherche de nœuds (alias inclus)                       |
| `components`, `component(id)`, `hasComponent(id)` | recherche de composants                                 |
| `warnings`, `parserWarnings`                      | remarques non bloquantes                                |
| `toJSON()`, `toSpice()`                           | export (copie modifiable / netlist)                     |

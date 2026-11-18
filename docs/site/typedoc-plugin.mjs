// @ts-check
/**
 * Local typedoc plugin: organises the API reference.
 *
 * - Every top-level export gets a `@category` from the file it is defined in
 *   (an explicit `@category` tag in the source wins).
 * - Members of the `ElecMap` class get a `@group` by theme.
 */
import { Comment, CommentTag, Converter, ReflectionKind } from "typedoc";

/**
 * French names of the categories and groups (the source names are English).
 * @type {Record<string, string>}
 */
export const FRENCH = {
  Guides: "Guides",
  Reference: "Référence",
  Circuit: "Circuit",
  "DC & AC analyses": "Analyses DC et AC",
  "Transfer functions": "Fonctions de transfert",
  "Literal transfer functions": "Fonctions de transfert littérales",
  Equivalents: "Équivalents",
  "Time domain": "Domaine temporel",
  Schematics: "Schémas",
  "Circuit JSON": "JSON du circuit",
  "SPICE, units & LaTeX": "SPICE, unités et LaTeX",
  Math: "Mathématiques",
  Internals: "Interne",
  "Creating a circuit": "Créer un circuit",
  "Circuit description": "Description du circuit",
  "Voltages, currents & power": "Tensions, courants et puissance",
  "Impedances & equivalents": "Impédances et équivalents",
  Schematic: "Schéma",
};

/** First matching prefix wins. */
const CATEGORY_BY_PATH = [
  ["src/ElecMap.ts", "Circuit"],
  ["src/core/circuit.ts", "Circuit"],
  ["src/index.ts", "Circuit"],
  ["src/core/errors.ts", "Circuit"],
  ["src/analysis/transfer.ts", "Transfer functions"],
  ["src/analysis/response.ts", "Time domain"],
  ["src/analysis/transient.ts", "Time domain"],
  ["src/analysis/waveforms.ts", "Time domain"],
  ["src/analysis/equivalent.ts", "Equivalents"],
  ["src/analysis/", "DC & AC analyses"],
  ["src/symbolic/transfer.ts", "Literal transfer functions"],
  ["src/symbolic/system.ts", "Literal transfer functions"],
  ["src/render/layout.ts", "Schematics"],
  ["src/render/svg.ts", "Schematics"],
  ["src/format/types.ts", "Circuit JSON"],
  ["src/format/schema.ts", "Circuit JSON"],
  ["src/format/catalog.ts", "Circuit JSON"],
  ["src/format/validate.ts", "Circuit JSON"],
  ["src/format/", "SPICE, units & LaTeX"],
  ["src/math/", "Math"],
  ["src/symbolic/", "Internals"],
  ["src/mna/", "Internals"],
  ["src/render/", "Internals"],
];

/** Groups of the ElecMap class members, in display order. */
const ELECMAP_GROUPS = {
  "Creating a circuit": ["constructor", "fromSpice", "fromJSON"],
  "Circuit description": [
    "circuit",
    "system",
    "title",
    "nodes",
    "components",
    "toJSON",
    "toSpice",
    "setValue",
  ],
  "Voltages, currents & power": ["voltage", "current", "power", "operatingPoint", "ac", "acSweep"],
  "Transfer functions": ["transferFunction", "symbolicTransferFunction"],
  "Impedances & equivalents": [
    "impedance",
    "symbolicImpedance",
    "equivalentImpedance",
    "equivalentResistance",
    "equivalentCapacitance",
    "equivalentInductance",
    "inputImpedance",
    "outputImpedance",
    "thevenin",
    "norton",
  ],
  "Time domain": ["transient"],
  Schematic: ["toSVG", "layout"],
};

/**
 * @param {import("typedoc").Reflection} reflection
 * @param {string} tag
 * @param {string} value
 */
function addTag(reflection, tag, value) {
  const comment = (reflection.comment ??= new Comment());
  if (comment.blockTags.some((t) => t.tag === tag)) return;
  comment.blockTags.push(
    new CommentTag(/** @type {`@${string}`} */ (tag), [{ kind: "text", text: value }]),
  );
}

/** @param {import("typedoc").Application} app */
export function load(app) {
  /** @param {string} name */
  const tr = (name) =>
    app.options.getValue("lang") === "fr"
      ? (/** @type {Record<string, string>} */ (FRENCH)[name] ?? name)
      : name;
  app.converter.on(
    Converter.EVENT_RESOLVE_BEGIN,
    (context) => {
      const project = context.project;
      for (const reflection of project.getReflectionsByKind(ReflectionKind.All)) {
        if (!reflection.isDeclaration()) continue;
        if (reflection.parent === project || reflection.parent?.kindOf(ReflectionKind.Module)) {
          const file = reflection.sources?.[0]?.fileName?.replace(/\\/g, "/") ?? "";
          const match = CATEGORY_BY_PATH.find(([prefix]) => file.includes(prefix));
          if (match) addTag(reflection, "@category", tr(match[1]));
        }
        if (
          reflection.parent?.name === "ElecMap" &&
          reflection.parent.kindOf(ReflectionKind.Class)
        ) {
          for (const [group, names] of Object.entries(ELECMAP_GROUPS)) {
            if (names.includes(reflection.name)) addTag(reflection, "@group", tr(group));
          }
        }
      }
    },
    // Before the category and group plugins read the tags.
    1000,
  );
}

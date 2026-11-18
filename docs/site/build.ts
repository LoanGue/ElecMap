/**
 * Builds the documentation site in English (`docs/api/`) and French (`docs/api/fr/`).
 *
 * For each language, the Markdown sources of `docs/<lang>/` are staged into
 * `docs/.build/` (the paths that `src/index.ts` attaches with `@document`),
 * figures are generated with ElecMap, then typedoc renders the site.
 *
 * Run with `npm run docs`.
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Application, TSConfigReader, TypeDocReader } from "typedoc";
import { writeFigures } from "./figures";
import { FRENCH } from "./typedoc-plugin.mjs";

type Lang = "en" | "fr";

const docs = join(dirname(fileURLToPath(import.meta.url)), "..");
const stage = join(docs, ".build");
const SITE = "https://loangue.github.io/ElecMap/";

/** Reference pages are plain Markdown (readable on GitHub): their title is added here. */
const REFERENCE: Record<string, Record<Lang, string>> = {
  format: { en: "Netlists and JSON", fr: "Netlists et JSON" },
  components: { en: "Component catalogue", fr: "Catalogue des composants" },
  algorithms: { en: "Algorithms", fr: "Algorithmes" },
};

async function build(lang: Lang): Promise<void> {
  const tr = (name: string): string => (lang === "fr" ? (FRENCH[name] ?? name) : name);
  const source = join(docs, lang);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  for (const file of readdirSync(source).filter((f) => f.endsWith(".md"))) {
    let text = readFileSync(join(source, file), "utf8");
    const reference = REFERENCE[file.replace(/\.md$/, "")];
    if (reference && !text.startsWith("---")) {
      text = `---\ntitle: ${reference[lang]}\ncategory: ${tr("Reference")}\n---\n\n${text}`;
    }
    writeFileSync(join(stage, file), text);
  }
  writeFigures(join(stage, "figures"), lang);

  const config = JSON.parse(readFileSync(join(docs, "..", "typedoc.json"), "utf8")) as {
    categoryOrder: string[];
    groupOrder: string[];
  };
  const other = lang === "fr" ? { English: SITE } : { Français: `${SITE}fr/` };

  const app = await Application.bootstrapWithPlugins(
    {
      options: join(docs, "..", "typedoc.json"),
      lang,
      out: join(docs, "api", ...(lang === "fr" ? ["fr"] : [])),
      readme: join(stage, "home.md"),
      categoryOrder: config.categoryOrder.map(tr),
      groupOrder: config.groupOrder.map(tr),
      navigationLinks: { ...other, GitHub: "https://github.com/LoanGue/ElecMap" },
      cleanOutputDir: lang === "en",
    },
    [new TypeDocReader(), new TSConfigReader()],
  );
  const project = await app.convert();
  if (!project) throw new Error(`typedoc conversion failed (${lang})`);
  app.validate(project);
  const strict = app.options.getValue("treatWarningsAsErrors");
  if (app.logger.hasErrors() || (strict && app.logger.hasWarnings())) {
    throw new Error(`typedoc reported problems (${lang})`);
  }
  await app.generateOutputs(project);
  // Figures are inlined in the pages; keep a copy for direct links.
  cpSync(join(stage, "figures"), join(app.options.getValue("out"), "figures"), { recursive: true });
}

// `npm run docs -- en` builds a single language.
const only = process.argv.slice(2).filter((a): a is Lang => a === "en" || a === "fr");
for (const lang of only.length > 0 ? only : (["en", "fr"] as const)) {
  await build(lang);
  console.log(`documentation (${lang}) written`);
}
rmSync(stage, { recursive: true, force: true });

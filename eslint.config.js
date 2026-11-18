import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "coverage",
      "docs/api",
      "node_modules",
      ".worktrees",
      "playground",
      "notes",
      "examples/output",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    // Node scripts (plain JS): Node globals.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
  {
    // Script loaded by the documentation site: browser globals.
    files: ["docs/site/theme.js"],
    languageOptions: { globals: { document: "readonly", katex: "readonly" } },
  },
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);

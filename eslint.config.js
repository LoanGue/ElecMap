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
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);

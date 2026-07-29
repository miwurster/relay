import { defineConfig } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import vitest from "@vitest/eslint-plugin";
import tseslint from "typescript-eslint";

export default defineConfig(
  // `fixtures` is not relay's source: each fixture is a target repo with its
  // own package manager and dependencies, which this repo's config cannot type.
  { ignores: ["dist", "node_modules", "coverage", ".scratch", "fixtures"] },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.lint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      // Interpolating an exit code or a count is safe and readable.
      // The rule still catches `${object}` and `${any}`.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // A leading underscore is how this repo says "deliberately unused".
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["tests/**/*.ts"],
    ...vitest.configs.recommended,
    rules: {
      ...vitest.configs.recommended.rules,
      // Test doubles satisfy async interfaces without awaiting anything —
      // that is the point of a double, not a missing await.
      "@typescript-eslint/require-await": "off",
      // Spies are handed around unbound on purpose in test setup.
      "@typescript-eslint/unbound-method": "off",
    },
  },
  eslintConfigPrettier,
);

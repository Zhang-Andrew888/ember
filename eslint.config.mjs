import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const tsFiles = ["**/*.ts", "**/*.tsx"];

/** Shared TypeScript rules that do not require type information. */
const sharedRules = {
  ...tseslint.configs.recommended.rules,
  "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
  "no-console": "warn",
};

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**"],
  },

  // packages/* — use each package's own tsconfig
  {
    files: ["packages/*/src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: true },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: sharedRules,
  },

  // apps/server
  {
    files: ["apps/server/src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: true },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: sharedRules,
  },

  // apps/web — browser source
  {
    files: ["apps/web/src/**/*.ts", "apps/web/src/**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: true },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: sharedRules,
  },

  // apps/web — vite config (Node.js, separate tsconfig)
  {
    files: ["apps/web/vite.config.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: "./apps/web/tsconfig.node.json" },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: sharedRules,
  },

  // tests/fixtures — use tests/tsconfig.json
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: "./tests/tsconfig.json" },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: sharedRules,
  },

  // root config files (vitest.config.ts, eslint.config.mjs) — no type-aware rules
  {
    files: tsFiles,
    ignores: [
      "packages/**",
      "apps/**",
      "tests/**",
    ],
    languageOptions: {
      parser: tsParser,
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    },
  },
];

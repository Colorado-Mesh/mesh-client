import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-plugin-prettier/recommended";
import importPlugin from "eslint-plugin-import";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/node_modules/**",
      "eslint.config.mjs",
      "**/*.d.ts",
      "eslint.config.*",
      "vitest.config.ts",
      "vite.config.ts",
      "*.config.{ts,js,mjs,cjs}",
      "dist-electron/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  prettier,
  {
    plugins: {
      "simple-import-sort": simpleImportSort,
      import: importPlugin,
    },
    rules: {
      // Disallow dangerous child_process patterns project-wide
      "no-restricted-imports": [
        "error",
        {
          name: "child_process",
          importNames: ["exec", "execSync"],
          message: "Use safer project helpers or spawn-style APIs instead of these functions.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name='child_process'][callee.property.name=/^exec(Sync)?$/]",
          message: "Avoid using child_process methods that execute shell commands directly.",
        },
        {
          selector: "ObjectExpression > Property[key.name='shell'] > Literal[value=true]",
          message: "Avoid shell: true; use direct process execution with argument arrays instead.",
        },
      ],
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "import/first": "off",
      "import/newline-after-import": "error",
      "import/no-duplicates": "error",
      "@typescript-eslint/no-unused-vars": ["error", { caughtErrors: "all" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "prefer-const": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-empty-function": [
        "error",
        { allow: ["arrowFunctions"] },
      ],
    },
  },
  // Node scripts: keep security rules, relax TS/prettier and set Node globals
  {
    files: ["scripts/**/*.{js,cjs,mjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        require: "readonly",
        module: "readonly",
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-undef": "off",
      "prettier/prettier": "off",
      "simple-import-sort/imports": "off",
      "no-redeclare": "off",
    },
  },
  // Renderer: type-aware linting + React Hooks rules
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
        ...reactHooks.configs.recommended.rules,
        "react-hooks/exhaustive-deps": "error",
      },
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Main + Preload: type-aware linting via tsconfig.main.json
  {
    files: ["src/main/**/*.ts", "src/preload/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.main.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier/recommended';
import importPlugin from 'eslint-plugin-import';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/node_modules/**',
      'eslint.config.mjs',
      '**/*.d.ts',
      'eslint.config.*',
      'vitest.config.ts',
      'vite.config.ts',
      '*.config.{ts,js,mjs,cjs}',
      'dist-electron/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  ...tseslint.configs.strictTypeChecked,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.main.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  prettier,
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
      import: importPlugin,
    },
    rules: {
      // Disallow dangerous child_process patterns project-wide
      'no-restricted-imports': [
        'error',
        {
          name: 'child_process',
          importNames: ['exec', 'execSync'],
          message: 'Use safer project helpers or spawn-style APIs instead of these functions.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name='child_process'][callee.property.name=/^exec(Sync)?$/]",
          message: 'Avoid using child_process methods that execute shell commands directly.',
        },
        {
          selector: "ObjectExpression > Property[key.name='shell'] > Literal[value=true]",
          message: 'Avoid shell: true; use direct process execution with argument arrays instead.',
        },
      ],
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'import/first': 'off',
      'import/newline-after-import': 'error',
      'import/no-duplicates': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'all' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'prefer-const': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/unbound-method': 'off',
      // React event handlers often return Promise<void>; void-return check is too strict for JSX attrs.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      // strictTypeChecked enables this, but it flags many defensive DOM/runtime patterns where
      // types are narrower than reality; keep other strict rules without churning the whole UI.
      '@typescript-eslint/no-unnecessary-condition': 'off',
      // Autofix removes generics that TypeScript still needs for inference (tsc errors after
      // eslint --fix). Prefer explicit types at those call sites over a blanket autofix.
      '@typescript-eslint/no-unnecessary-type-arguments': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        {
          ignorePrimitives: { string: true, number: true, boolean: true },
          ignoreMixedLogicalExpressions: true,
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
    },
  },
  // Node scripts: no TS program — disable type-checked rules; keep security + Node globals
  {
    files: ['scripts/**/*.{js,cjs,mjs}'],
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        require: 'readonly',
        module: 'readonly',
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
      'prettier/prettier': 'off',
      'simple-import-sort/imports': 'off',
      'no-redeclare': 'off',
    },
  },
  // Renderer: React (jsx-runtime) + React Hooks + jsx-a11y
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      react,
      ...jsxA11y.flatConfigs.recommended.plugins,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parserOptions: {
        ...jsxA11y.flatConfigs.recommended.languageOptions.parserOptions,
        project: ['./tsconfig.json', './tsconfig.main.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.flat['jsx-runtime'].rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);

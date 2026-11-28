/**
 * ESLint for the mobile package. ESLint 10 looks configs up from each file's directory, so this
 * file applies to everything under `mobile/` whether lint runs from the repo root or here.
 * Same rules as the desktop app; only the TypeScript projects and the host-shim relaxations differ.
 */

import path from 'node:path';

import desktop from '../eslint.config.mjs';

// typescript-eslint infers the root for files without one (the desktop .mjs scripts) only while
// every config names the same tsconfigRootDir, so mobile projects are listed from the repo root.
const REPO_ROOT = path.resolve(import.meta.dirname, '..');
// Reuse the desktop scripts block instead of reading `tseslint.configs` here: that getter records
// this file's folder as another candidate root too.
const desktopScriptsBlock = desktop.find((c) => c.files?.includes('scripts/**/*.mjs'));
if (!desktopScriptsBlock)
  throw new Error('desktop eslint config: scripts/**/*.mjs block not found');

// A plain flat-config array: calling `tseslint.config()` here would register a second tsconfig
// root and break typescript-eslint's root inference for the desktop files.
export default [
  { ignores: ['android/**', 'ios/**', 'native/**', 'dist/**', 'test-results/**', '**/*.d.mts'] },
  ...desktop,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parserOptions: {
        project: ['./mobile/tsconfig.json', './mobile/tsconfig.host.json'],
        tsconfigRootDir: REPO_ROOT,
      },
    },
  },
  // Plain JS modules (preloadEntry.js) lint like the desktop's scripts: no type information.
  {
    files: ['src/**/*.js', 'e2e/**/*.mjs'],
    languageOptions: desktopScriptsBlock.languageOptions,
    rules: desktopScriptsBlock.rules,
  },
  // Host shims emulate Node / Electron APIs for the unmodified main process: they need
  // intentionally empty stubs (tray, menus, no-op setters) and talk to untyped JS (sqlite-wasm,
  // Node-shaped objects). Scope the relaxations to the shim and override modules only.
  {
    files: ['src/host/shims/**/*.ts', 'src/host/overrides/**/*.ts', 'src/host/globals.ts'],
    rules: {
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-invalid-void-type': 'off',
      '@typescript-eslint/no-implied-eval': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
    },
  },
];

import { describe, expect, it } from 'vitest';

import {
  desktopEditProblems,
  isAllowedPath,
  lockfileProblems,
  workspaceProblems,
} from './check-desktop-untouched.mjs';

describe('desktop-untouched guard', () => {
  it.each([
    ['mobile/src/main.tsx', true],
    ['mobile/android/app/build.gradle', true],
    ['.github/workflows/mobile-android.yaml', true],
    ['pnpm-lock.yaml', true],
    ['src/renderer/App.tsx', false],
    ['reticulum-sidecar/src/main.rs', false],
    ['package.json', false],
    ['.github/workflows/tests.yaml', false],
    ['scripts/check-log-ids.mjs', false],
  ])('%s allowed=%s', (file, allowed) => {
    expect(isAllowedPath(file)).toBe(allowed);
  });

  it('workspace file may only gain the mobile package', () => {
    const base = 'minimumReleaseAge: 720\n';
    expect(workspaceProblems(base, 'packages:\n  - mobile\nminimumReleaseAge: 720\n')).toEqual([]);
    expect(workspaceProblems(base, 'packages:\n  - mobile\nminimumReleaseAge: 0\n')).toHaveLength(
      1,
    );
    expect(workspaceProblems(base, 'packages:\n  - tools\nminimumReleaseAge: 720\n')).toHaveLength(
      1,
    );
  });

  it('root fallow config may only leave mobile/** to the package', () => {
    const base = '{\n  "ignorePatterns": [\n    "docs/**",\n  ],\n}\n';
    const ok =
      '{\n  "ignorePatterns": [\n    "docs/**",\n    // Mobile app package\n    "mobile/**",\n  ],\n}\n';
    expect(isAllowedPath('.fallowrc.jsonc')).toBe(true);
    expect(desktopEditProblems('.fallowrc.jsonc', base, ok)).toEqual([]);
    expect(
      desktopEditProblems('.fallowrc.jsonc', base, ok.replace('docs/**', 'src/**')),
    ).toHaveLength(1);
  });

  it('root ESLint config may only leave mobile/** to the package', () => {
    const base = "    ignores: [\n      'test-results/**',\n    ],\n";
    const ok =
      "    ignores: [\n      'test-results/**',\n      'mobile/**', // own config\n    ],\n";
    expect(isAllowedPath('eslint.config.mjs')).toBe(true);
    expect(desktopEditProblems('eslint.config.mjs', base, ok)).toEqual([]);
    // Any other rule change in the same edit is refused.
    expect(
      desktopEditProblems('eslint.config.mjs', base, `${ok}    rules: { 'no-console': 'off' },\n`),
    ).toHaveLength(1);
  });

  it('the translation wasm scan may only exclude mobile/**', () => {
    const file = 'src/main/translation/noBundledTranslations.test.ts';
    const base = "  { cwd: root, exclude: ['node_modules/**', '.git/**'] },\n";
    const ok =
      "  // mobile/: the mobile app package.\n  { cwd: root, exclude: ['node_modules/**', '.git/**', 'mobile/**'] },\n";
    expect(desktopEditProblems(file, base, ok)).toEqual([]);
    expect(desktopEditProblems(file, base, ok.replace("'.git/**', ", ''))).toHaveLength(1);
    expect(desktopEditProblems(file, base, `${ok}  it.skip('x');\n`)).toHaveLength(1);
  });

  it('lockfile may not change the desktop importer', () => {
    const base =
      "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      react: {specifier: 19.0.0, version: 19.0.0}\n";
    const addMobile = `${base}  mobile:\n    devDependencies:\n      memfs: {specifier: 4.0.0, version: 4.0.0}\n`;
    expect(lockfileProblems(base, addMobile)).toEqual([]);
    expect(lockfileProblems(base, base.replaceAll('19.0.0', '19.1.0'))).toEqual([
      "pnpm-lock.yaml: the desktop importer ('.') changed",
    ]);
  });
});

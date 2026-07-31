import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectSourcePolicyViolations, matchSimpleGlob } from './sourcePolicy';
import type { SourcePolicyRule } from './sourcePolicyRules';
import { SOURCE_POLICY_RULES } from './sourcePolicyRules';

describe('matchSimpleGlob', () => {
  it('matches ** and brace extensions', () => {
    expect(matchSimpleGlob('src/renderer/foo.test.tsx', 'src/renderer/**/*.test.tsx')).toBe(true);
    expect(matchSimpleGlob('src/main/chatExportFormat.ts', 'src/main/chatExportFormat.ts')).toBe(
      true,
    );
    expect(matchSimpleGlob('src/a/b.ts', 'src/**/*.{ts,tsx}')).toBe(true);
    expect(matchSimpleGlob('src/a/b.tsx', 'src/**/*.{ts,tsx}')).toBe(true);
    expect(matchSimpleGlob('src/a/b.js', 'src/**/*.{ts,tsx}')).toBe(false);
  });
});

describe('collectSourcePolicyViolations (fixtures)', () => {
  it('reports forbid, honors line suppress, and require suppress', () => {
    const root = mkdtempSync(join(tmpdir(), 'source-policy-'));
    try {
      const dir = join(root, 'src', 'fixture');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'bad.ts'),
        [
          'const x = FORBIDDEN_CALL();',
          'const y = FORBIDDEN_CALL(); // source-policy-ok demo-forbid intentional',
          '',
        ].join('\n'),
        'utf-8',
      );
      writeFileSync(join(dir, 'missing.ts'), 'export const ok = 1;\n', 'utf-8');
      writeFileSync(
        join(dir, 'missing-ok.ts'),
        '// source-policy-ok demo-require documented skip\nexport const ok = 1;\n',
        'utf-8',
      );

      const rules: SourcePolicyRule[] = [
        {
          id: 'demo-forbid',
          include: ['src/fixture/bad.ts'],
          forbid: /FORBIDDEN_CALL\s*\(/,
          message: 'no forbidden call',
        },
        {
          id: 'demo-require',
          include: ['src/fixture/missing.ts', 'src/fixture/missing-ok.ts'],
          require: /REQUIRED_TOKEN/,
          message: 'must have token',
        },
      ];

      const violations = collectSourcePolicyViolations({ root, rules });
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'demo-forbid',
            file: 'src/fixture/bad.ts',
            line: 1,
          }),
          expect.objectContaining({
            ruleId: 'demo-require',
            file: 'src/fixture/missing.ts',
          }),
        ]),
      );
      expect(violations.some((v) => v.file === 'src/fixture/missing-ok.ts')).toBe(false);
      expect(
        violations.filter((v) => v.ruleId === 'demo-forbid' && v.file === 'src/fixture/bad.ts'),
      ).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('applies when+require only when when matches', () => {
    const root = mkdtempSync(join(tmpdir(), 'source-policy-when-'));
    try {
      const dir = join(root, 'src', 'fixture');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'with-axe.tsx'), 'await axe(container);\n', 'utf-8');
      writeFileSync(join(dir, 'no-axe.tsx'), 'export const x = 1;\n', 'utf-8');

      const rules: SourcePolicyRule[] = [
        {
          id: 'demo-axe',
          include: ['src/fixture/*.tsx'],
          when: /\baxe\s*\(/,
          require: /hydrateAxeThemeColors/,
          message: 'hydrate required',
        },
      ];

      const violations = collectSourcePolicyViolations({ root, rules });
      expect(violations).toEqual([
        expect.objectContaining({ ruleId: 'demo-axe', file: 'src/fixture/with-axe.tsx' }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('advances past zero-length forbid matches even when suppressed', () => {
    const root = mkdtempSync(join(tmpdir(), 'source-policy-zerolen-'));
    try {
      const dir = join(root, 'src', 'fixture');
      mkdirSync(dir, { recursive: true });
      // Zero-width lookbehind-style /(?=a)/g matches empty string before each 'a'.
      writeFileSync(
        join(dir, 'zero.ts'),
        ['a // source-policy-ok demo-zerolen intentional', 'a', ''].join('\n'),
        'utf-8',
      );

      const rules: SourcePolicyRule[] = [
        {
          id: 'demo-zerolen',
          include: ['src/fixture/zero.ts'],
          forbid: /(?=a)/g,
          message: 'zero-length forbid',
        },
      ];

      const violations = collectSourcePolicyViolations({ root, rules });
      expect(violations).toEqual([
        expect.objectContaining({
          ruleId: 'demo-zerolen',
          file: 'src/fixture/zero.ts',
          line: 2,
        }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('SOURCE_POLICY_RULES (repo)', () => {
  it('has unique rule ids and the three starter rules', () => {
    const ids = SOURCE_POLICY_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        'runtime-tests-use-loadRuntimeSource',
        'chat-export-incremental-cap',
        'axe-tests-hydrate-theme-colors',
      ]),
    );
  });

  /** Repo-wide gate: every `SOURCE_POLICY_RULES` include under src/ stays clean. */
  it('reports no violations against the current tree', () => {
    const violations = collectSourcePolicyViolations();
    expect(violations).toEqual([]);
  });
});

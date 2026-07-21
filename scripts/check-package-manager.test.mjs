// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildPnpmUpgradeHintLines,
  evaluatePnpmRequirement,
  formatPnpmPrepareHint,
  formatPnpmUpgradeMessage,
  parseEngineFloor,
  parsePackageManagerField,
  parseSemver,
} from './check-package-manager.mjs';

describe('check-package-manager parseSemver', () => {
  it('parses plain and v-prefixed versions', () => {
    expect(parseSemver('11.15.1')).toEqual({ major: 11, minor: 15, patch: 1 });
    expect(parseSemver('v10.34.3')).toEqual({ major: 10, minor: 34, patch: 3 });
  });
});

describe('check-package-manager parsePackageManagerField', () => {
  it('strips Corepack integrity suffix', () => {
    expect(
      parsePackageManagerField(
        'pnpm@11.15.1+sha512.81350b07e53c9538a02f1f2303b4290fa2d7be04e56e2a970c4cc4b417dc761de196edabd49d55c7dc9580db81007c44143e4e3d7e462b3000d23c255122d065',
      ),
    ).toMatchObject({ name: 'pnpm', version: '11.15.1', major: 11 });
  });

  it('rejects non-pnpm specs', () => {
    expect(parsePackageManagerField('npm@10.0.0')).toBeNull();
  });
});

describe('check-package-manager parseEngineFloor', () => {
  it('parses >= floors', () => {
    expect(parseEngineFloor('>=11.0.0')).toEqual({ major: 11, minor: 0, patch: 0 });
  });
});

describe('check-package-manager upgrade hints', () => {
  it('uses corepack when available', () => {
    expect(buildPnpmUpgradeHintLines('11.15.1', { corepackAvailable: true })[0]).toBe(
      'corepack enable',
    );
    expect(formatPnpmPrepareHint('11.15.1', { corepackAvailable: true })).toBe(
      'corepack enable && corepack prepare pnpm@11.15.1 --activate',
    );
  });

  it('falls back when Corepack is missing (Node 25+)', () => {
    const lines = buildPnpmUpgradeHintLines('11.15.1', { corepackAvailable: false });
    expect(lines[0]).toContain('npm install -g corepack@latest');
    expect(lines.some((line) => line.includes('npm install -g pnpm@11.15.1'))).toBe(true);
    expect(formatPnpmPrepareHint('11.15.1', { corepackAvailable: false })).toContain(
      'npm install -g corepack@latest',
    );
  });
});

describe('check-package-manager evaluatePnpmRequirement', () => {
  const spec = {
    enginesPnpm: '>=11.0.0',
    packageManager: 'pnpm@11.15.1+sha512.abc',
    corepackAvailable: true,
  };

  it('accepts matching major at or above engines floor', () => {
    expect(evaluatePnpmRequirement('11.15.1', spec)).toEqual({ ok: true, found: '11.15.1' });
    expect(evaluatePnpmRequirement('11.0.0', spec)).toEqual({ ok: true, found: '11.0.0' });
  });

  it('rejects pnpm 10 and missing pnpm', () => {
    const tooOld = evaluatePnpmRequirement('10.34.3', spec);
    expect(tooOld.ok).toBe(false);
    if (tooOld.ok) throw new Error('expected failure');
    expect(tooOld.found).toBe('10.34.3');
    expect(tooOld.hintLines[1]).toBe('corepack prepare pnpm@11.15.1 --activate');

    const missing = evaluatePnpmRequirement(null, spec);
    expect(missing.ok).toBe(false);
  });

  it('rejects wrong major even when above a lower engines floor', () => {
    const result = evaluatePnpmRequirement('12.0.0', {
      enginesPnpm: '>=11.0.0',
      packageManager: 'pnpm@11.15.1',
      corepackAvailable: true,
    });
    expect(result.ok).toBe(false);
  });
});

describe('check-package-manager formatPnpmUpgradeMessage', () => {
  it('includes required and found versions plus upgrade commands', () => {
    const msg = formatPnpmUpgradeMessage({
      ok: false,
      found: '10.34.3',
      requiredLabel: 'pnpm 11.15.1 (engines >=11.0.0)',
      hintLines: [
        'corepack enable',
        'corepack prepare pnpm@11.15.1 --activate',
        'Then re-run your command (e.g. pnpm install or pnpm run dev).',
      ],
    });
    expect(msg).toContain('pnpm upgrade required');
    expect(msg).toContain('You have: 10.34.3');
    expect(msg).toContain('corepack prepare pnpm@11.15.1 --activate');
  });
});

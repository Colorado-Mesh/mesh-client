// @vitest-environment node
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearNomadContentSourcePick,
  defaultReticulumConfigPaths,
  isAllowedNomadContentSourcePath,
  isNomadContentSourceApiPath,
  rememberNomadContentSourcePick,
} from './reticulum-config-paths';

describe('defaultReticulumConfigPaths', () => {
  it('returns platform-specific default config paths', () => {
    const paths = defaultReticulumConfigPaths();
    expect(paths.length).toBeGreaterThan(0);
    if (process.platform === 'win32') {
      expect(paths.some((p) => p.includes('Reticulum'))).toBe(true);
    } else {
      expect(paths.some((p) => p.includes('.reticulum'))).toBe(true);
    }
  });
});

describe('Nomad content-source picker allowlist', () => {
  afterEach(() => {
    clearNomadContentSourcePick();
  });

  it('rejects null / empty (watched folder required)', () => {
    expect(isAllowedNomadContentSourcePath(null)).toBe(false);
    expect(isAllowedNomadContentSourcePath('')).toBe(false);
    expect(isAllowedNomadContentSourcePath('   ')).toBe(false);
  });

  it('rejects arbitrary paths until a picker result is remembered', () => {
    expect(isAllowedNomadContentSourcePath('/tmp/evil')).toBe(false);
    rememberNomadContentSourcePick('/tmp/site');
    expect(isAllowedNomadContentSourcePath('/tmp/evil')).toBe(false);
    expect(isAllowedNomadContentSourcePath('/tmp/site')).toBe(true);
    expect(isAllowedNomadContentSourcePath(path.resolve('/tmp/site'))).toBe(true);
  });

  it('detects the content-source API path', () => {
    expect(isNomadContentSourceApiPath('/api/v1/nomadnetwork/serving/content-source')).toBe(true);
    expect(isNomadContentSourceApiPath('/api/v1/nomadnetwork/serving')).toBe(false);
  });
});

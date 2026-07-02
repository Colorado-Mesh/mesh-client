import { describe, expect, it } from 'vitest';

import { defaultReticulumConfigPaths } from './reticulum-config-paths';

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

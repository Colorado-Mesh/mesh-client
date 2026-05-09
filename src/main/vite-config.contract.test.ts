// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const VITE_CONFIG = readFileSync(join(__dirname, '../../vite.config.ts'), 'utf-8');

describe('vite build config', () => {
  it('disables source maps for production bundles', () => {
    expect(VITE_CONFIG).toMatch(/build:\s*\{/);
    expect(VITE_CONFIG).toMatch(/sourcemap:\s*false/);
  });

  it('sets chunk size warning limit for Electron renderer advisory threshold', () => {
    expect(VITE_CONFIG).toMatch(/chunkSizeWarningLimit:\s*1000/);
  });
});

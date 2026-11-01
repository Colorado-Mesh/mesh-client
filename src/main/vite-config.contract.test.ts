// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const VITE_CONFIG = readFileSync(join(__dirname, '../../vite.config.mts'), 'utf-8');

describe('vite build config', () => {
  it('ships a separate inert migration page with relative asset URLs', () => {
    expect(VITE_CONFIG).toMatch(/base:\s*'\.\/'/);
    expect(VITE_CONFIG).toContain("'src/renderer/migration.html'");
    expect(VITE_CONFIG).toContain("'src/renderer/index.html'");
    const page = readFileSync(join(__dirname, '../renderer/migration.html'), 'utf8');
    expect(page).not.toMatch(/<script|<iframe|<link|http-equiv/i);
    expect(page).toMatch(/<body>\s*<\/body>/);
  });

  it('disables source maps for production bundles', () => {
    expect(VITE_CONFIG).toMatch(/build:\s*\{/);
    expect(VITE_CONFIG).toMatch(/sourcemap:\s*false/);
  });

  it('sets chunk size warning limit for Electron renderer advisory threshold', () => {
    expect(VITE_CONFIG).toMatch(/chunkSizeWarningLimit:\s*1000/);
  });

  it('fails the renderer build when the App entry chunk exceeds 1000 kB', () => {
    expect(VITE_CONFIG).toMatch(/appChunkBudgetPlugin\(\)/);
  });

  it('splits vendor libs with Rolldown codeSplitting groups', () => {
    expect(VITE_CONFIG).toMatch(/rolldownOptions:\s*\{/);
    expect(VITE_CONFIG).toMatch(/codeSplitting:\s*\{/);
    expect(VITE_CONFIG).not.toMatch(/manualChunks/);
    for (const name of [
      'react',
      'recharts',
      'leaflet',
      'meshtastic',
      'meshcore',
      'meshcore-decoder',
      'esptool-js',
    ]) {
      expect(VITE_CONFIG).toContain(`name: '${name}'`);
    }
  });

  it('uses import.meta.dirname for native ESM configLoader compatibility', () => {
    expect(VITE_CONFIG).not.toMatch(/__dirname/);
    expect(VITE_CONFIG).toMatch(/import\.meta\.dirname/);
  });

  it('uses the Tailwind Vite plugin instead of a global PostCSS pipeline', () => {
    expect(VITE_CONFIG).toMatch(/from '@tailwindcss\/vite'/);
    expect(VITE_CONFIG).toMatch(/tailwindcss\(\)/);
    expect(VITE_CONFIG).not.toMatch(/css:\s*\{/);
    expect(VITE_CONFIG).not.toMatch(/postcss/);
  });
});

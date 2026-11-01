// @vitest-environment node
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const VITE_CONFIG = readFileSync(join(ROOT, 'vite.config.mts'), 'utf-8');

describe('vite build config', () => {
  it('ships a separate inert migration page with relative asset URLs', () => {
    expect(VITE_CONFIG).toMatch(/base:\s*'\.\/'/);
    expect(VITE_CONFIG).toContain("'src/renderer/migration.html'");
    expect(VITE_CONFIG).toContain("'src/renderer/index.html'");
    const page = readFileSync(join(__dirname, '../renderer/migration.html'), 'utf8');
    expect(page).not.toMatch(/<script|<iframe|<link|http-equiv/i);
    expect(page).toMatch(/<body>\s*<\/body>/);
  });

  it('declares multipage HTML entries on rolldownOptions.input', () => {
    expect(VITE_CONFIG).toMatch(
      /rolldownOptions:\s*\{[\s\S]*?input:\s*\{[\s\S]*?index\.html[\s\S]*?migration\.html[\s\S]*?live-map\.html/,
    );
    expect(VITE_CONFIG).not.toMatch(/rollupOptions:\s*\{[\s\S]*?input:/);
  });

  it('emits index.html, migration.html, and live-map.html into dist/renderer', async () => {
    await build({ configFile: join(ROOT, 'vite.config.mts'), logLevel: 'error' });
    const out = join(ROOT, 'dist/renderer');
    expect(existsSync(join(out, 'index.html'))).toBe(true);
    expect(existsSync(join(out, 'migration.html'))).toBe(true);
    expect(existsSync(join(out, 'live-map.html'))).toBe(true);
  }, 120_000);

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

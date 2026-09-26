import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const rendererDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const stylesCss = readFileSync(join(rendererDir, 'styles.css'), 'utf8');

const PLEX_FACES = [
  ['IBM Plex Sans', 'sans', [400, 500, 600]],
  ['IBM Plex Mono', 'mono', [400, 500]],
] as const;
const SUBSETS = ['latin', 'latin-ext', 'cyrillic'] as const;

describe('bundled IBM Plex fonts (v6 style guide)', () => {
  it('uses Plex first in the Tailwind sans and mono stacks with system fallbacks', () => {
    expect(stylesCss).toMatch(/--font-sans:\s*'IBM Plex Sans',\s*system-ui/);
    expect(stylesCss).toMatch(/--font-mono:\s*'IBM Plex Mono',\s*ui-monospace/);
  });

  it('declares a woff2 face per weight and subset that exists on disk (works offline)', () => {
    for (const [family, slug, weights] of PLEX_FACES) {
      for (const weight of weights) {
        for (const subset of SUBSETS) {
          const file = `ibm-plex-${slug}-${subset}-${weight}-normal.woff2`;
          // eslint-disable-next-line security/detect-non-literal-regexp -- built from the test's own constants
          const face = new RegExp(
            `@font-face\\s*\\{[^}]*font-family:\\s*'${family}';[^}]*font-weight:\\s*${weight};[^}]*url\\('\\./assets/fonts/plex/${file}'\\)[^}]*unicode-range:`,
            's',
          );
          expect(stylesCss, file).toMatch(face);
          const path = join(rendererDir, 'assets/fonts/plex', file);
          expect(existsSync(path), file).toBe(true);
          expect(readFileSync(path).byteLength, file).toBeGreaterThan(5_000);
        }
      }
    }
  });

  it('ships the OFL license text next to the fonts', () => {
    const license = readFileSync(join(rendererDir, 'assets/fonts/plex/OFL-IBMPlex.txt'), 'utf8');
    expect(license).toContain('SIL Open Font License, Version 1.1');
    expect(license).toContain('IBM Plex Sans');
    expect(license).toContain('IBM Plex Mono');
  });

  it('never loads fonts from the network', () => {
    expect(stylesCss).not.toMatch(
      /fonts\.googleapis|fonts\.gstatic|@import\s+url\(\s*['"]?https?:/,
    );
  });
});

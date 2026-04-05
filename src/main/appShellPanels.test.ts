// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Guard: every lazy-exported shell panel/modal must be referenced in App.tsx so new
 * lazy modules cannot be forgotten.
 */
const RENDERER_DIR = join(__dirname, '../renderer');
const LAZY_FILES = ['lazyTabPanels.ts', 'lazyAppPanels.ts', 'lazyModals.ts'] as const;
const APP_SOURCE = readFileSync(join(RENDERER_DIR, 'App.tsx'), 'utf-8');

describe('lazy panels and modals are mounted in App', () => {
  it('every export const Name = lazy from lazy* files appears in App.tsx', () => {
    const exports: string[] = [];
    for (const file of LAZY_FILES) {
      const source = readFileSync(join(RENDERER_DIR, file), 'utf-8');
      const re = /export const (\w+)\s*=\s*lazy\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(source)) !== null) {
        exports.push(m[1]);
      }
    }
    expect(exports.length).toBeGreaterThan(0);
    for (const name of exports) {
      const found = APP_SOURCE.includes(`<${name}`);
      expect(found).toBe(true);
      if (!found) {
        throw new Error(
          `Expected App.tsx to render <${name} /> (lazy export from lazyTabPanels / lazyAppPanels / lazyModals)`,
        );
      }
    }
  });
});

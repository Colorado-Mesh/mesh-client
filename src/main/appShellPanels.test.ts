// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Guard: every lazy-exported tab panel must be referenced in App.tsx so new
 * panels in lazyTabPanels.ts cannot be forgotten in the shell.
 */
const RENDERER_DIR = join(__dirname, '../renderer');
const LAZY_SOURCE = readFileSync(join(RENDERER_DIR, 'lazyTabPanels.ts'), 'utf-8');
const APP_SOURCE = readFileSync(join(RENDERER_DIR, 'App.tsx'), 'utf-8');

describe('lazy tab panels are mounted in App', () => {
  it('every export const Name = lazy from lazyTabPanels appears in App.tsx', () => {
    const exports: string[] = [];
    const re = /export const (\w+)\s*=\s*lazy\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(LAZY_SOURCE)) !== null) {
      exports.push(m[1]);
    }
    expect(exports.length).toBeGreaterThan(0);
    for (const name of exports) {
      expect(
        APP_SOURCE.includes(`<${name}`),
        `Expected App.tsx to render <${name} /> (lazy export from lazyTabPanels.ts)`,
      ).toBe(true);
    }
  });
});

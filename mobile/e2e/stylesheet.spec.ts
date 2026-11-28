/**
 * Every class a mobile component names exists in the built stylesheet. The renderer's
 * styles.css tells Tailwind to scan `src/renderer` only, so a utility that appears only in
 * `mobile/src` is never generated and silently does nothing (a wrapping fix for the location
 * card did exactly that). Mobile-only styling belongs in mobileShell.css. Needs `mobile/dist/`.
 */
import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

const MOBILE_ROOT = path.resolve(import.meta.dirname, '..');
const ASSETS = path.join(MOBILE_ROOT, 'dist/assets');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isDirectory()) sourceFiles(file, out);
    else if (file.endsWith('.tsx') && !file.includes('.test.')) out.push(file);
  }
  return out;
}

/** A class token as it appears in a CSS selector. */
function selectorFor(token: string): string {
  return '.' + token.replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
}

test('every class a mobile component uses is in the built stylesheet', () => {
  const css = fs
    .readdirSync(ASSETS)
    .filter((f) => f.endsWith('.css'))
    .map((f) => fs.readFileSync(path.join(ASSETS, f), 'utf8'))
    .join('\n');
  expect(css.length, 'built CSS in mobile/dist/assets').toBeGreaterThan(10_000);
  // Proves the lookup finds a generated class, so an empty result below means something.
  expect(css.includes(selectorFor('text-orange-200'))).toBe(true);

  const attribute = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g;
  let checked = 0;
  const missing: string[] = [];
  for (const file of sourceFiles(path.join(MOBILE_ROOT, 'src'))) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(attribute)) {
      const text = (match[1] ?? match[2] ?? match[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
      for (const token of text.split(/\s+/).filter(Boolean)) {
        checked += 1;
        if (!css.includes(selectorFor(token))) {
          missing.push(`${path.relative(MOBILE_ROOT, file)}: ${token}`);
        }
      }
    }
  }
  expect(checked, 'class tokens found in mobile components').toBeGreaterThan(20);
  expect(missing).toEqual([]);
});

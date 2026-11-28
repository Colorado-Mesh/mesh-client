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

  let checked = 0;
  const missing: string[] = [];
  for (const file of sourceFiles(path.join(MOBILE_ROOT, 'src'))) {
    for (const classList of classListsIn(fs.readFileSync(file, 'utf8'))) {
      for (const token of classList.split(/\s+/).filter(Boolean)) {
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

/**
 * Class lists a component hands to the DOM: literal `className` attributes, literal extras passed
 * to `buttonClassName(variant, size, extra)`, and `const` strings named in either place (as the
 * whole value, or inside a `className` template). A wrapping fix once passed a constant as that
 * extra argument, which a literal-only scan would not see.
 */
function classListsIn(source: string): string[] {
  const constants = new Map<string, string>();
  for (const m of source.matchAll(/const ([A-Za-z_]\w*)\s*=\s*(['"`])([^'"`$]*)\2/g)) {
    constants.set(m[1], m[3]);
  }
  const lists: string[] = [];
  const add = (expression: string) => {
    const value = expression.trim();
    const literal = /^(['"`])([^'"`]*)\1$/.exec(value);
    if (literal) lists.push(literal[2]);
    else if (constants.has(value)) lists.push(constants.get(value) ?? '');
  };
  for (const m of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    const text = m[1] ?? m[2] ?? m[3] ?? '';
    lists.push(text.replace(/\$\{[^}]*\}/g, ' '));
    for (const inner of text.matchAll(/\$\{\s*([A-Za-z_]\w*)\s*\}/g)) add(inner[1]);
  }
  for (const m of source.matchAll(/className=\{\s*([A-Za-z_]\w*)\s*\}/g)) add(m[1]);
  for (const m of source.matchAll(/buttonClassName\(([^()]*)\)/g)) {
    const args = m[1].split(',');
    if (args.length >= 3) add(args.slice(2).join(','));
  }
  return lists;
}

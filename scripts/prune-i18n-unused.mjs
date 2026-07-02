#!/usr/bin/env node
/**
 * Remove unused translation keys from all locale files (English is source of truth).
 *
 * Usage:
 *   node scripts/prune-i18n-unused.mjs           # dry-run (default)
 *   node scripts/prune-i18n-unused.mjs --write   # apply removals
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectUsedI18nKeys, flatten, pruneNestedLocale } from './i18n-unused-keys.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, '../src/renderer/locales');
const WRITE = process.argv.includes('--write');

const { unused } = collectUsedI18nKeys();
const toRemove = new Set(unused);

if (toRemove.size === 0) {
  console.log('No unused keys to prune.');
  process.exit(0);
}

console.log(`${WRITE ? 'Pruning' : 'Dry-run:'} ${toRemove.size} unused key(s)`);

const localeDirs = readdirSync(LOCALES_DIR).filter((d) => {
  const full = join(LOCALES_DIR, d);
  return statSync(full).isDirectory();
});

for (const dir of localeDirs) {
  const path = join(LOCALES_DIR, dir, 'translation.json');
  const raw = readFileSync(path, 'utf8');
  const json = JSON.parse(raw);
  const before = Object.keys(flatten(json)).length;
  pruneNestedLocale(json, toRemove);
  const after = Object.keys(flatten(json)).length;
  const removed = before - after;
  if (removed > 0) {
    console.log(`  ${dir}: removed ${removed} key(s) (${before} → ${after})`);
    if (WRITE) {
      writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
    }
  }
}

if (!WRITE) {
  console.log('\nRe-run with --write to apply.');
}

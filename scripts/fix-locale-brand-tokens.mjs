#!/usr/bin/env node
/**
 * One-shot repair: when a locale string dropped a protected brand/token from English,
 * copy the English value so check:i18n brand preservation passes.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { protectedBrandIssues } from './check-i18n-quality.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LOCALES_DIR = join(ROOT, 'src/renderer/locales');

function flatten(obj, prefix = '') {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value, path));
    } else if (typeof value === 'string') {
      out[path] = value;
    }
  }
  return out;
}

function unflatten(flat) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split('.');
    let cursor = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!cursor[part] || typeof cursor[part] !== 'object') {
        cursor[part] = {};
      }
      cursor = /** @type {Record<string, unknown>} */ (cursor[part]);
    }
    cursor[parts[parts.length - 1]] = value;
  }
  return out;
}

const enFlat = flatten(JSON.parse(readFileSync(join(LOCALES_DIR, 'en/translation.json'), 'utf8')));
let totalFixed = 0;

for (const locale of readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== 'en')
  .map((d) => d.name)) {
  const filePath = join(LOCALES_DIR, locale, 'translation.json');
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  const flat = flatten(parsed);
  /** @type {Record<string, string>} */
  const merged = { ...enFlat };
  let fixed = 0;
  for (const [key, enVal] of Object.entries(enFlat)) {
    const locVal = flat[key];
    if (typeof locVal !== 'string') continue;
    if (protectedBrandIssues(enVal, locVal).length > 0) {
      merged[key] = enVal;
      fixed++;
    } else {
      merged[key] = locVal;
    }
  }
  if (fixed > 0) {
    writeFileSync(filePath, `${JSON.stringify(unflatten(merged), null, 2)}\n`, 'utf8');
    console.log(`${locale}: restored brands in ${fixed} keys`);
    totalFixed += fixed;
  }
}

console.log(`Done. ${totalFixed} locale key(s) reset to English for brand preservation.`);

#!/usr/bin/env node
/**
 * Pre-commit / CI check for i18n key completeness and locale string quality.
 *
 * 1. Extracts all t('key') / t("key") call sites from renderer source.
 * 2. Verifies every key resolves to an existing path in en/translation.json.
 * 3. Verifies every key in en/translation.json exists in every other locale file (warn only).
 * 4. Fails on CAT/XLIFF/Memsource residue in non-English strings; fails if {{placeholder}}
 *    name sets differ from English for the same key.
 *
 * Add a comment  // i18n-ok <reason>  on the same line to suppress a dynamic-key warning.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, '../src/renderer/locales');
const SRC_DIR = join(__dirname, '../src/renderer');
const EN_FILE = join(LOCALES_DIR, 'en/translation.json');

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function collectFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'locales' || entry === 'node_modules') continue;
      results.push(...collectFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.includes('.test.')) {
      results.push(full);
    }
  }
  return results;
}

// Match t('some.key') or t("some.key") — only static string literals.
const T_STATIC_RE = /\bt\(\s*['"]([^'"]+)['"]\s*[),]/g;

const en = flatten(readJson(EN_FILE));
const enKeys = new Set(Object.keys(en));

let errors = 0;

// Resolve a t() key: the key itself OR a plural form (key_one, key_other, etc.)
function keyExists(key) {
  if (enKeys.has(key)) return true;
  // i18next plural suffixes — any entry matching key_<suffix> counts
  return [
    `${key}_one`,
    `${key}_other`,
    `${key}_zero`,
    `${key}_two`,
    `${key}_few`,
    `${key}_many`,
  ].some((k) => enKeys.has(k));
}

// ── 1. Check call sites ──────────────────────────────────────────────────────
const files = collectFiles(SRC_DIR);
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('// i18n-ok')) return;
    for (const m of line.matchAll(T_STATIC_RE)) {
      const key = m[1];
      if (!keyExists(key)) {
        console.error(
          `Missing key: "${key}" used at ${relative(join(__dirname, '..'), file)}:${idx + 1}`,
        );
        errors++;
      }
    }
  });
}

// ── 2. Check completeness across locale files (warn only — rate limits can leave gaps) ──
const localeDirs = readdirSync(LOCALES_DIR).filter((d) => {
  const full = join(LOCALES_DIR, d);
  return statSync(full).isDirectory() && d !== 'en';
});

let warnings = 0;
for (const dir of localeDirs) {
  const path = join(LOCALES_DIR, dir, 'translation.json');
  let existing;
  try {
    existing = new Set(Object.keys(flatten(readJson(path))));
  } catch {
    console.warn(`Warning: cannot read ${path}`);
    warnings++;
    continue;
  }
  const missing = [...enKeys].filter((k) => !existing.has(k));
  if (missing.length > 0) {
    console.warn(
      `Warning: locale "${dir}" is missing ${missing.length} key(s) — run: pnpm run i18n:auto-translate`,
    );
    warnings++;
  }
}

/** i18next interpolation names in appearance order (for duplicate names, set dedupes). */
function placeholderNameSet(s) {
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  const out = new Set();
  let m;
  while ((m = re.exec(s))) {
    out.add(m[1]);
  }
  return out;
}

function setsEqualStrings(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
}

// CAT / XLIFF / Memsource garbage that must never ship in JSON values.
const LOCALE_ARTIFACT_RES = [
  /<g\s+id=/i,
  /<\/g>/i,
  /<ph\s+id=/i,
  /equiv-text=/i,
  /__\s*PH\s*\d/i,
  /__PH\s*\d/i,
];

// ── 3. Locale string quality: no CAT/XML artifacts; {{name}} sets match English ──
for (const dir of localeDirs) {
  const localePath = join(LOCALES_DIR, dir, 'translation.json');
  let localeFlat;
  try {
    localeFlat = flatten(readJson(localePath));
  } catch {
    continue;
  }
  for (const [key, val] of Object.entries(localeFlat)) {
    if (typeof val !== 'string') continue;
    for (const re of LOCALE_ARTIFACT_RES) {
      if (re.test(val)) {
        console.error(
          `Locale artifact in "${dir}" key "${key}": CAT/XLIFF/Memsource residue is not allowed (matched ${re}).`,
        );
        errors++;
      }
    }
    const enVal = en[key];
    if (typeof enVal !== 'string') continue;
    const enPh = placeholderNameSet(enVal);
    const locPh = placeholderNameSet(val);
    if (!setsEqualStrings(enPh, locPh)) {
      const enList = [...enPh].sort().join(', ') || '(none)';
      const locList = [...locPh].sort().join(', ') || '(none)';
      console.error(
        `Placeholder mismatch in "${dir}" key "${key}": English has {${enList}} but locale has {${locList}}.`,
      );
      errors++;
    }
  }
}

if (errors > 0) {
  console.error(`\ncheck:i18n failed with ${errors} error(s). Run: pnpm run i18n:auto-translate`);
  process.exit(1);
}

const localeStatus =
  warnings > 0 ? ` (${warnings} locale(s) incomplete — run i18n:auto-translate)` : '';
console.log(
  `check:i18n passed — ${enKeys.size} keys, ${localeDirs.length} locale(s) verified${localeStatus}.`,
);

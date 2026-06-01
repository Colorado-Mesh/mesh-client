#!/usr/bin/env node
/**
 * Pre-commit / CI check for i18n key completeness and locale string quality.
 *
 * 1. Extracts all t('key') / t("key") call sites from renderer source.
 * 2. Verifies every key resolves to an existing path in en/translation.json.
 * 3. Verifies every key in en/translation.json exists in every other locale file (warn only).
 * 4. Fails on CAT/XLIFF/Memsource residue in non-English strings; fails if {{placeholder}}
 *    name sets differ from English for the same key.
 * 5. Fails on locale quality issues (mojibake, broken meshtastic://, false friends, etc.)
 *    via check-i18n-quality.mjs.
 *
 * Add a comment  // i18n-ok <reason>  on the same line to suppress a dynamic-key warning.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  interpolationPlaceholderIssues,
  localeStringQualityIssues,
  protectedBrandIssues,
} from './check-i18n-quality.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, '../src/renderer/locales');

/** Log copy for opaque rooms-hello-* codes from check-i18n-quality.mjs (kept here for CodeQL). */
const ROOMS_HELLO_FALSE_FRIEND_LOG = {
  cs: 'roomsPanel hello password: keep wire password "hello", not Czech greeting "ahoj"',
  de: 'roomsPanel hello password: keep wire password "hello", not German greeting "Hallo"',
  es: 'roomsPanel hello password: keep wire password "hello", not Spanish greeting "hola"',
  fr: 'roomsPanel hello password: keep wire password "hello", not French greeting "bonjour"',
  id: 'roomsPanel hello password: keep wire password "hello", not Indonesian greeting "halo"',
  it: 'roomsPanel hello password: keep wire password "hello", not Italian greeting "ciao"',
  'pt-BR': 'roomsPanel hello password: keep wire password "hello", not Portuguese greeting "olá"',
  nl: 'roomsPanel hello password: keep wire password "hello", not Dutch greeting "hallo"',
  pl: 'roomsPanel hello password: keep wire password "hello", not Polish greeting "witaj"',
  ru: 'roomsPanel hello password: keep wire password "hello", not Russian greeting "привет"',
  tr: 'roomsPanel hello password: keep wire password "hello", not Turkish greeting "merhaba"',
  uk: 'roomsPanel hello password: keep wire password "hello", not Ukrainian greeting "привіт"',
};

const ROOMS_HELLO_MISSING_LITERAL_LOG =
  'MeshCore default guest password must stay literal "hello" in this hint';

function formatLocaleQualityIssueForLog(issue) {
  if (issue === 'rooms-hello-missing-literal') {
    return ROOMS_HELLO_MISSING_LITERAL_LOG;
  }
  const falseFriendPrefix = 'rooms-hello-false-friend:';
  if (issue.startsWith(falseFriendPrefix)) {
    const locale = issue.slice(falseFriendPrefix.length);
    return (
      ROOMS_HELLO_FALSE_FRIEND_LOG[locale] ??
      `roomsPanel hello password false friend for locale "${locale}"`
    );
  }
  return issue;
}
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
  const extra = [...existing].filter((k) => !enKeys.has(k));
  if (extra.length > 0) {
    console.error(`Orphan key(s) in "${dir}": ${extra.join(', ')}`);
    errors++;
  }
}

// These are protocol terms / acronyms intentionally displayed in English across all locales.
// Checked by leaf key name so nesting differences don't matter.
const VERBATIM_KEY_NAMES = new Set([
  'floodAdvertButton', // "Flood Advert" — mesh routing protocol term, not a water-flood advertisement
  'floodAdvertSection', // same
  'buttonFloodAdvert', // same
  'sendButtonDm', // "DM" — direct-message abbreviation, used verbatim internationally
]);

// "Hops" in mesh routing keeps tripping auto-translators into the brewing
// ingredient. If any of these tokens appear in a locale value, fail with a
// pointer to use the routing term instead. Substring match (no \b) because
// non-ASCII letters don't participate in JS regex word boundaries.
const FORBIDDEN_HOP_TOKENS = [
  // de
  'Hopfen',
  'hopfen',
  // es / pt-BR
  'Lúpulo',
  'lúpulo',
  // fr
  'Houblon',
  'houblon',
  // it
  'Luppolo',
  'luppolo',
  // tr
  'Şerbetçiotu',
  // ru / uk / pl / cs (include declined forms that stem-only checks miss)
  'Хмель',
  'хмель',
  'хмелю', // dative/locative of both ru хмель and uk хміль
  'Хміль',
  'хміль',
  'Chmiel',
  'chmiel',
  // zh: 酒花 = beer hops; 链路数目 (number of links) is the correct routing term.
  '酒花',
];

// ── 3. Locale string quality: no CAT/XML artifacts; {{name}} sets match English;
//      no leading/trailing whitespace or BOM that English lacks; brand names preserved.
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
    const enVal = en[key];
    if (typeof enVal !== 'string') continue;
    for (const issue of interpolationPlaceholderIssues(enVal, val)) {
      console.error(`Placeholder mismatch in "${dir}" key "${key}": ${issue}.`);
      errors++;
    }

    // Whitespace / BOM parity. If English lacks leading or trailing whitespace
    // (or the U+FEFF byte-order mark anywhere), the locale must too — those
    // creep in via copy/paste from CAT tools or auto-translate output and
    // cause visible gaps in the rendered UI.
    if (val.includes('\uFEFF') && !enVal.includes('\uFEFF')) {
      console.error(`Stray BOM (U+FEFF) in "${dir}" key "${key}": remove the byte-order mark.`);
      errors++;
    }
    if (val !== val.trimStart() && enVal === enVal.trimStart()) {
      console.error(
        `Leading whitespace in "${dir}" key "${key}": value=${JSON.stringify(val)} (English has none).`,
      );
      errors++;
    }
    if (val !== val.trimEnd() && enVal === enVal.trimEnd()) {
      console.error(
        `Trailing whitespace in "${dir}" key "${key}": value=${JSON.stringify(val)} (English has none).`,
      );
      errors++;
    }

    for (const issue of protectedBrandIssues(enVal, val)) {
      console.error(
        `Locale quality in "${dir}" key "${key}": ${issue}. EN=${JSON.stringify(enVal)} LOC=${JSON.stringify(val)}`,
      );
      errors++;
    }

    // Brewing-ingredient false-friend check. The English source uses "Hop"
    // / "Hops" only in the mesh-routing sense, never the plant. If a
    // forbidden hop-the-plant token leaks in, fail with guidance.
    for (const tok of FORBIDDEN_HOP_TOKENS) {
      if (val.includes(tok)) {
        console.error(
          `Brewing-hops false friend in "${dir}" key "${key}": "${tok}" should be the routing term (e.g. "Hops", "Saltos", "Sauts", "Хопи"). LOC=${JSON.stringify(val)}`,
        );
        errors++;
      }
    }

    // Verbatim-key check. Certain protocol terms must display in English in
    // all locales; their locale value must exactly equal the English value.
    // Matched by leaf key name to be independent of nesting changes.
    const leafKey = key.split('.').pop();
    if (VERBATIM_KEY_NAMES.has(leafKey) && val !== enVal) {
      console.error(
        `Verbatim key "${dir}" key "${key}": must equal English value ${JSON.stringify(enVal)} but has ${JSON.stringify(val)}.`,
      );
      errors++;
    }

    for (const issue of localeStringQualityIssues({
      locale: dir,
      flatKey: key,
      val,
      enVal,
    })) {
      console.error(
        `Locale quality in "${dir}" key "${key}": ${formatLocaleQualityIssueForLog(issue)}.`,
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

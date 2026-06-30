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
 *    via check-i18n-quality.mjs — including modulePanel.* strings still identical to English,
 *    appPanel.reduceMotionDesc loading-spinner false friends, appPanel.debugSnapshot*
 *    copied-toast false friends and mixed EN "snapshot" residue, rawPacketLog protocol tokens,
 *    flood/zero-hop advert commercial false friends on branch advert UI keys, MeshCore Open
 *    wire / g: GIF composer strings (protocol tokens, companion-wire false friends, Open-aware),
 *    connectionBanner serialReselectAction MT garbage, meshcoreGifHint bare-id false friends,
 *    meshcoreReactionEmojiOption contact/fabric false friends, Ukrainian broken apostrophe spacing,
 *    and roomsPanel collapse/expand hotel-room wording; MeshCore path-hash hop-count brewing false
 *    friends, CAT/Qt plural-form residue (&apos;, "plural form:"), short label parenthesis garbage,
 *    and meshcorePathHashModeHint CLI literal set path.hash.mode {0|1|2}; Reticulum identity/interface/
 *    peer/propagation UI (must-translate stack/config strings, disable parallax false friends, peer/
 *    probe/host/transport colleague false friends, sidecar build/Rust/cargo literals); peerDetailModal
 *    probe toasts and reticulumPing.failed connection false friends; CAT HTML entities, bracket
 *    [Data] placeholders, and sample-name garbage on nameLabel.
 *
 * Backfill untranslated modulePanel copy: pnpm run i18n:auto-translate -- --audit --prefix modulePanel.
 *
 * Branch-only quality pass (keys new/changed in en vs git HEAD):
 *   pnpm run check:i18n:branch
 *
 * Add a comment  // i18n-ok <reason>  on the same line to suppress a dynamic-key warning.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  interpolationPlaceholderIssues,
  localeStringQualityIssues,
  protectedBrandIssues,
  nodeListPanelConnectionCrossKeyIssues,
  roomsSavedPasswordsCrossKeyIssues,
  roomsSidebarMarkerCrossKeyIssues,
} from './check-i18n-quality.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR =
  process.env.MESH_CLIENT_LOCALES_DIR ?? join(__dirname, '../src/renderer/locales');

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
const BRANCH_ONLY = process.argv.includes('--branch') || process.env.I18N_CHECK_BRANCH === '1';
const EN_AT_HEAD_REF = 'HEAD:src/renderer/locales/en/translation.json';

function readJsonFromGit(ref) {
  const result = spawnSync('git', ['show', ref], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/** Keys added or changed in working-tree English vs git HEAD (null when unavailable). */
function resolveBranchEnglishKeys(enFlat) {
  const headEn = readJsonFromGit(EN_AT_HEAD_REF);
  if (!headEn) return null;
  const headFlat = flatten(headEn);
  const keys = new Set();
  for (const [key, val] of Object.entries(enFlat)) {
    if (!(key in headFlat) || headFlat[key] !== val) keys.add(key);
  }
  return keys;
}

function failLocalesDirAccess(err) {
  const reason = err instanceof Error ? err.message : String(err);
  console.error(
    `Error: locales directory is missing or inaccessible: ${LOCALES_DIR} (${reason}). ` +
      'Ensure src/renderer/locales exists and is readable.',
  );
  process.exit(1);
}

function readLocalesDirEntries() {
  try {
    return readdirSync(LOCALES_DIR);
  } catch (err) {
    failLocalesDirAccess(err);
  }
}

readLocalesDirEntries();

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

// Match t(`prefix.${expr}`) or t(`prefix.${expr}.suffix`) — dynamic keys with registered prefixes.
const T_TEMPLATE_RE = /\bt\(\s*`([^`]*)\$\{[^}]+\}([^`]*)`\s*[),]/g;

/**
 * Known dynamic t() template prefixes. Each entry verifies English keys exist for every
 * variant the template can resolve to. Add a row when introducing a new t(`…${var}…`) site.
 */
const DYNAMIC_T_PREFIXES = [
  { prefix: 'chatPanel.fetchStoreForwardHistoryError.', leafKeys: true },
  { prefix: 'radioPanel.deviceRoles.', suffixes: ['label', 'description'] },
  { prefix: 'radioPanel.rebroadcastModes.', suffixes: ['label', 'description'] },
  { prefix: 'radioPanel.displayUnits.', suffixes: ['label'] },
  { prefix: 'radioPanel.oledTypes.', suffixes: ['label'] },
  { prefix: 'radioPanel.displayModes.', suffixes: ['label'] },
  { prefix: 'radioPanel.btPairingModes.', suffixes: ['label'] },
  { prefix: 'meshcoreTelemetryPrivacy.', leafKeys: true },
  { prefix: 'diagnosticsPanel.foreignLoraProximitySnippet.', leafKeys: true },
];

const en = flatten(readJson(EN_FILE));
const enKeys = new Set(Object.keys(en));
const branchEnglishKeys = BRANCH_ONLY ? resolveBranchEnglishKeys(en) : null;

if (BRANCH_ONLY) {
  if (!branchEnglishKeys) {
    console.error(
      'Error: --branch requires git HEAD en/translation.json baseline. Commit or stage English keys first.',
    );
    process.exit(1);
  }
  if (branchEnglishKeys.size === 0) {
    console.log('check:i18n:branch passed — no new/changed English keys vs HEAD.');
    process.exit(0);
  }
  console.log(
    `check:i18n:branch — quality pass on ${branchEnglishKeys.size} key(s) new/changed vs HEAD`,
  );
}

let errors = 0;

function keysWithPrefix(prefix) {
  return [...enKeys].filter((k) => k.startsWith(prefix));
}

function verifyDynamicPrefix(prefixEntry) {
  const { prefix, leafKeys, suffixes } = prefixEntry;
  const matching = keysWithPrefix(prefix);
  if (matching.length === 0) {
    console.error(`Dynamic i18n prefix "${prefix}" has no keys in en/translation.json`);
    return 1;
  }
  if (leafKeys) {
    return 0;
  }
  let errCount = 0;
  const prefixLen = prefix.length;
  const ids = new Set();
  for (const key of matching) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefixLen);
    const dot = rest.indexOf('.');
    if (dot <= 0) continue;
    const id = rest.slice(0, dot);
    const suffix = rest.slice(dot + 1);
    if (suffixes.includes(suffix)) ids.add(id);
  }
  for (const id of ids) {
    for (const suffix of suffixes) {
      const full = `${prefix}${id}.${suffix}`;
      if (!enKeys.has(full)) {
        console.error(`Missing dynamic i18n key: "${full}" (required by prefix registry)`);
        errCount++;
      }
    }
  }
  return errCount;
}

for (const entry of DYNAMIC_T_PREFIXES) {
  errors += verifyDynamicPrefix(entry);
}

const registeredPrefixes = new Set(DYNAMIC_T_PREFIXES.map((e) => e.prefix));

function extractTemplatePrefix(beforeExpr, afterExpr) {
  const combined = `${beforeExpr}${afterExpr}`;
  for (const prefix of registeredPrefixes) {
    if (combined.startsWith(prefix)) return prefix;
  }
  return null;
}

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
    for (const m of line.matchAll(T_TEMPLATE_RE)) {
      const prefix = extractTemplatePrefix(m[1], m[2]);
      if (!prefix) {
        console.error(
          `Unregistered dynamic t() template at ${relative(join(__dirname, '..'), file)}:${idx + 1} — add prefix to DYNAMIC_T_PREFIXES in check-i18n.mjs`,
        );
        errors++;
      }
    }
  });
}

// ── 2. Check completeness across locale files (warn only — rate limits can leave gaps) ──
const localeDirs = readLocalesDirEntries().filter((d) => {
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
    console.error(`Error: cannot read ${path}`);
    errors++;
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
    if (branchEnglishKeys && !branchEnglishKeys.has(key)) continue;
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

  for (const issue of roomsSavedPasswordsCrossKeyIssues(localeFlat, en)) {
    if (branchEnglishKeys) continue;
    console.error(`Locale quality in "${dir}" (roomsPanel saved passwords): ${issue}.`);
    errors++;
  }

  for (const issue of roomsSidebarMarkerCrossKeyIssues(localeFlat, en)) {
    if (branchEnglishKeys) continue;
    console.error(`Locale quality in "${dir}" (roomsPanel sidebar markers): ${issue}.`);
    errors++;
  }

  for (const issue of nodeListPanelConnectionCrossKeyIssues(dir, localeFlat)) {
    if (branchEnglishKeys) continue;
    console.error(`Locale quality in "${dir}" (nodeListPanel connection tooltips): ${issue}.`);
    errors++;
  }
}

if (errors > 0) {
  console.error(`\ncheck:i18n failed with ${errors} error(s). Run: pnpm run i18n:auto-translate`);
  process.exit(1);
}

const localeStatus =
  warnings > 0 ? ` (${warnings} locale(s) incomplete — run i18n:auto-translate)` : '';
const branchStatus = branchEnglishKeys ? `, branch keys: ${branchEnglishKeys.size}` : '';
console.log(
  `check:i18n${BRANCH_ONLY ? ':branch' : ''} passed — ${enKeys.size} keys, ${localeDirs.length} locale(s) verified${branchStatus}${localeStatus}.`,
);

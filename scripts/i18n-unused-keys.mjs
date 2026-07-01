/**
 * Find translation keys in en/translation.json with no static or registered-dynamic usage.
 * Shared by check-i18n.mjs (--audit-unused) and one-off audits.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @typedef {{ prefix: string, leafKeys?: boolean, suffixes?: string[] }} DynamicTPrefix */

/** Keep in sync with DYNAMIC_T_PREFIXES in check-i18n.mjs */
export const DYNAMIC_T_PREFIXES = [
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

export function flatten(obj, prefix = '') {
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

function collectSourceFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'locales' || entry === 'node_modules') continue;
      results.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry)) {
      results.push(full);
    }
  }
  return results;
}

const T_STATIC_RE = /\b(?:t|i18n\.t)\(\s*['"]([^'"]+)['"]\s*[),]/g;
const T_TEMPLATE_RE = /\bt\(\s*`([^`]*)\$\{[^}]+\}([^`]*)`\s*[),]/g;
const QUOTED_LITERAL_RE = /['"]([^'"]+)['"]/g;
const I18N_OK_RE = /\/\/\s*i18n-ok\b/;

/** tabs.* keys resolved via appTabMappings tabLabelKey() and TAB_SLOT_IDS. */
function collectDynamicTabKeys(enKeys) {
  const tabSlotIdsPath = join(__dirname, '../src/renderer/lib/tabSlotIds.ts');
  const src = readFileSync(tabSlotIdsPath, 'utf8');
  const slotMatch = src.match(/export const TAB_SLOT_IDS = \[([\s\S]*?)\] as const/);
  if (!slotMatch) return new Set();
  const slots = [...slotMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1].toLowerCase());
  const used = new Set([
    'tabs.nomadnetwork',
    'tabs.contacts',
    'tabs.peers',
    'tabs.repeaters',
    'tabs.rooms',
  ]);
  for (const slot of slots) {
    const key = `tabs.${slot}`;
    if (enKeys.has(key)) used.add(key);
  }
  return used;
}

/**
 * @param {string} srcRoot Defaults to repo src/
 * @param {string} enFile Defaults to en/translation.json
 */
export function collectUsedI18nKeys(
  srcRoot = join(__dirname, '../src'),
  enFile = join(__dirname, '../src/renderer/locales/en/translation.json'),
) {
  const enFlat = flatten(JSON.parse(readFileSync(enFile, 'utf8')));
  const enKeys = new Set(Object.keys(enFlat));
  const registeredPrefixes = new Set(DYNAMIC_T_PREFIXES.map((e) => e.prefix));

  const usedStatic = new Set();
  const usedLiteralRef = new Set();
  const activeDynamicPrefixes = new Set();
  const unregisteredDynamicSites = [];

  for (const file of collectSourceFiles(srcRoot)) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, idx) => {
      if (I18N_OK_RE.test(line)) return;
      for (const m of line.matchAll(T_STATIC_RE)) {
        usedStatic.add(m[1]);
      }
      for (const m of line.matchAll(T_TEMPLATE_RE)) {
        const combined = `${m[1]}${m[2]}`;
        let matched = false;
        for (const prefix of registeredPrefixes) {
          if (combined.startsWith(prefix)) {
            activeDynamicPrefixes.add(prefix);
            matched = true;
          }
        }
        if (!matched) {
          unregisteredDynamicSites.push({ file, line: idx + 1, combined });
        }
      }
      for (const m of line.matchAll(QUOTED_LITERAL_RE)) {
        if (enKeys.has(m[1])) usedLiteralRef.add(m[1]);
      }
    });
  }

  for (const key of collectDynamicTabKeys(enKeys)) {
    usedLiteralRef.add(key);
  }

  const usedDynamic = new Set();
  for (const entry of DYNAMIC_T_PREFIXES) {
    if (!activeDynamicPrefixes.has(entry.prefix)) continue;
    for (const key of enKeys) {
      if (!key.startsWith(entry.prefix)) continue;
      if (entry.leafKeys) {
        usedDynamic.add(key);
        continue;
      }
      const rest = key.slice(entry.prefix.length);
      const dot = rest.indexOf('.');
      if (dot <= 0) continue;
      const suffix = rest.slice(dot + 1);
      if (entry.suffixes?.includes(suffix)) usedDynamic.add(key);
    }
  }

  const used = new Set([...usedStatic, ...usedDynamic, ...usedLiteralRef]);

  /** i18next plural suffixes when the base key is referenced */
  for (const key of [...usedStatic, ...usedLiteralRef]) {
    for (const pluralSuffix of ['_one', '_other', '_zero', '_two', '_few', '_many']) {
      const pluralKey = `${key}${pluralSuffix}`;
      if (enKeys.has(pluralKey)) used.add(pluralKey);
    }
  }

  const unused = [...enKeys].filter((k) => !used.has(k)).sort();
  return {
    enKeys,
    usedStatic,
    usedLiteralRef,
    usedDynamic,
    activeDynamicPrefixes: [...activeDynamicPrefixes],
    unregisteredDynamicSites,
    unused,
  };
}

/**
 * Remove flat keys from nested locale object (mutates copy).
 *
 * @param {Record<string, unknown>} obj
 * @param {Set<string>} flatKeysToRemove
 * @param {string} [prefix]
 */
export function pruneNestedLocale(obj, flatKeysToRemove, prefix = '') {
  for (const key of Object.keys(obj)) {
    const flatKey = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];
    if (typeof val === 'object' && val !== null) {
      pruneNestedLocale(/** @type {Record<string, unknown>} */ (val), flatKeysToRemove, flatKey);
      if (Object.keys(/** @type {Record<string, unknown>} */ (val)).length === 0) {
        Reflect.deleteProperty(obj, key);
      }
    } else if (flatKeysToRemove.has(flatKey)) {
      Reflect.deleteProperty(obj, key);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { unused, unregisteredDynamicSites, activeDynamicPrefixes } = collectUsedI18nKeys();
  console.log(`Active dynamic prefixes: ${activeDynamicPrefixes.join(', ') || '(none)'}`);
  console.log(`Unused keys: ${unused.length}`);
  if (unregisteredDynamicSites.length > 0) {
    console.warn(`Unregistered dynamic t() sites: ${unregisteredDynamicSites.length}`);
    for (const site of unregisteredDynamicSites.slice(0, 10)) {
      console.warn(`  ${site.file}:${site.line} → ${site.combined}`);
    }
  }
  for (const key of unused) console.log(key);
}

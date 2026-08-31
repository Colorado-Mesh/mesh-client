/**
 * Copy English verbatim into every locale for keep-English keys (protobuf-derived
 * region codes, modem presets, OLED part numbers). Machine translation mangles
 * these into prose, so this repairs any values already written.
 *
 * Usage: node scripts/i18n-repair-keep-english.mjs
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isKeepEnglishKey } from './i18n-auto-translate-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, '../src/renderer/locales');

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null) Object.assign(out, flatten(v, key));
    else out[key] = v;
  }
  return out;
}

function setDeep(target, key, value) {
  const parts = key.split('.');
  let cur = target;
  for (const part of parts.slice(0, -1)) {
    if (typeof cur[part] !== 'object' || cur[part] === null) cur[part] = {};
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
}

const enFlat = flatten(JSON.parse(readFileSync(join(LOCALES_DIR, 'en/translation.json'), 'utf8')));
const keepKeys = Object.keys(enFlat).filter(
  (k) => isKeepEnglishKey(k) && typeof enFlat[k] === 'string',
);

/**
 * Removes CAT-tool tag residue from a machine-translated value. Applied to a fixpoint:
 * a single pass would turn `<<i>>` into `<i>` and leave markup behind
 * (js/incomplete-multi-character-sanitization).
 */
function stripMarkupResidue(value) {
  let cleaned = value;
  let previous;
  do {
    previous = cleaned;
    cleaned = previous.replace(/<[^<>]*>/g, '').replace(/&#\d+;/g, '');
  } while (cleaned !== previous);
  return cleaned.trim();
}

let repaired = 0;
// withFileTypes rather than an existsSync guard: locales/ also holds loose modules
// (languages.ts), and a check-then-read would be a file-system race (js/file-system-race).
for (const entry of readdirSync(LOCALES_DIR, { withFileTypes: true })) {
  const dir = entry.name;
  if (!entry.isDirectory() || dir === 'en') continue;
  const file = join(LOCALES_DIR, `${dir}/translation.json`);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const flat = flatten(json);
  let changed = 0;
  for (const key of keepKeys) {
    if (flat[key] === enFlat[key]) continue;
    setDeep(json, key, enFlat[key]);
    changed++;
  }
  // Machine translation occasionally emits CAT-tool tag residue or stray padding
  // for radio config strings; strip it rather than shipping markup as UI copy.
  for (const [key, value] of Object.entries(flat)) {
    if (!key.startsWith('radioPanel.') || typeof value !== 'string') continue;
    if (isKeepEnglishKey(key)) continue;
    if (typeof enFlat[key] !== 'string') continue;
    const next = stripMarkupResidue(value) || enFlat[key];
    if (next === value) continue;
    setDeep(json, key, next);
    changed++;
  }
  // The enum re-key replaced numeric indices with enum names; drop the stale
  // numeric branches so locales stop carrying keys English no longer defines.
  for (const namespace of [
    'regions',
    'modemPresets',
    'deviceRoles',
    'rebroadcastModes',
    'oledTypes',
    'displayUnits',
  ]) {
    const branch = json.radioPanel?.[namespace];
    if (typeof branch !== 'object' || branch === null) continue;
    const kept = Object.entries(branch).filter(([name]) => !/^\d+$/.test(name));
    if (kept.length === Object.keys(branch).length) continue;
    changed += Object.keys(branch).length - kept.length;
    json.radioPanel[namespace] = Object.fromEntries(kept);
  }

  if (changed > 0) {
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
    repaired += changed;
    console.log(`${dir}: reset ${changed} keep-English key(s) to English`);
  }
}

console.log(`i18n-repair-keep-english: ${repaired} value(s) reset`);

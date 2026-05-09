#!/usr/bin/env node
/**
 * One-off / maintenance: repair Chinese locale strings that use CAT-tool
 * placeholders (__ PH0 __) instead of i18next {{name}} interpolations.
 *
 * Run from repo root: node scripts/repair-zh-i18n-placeholders.mjs
 *
 * Failure point: missing English key or placeholder count mismatch — logs and exits 1.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, '../src/renderer/locales');
const EN_PATH = join(LOCALES_DIR, 'en/translation.json');
const ZH_PATH = join(LOCALES_DIR, 'zh/translation.json');

const PH_RE = /__\s*PH\s*(\d+)\s*__/g;

/** Flatten nested JSON to dot keys (same shape as check-i18n.mjs). */
function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

function orderedPlaceholdersFromEn(enString) {
  const names = [];
  const re = /\{\{([^}]+)\}\}/g;
  let m;
  while ((m = re.exec(enString))) {
    names.push(`{{${m[1]}}}`);
  }
  return names;
}

/** Explicit fixes (wrong MT / XLIFF garbage not fixable by PH mapping alone). */
const OVERRIDES = {
  'diagnosticsPanel.noIssues': '无问题',
  'diagnosticsPanel.routeColumn': '路由',
};

function repairString(flatKey, zhVal, enFlat) {
  if (typeof zhVal !== 'string') return { value: zhVal, changed: false };

  if (Object.prototype.hasOwnProperty.call(OVERRIDES, flatKey)) {
    return { value: OVERRIDES[flatKey], changed: zhVal !== OVERRIDES[flatKey] };
  }

  if (!PH_RE.test(zhVal)) {
    PH_RE.lastIndex = 0;
    return { value: zhVal, changed: false };
  }
  PH_RE.lastIndex = 0;

  const enVal = enFlat[flatKey];
  if (typeof enVal !== 'string') {
    console.error(`Missing English string for key: ${flatKey}`);
    return { value: zhVal, changed: false, error: true };
  }

  const names = orderedPlaceholdersFromEn(enVal);
  let maxIdx = -1;
  for (const m of zhVal.matchAll(PH_RE)) {
    maxIdx = Math.max(maxIdx, parseInt(m[1], 10));
  }
  if (names.length <= maxIdx) {
    console.error(
      `Placeholder mismatch for ${flatKey}: zh needs PH0..PH${maxIdx}, en has ${names.length} {{}} in: ${JSON.stringify(enVal)}`,
    );
    return { value: zhVal, changed: false, error: true };
  }

  const next = zhVal.replace(PH_RE, (_, n) => {
    const i = parseInt(n, 10);
    return names[i] ?? `{{MISSING_PH_${i}}}`;
  });
  if (next.includes('{{MISSING_PH_')) {
    console.error(`Replacement failed for ${flatKey}`);
    return { value: zhVal, changed: false, error: true };
  }
  return { value: next, changed: next !== zhVal };
}

function walkRepair(obj, pathParts, enFlat) {
  let changed = false;
  let error = false;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const parts = [...pathParts, k];
    const flatKey = parts.join('.');
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const sub = walkRepair(v, parts, enFlat);
      changed ||= sub.changed;
      error ||= sub.error;
    } else if (typeof v === 'string') {
      const r = repairString(flatKey, v, enFlat);
      if (r.error) error = true;
      if (r.changed) {
        obj[k] = r.value;
        changed = true;
      }
    }
  }
  return { changed, error };
}

const en = JSON.parse(readFileSync(EN_PATH, 'utf8'));
const zh = JSON.parse(readFileSync(ZH_PATH, 'utf8'));
const enFlat = flatten(en);

const { changed, error } = walkRepair(zh, [], enFlat);
if (error) {
  process.exit(1);
}

if (changed) {
  writeFileSync(ZH_PATH, `${JSON.stringify(zh, null, 2)}\n`, 'utf8');
  console.debug(`Updated ${ZH_PATH}`);
} else {
  console.debug('No changes needed');
}

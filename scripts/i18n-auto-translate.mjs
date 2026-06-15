#!/usr/bin/env node
/**
 * Auto-translate missing keys in non-English locale files.
 *
 * Supports backends:
 *   1. LibreTranslate  — set LIBRETRANSLATE_URL + optionally LIBRETRANSLATE_KEY
 *   2. MyMemory        — default; uses MYMEMORY_EMAIL or info@coloradomesh.org for 50 k words/day quota
 *
 * Usage:
 *   node scripts/i18n-auto-translate.mjs
 *   node scripts/i18n-auto-translate.mjs --all
 *   node scripts/i18n-auto-translate.mjs --audit   (also retranslates values still identical to English)
 *   I18N_TRANSLATE_ALL=1 node scripts/i18n-auto-translate.mjs
 *   LIBRETRANSLATE_URL=https://lt.example.com LIBRETRANSLATE_KEY=xxx node scripts/i18n-auto-translate.mjs
 *   MYMEMORY_EMAIL=you@example.com node scripts/i18n-auto-translate.mjs
 *
 * By default (with git), only keys that are new in en/translation.json vs HEAD are translated
 * for each locale. Use --all or I18N_TRANSLATE_ALL=1 to backfill every key missing from a locale.
 * Use --audit to additionally retranslate any key whose locale value is still identical to English.
 */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { constants as http2Constants } from 'node:http2';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  filterMissingKeysToTranslate,
  restorePlaceholders,
  sanitizeLocaleTranslationJsonFileBodyForDisk,
  setDeepLocaleValue,
  stripPlaceholders,
} from './i18n-auto-translate-lib.mjs';

/** RFC 6585 / IANA: Too Many Requests (avoid hardcoded status literals for static analysis). */
const HTTP_STATUS_TOO_MANY_REQUESTS = http2Constants.HTTP_STATUS_TOO_MANY_REQUESTS;
const MYMEMORY_RATE_LIMIT_CODE = 'MYMEMORY_RATE_LIMIT';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, '../src/renderer/locales');
const LOCALES_ROOT = resolve(LOCALES_DIR);
const WRITE_SUBPROCESS = join(__dirname, 'i18n-auto-translate-write-subprocess.mjs');

const LT_URL = process.env.LIBRETRANSLATE_URL ?? '';
const LT_KEY = process.env.LIBRETRANSLATE_KEY ?? '';
const MM_EMAIL = process.env.MYMEMORY_EMAIL ?? 'info@coloradomesh.org';

// Language code mappings for each backend
const LANG_CODES = [
  { dir: 'es', lt: 'es', mm: 'ES', g: 'es' },
  { dir: 'uk', lt: 'uk', mm: 'UK', g: 'uk' },
  { dir: 'de', lt: 'de', mm: 'DE', g: 'de' },
  { dir: 'zh', lt: 'zh-Hans', mm: 'ZH', g: 'zh-CN' },
  { dir: 'pt-BR', lt: 'pt-BR', mm: 'PT-BR', g: 'pt-BR' },
  { dir: 'fr', lt: 'fr', mm: 'FR', g: 'fr' },
  { dir: 'it', lt: 'it', mm: 'IT', g: 'it' },
  { dir: 'pl', lt: 'pl', mm: 'PL', g: 'pl' },
  { dir: 'cs', lt: 'cs', mm: 'CS', g: 'cs' },
  { dir: 'ja', lt: 'ja', mm: 'JA', g: 'ja' },
  { dir: 'ru', lt: 'ru', mm: 'RU', g: 'ru' },
  { dir: 'nl', lt: 'nl', mm: 'NL', g: 'nl' },
  { dir: 'ko', lt: 'ko', mm: 'KO', g: 'ko' },
  { dir: 'tr', lt: 'tr', mm: 'TR', g: 'tr' },
  { dir: 'id', lt: 'id', mm: 'ID', g: 'id' },
];

// ── Utilities ─────────────────────────────────────────────────────────────────

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
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function readJsonFromGit(refPath) {
  const result = spawnSync('git', ['show', refPath], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

// Small delay to be kind to free APIs
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, options = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── LibreTranslate backend ────────────────────────────────────────────────────

async function translateLibreTranslate(text, targetLt) {
  const { stripped, placeholders } = stripPlaceholders(text);
  const body = {
    q: stripped,
    source: 'en',
    target: targetLt,
    format: 'text',
    ...(LT_KEY ? { api_key: LT_KEY } : {}),
  };
  const res = await fetchWithTimeout(`${LT_URL}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`LibreTranslate ${res.status}: ${txt}`);
  }
  const json = await res.json();
  return restorePlaceholders(json.translatedText ?? stripped, placeholders);
}

// ── MyMemory backend ──────────────────────────────────────────────────────────

async function translateMyMemory(text, targetMm) {
  const { stripped, placeholders } = stripPlaceholders(text);
  const params = new URLSearchParams({
    q: stripped,
    langpair: `en|${targetMm}`,
    ...(MM_EMAIL ? { de: MM_EMAIL } : {}),
  });
  const url = `https://api.mymemory.translated.net/get?${params.toString()}`;

  const fetchTranslation = async () => {
    const res = await fetchWithTimeout(url);
    if (res.status === HTTP_STATUS_TOO_MANY_REQUESTS) {
      throw Object.assign(new Error('MyMemory rate limited'), { code: MYMEMORY_RATE_LIMIT_CODE });
    }
    if (!res.ok) {
      throw new Error(`MyMemory ${res.status}`);
    }
    const json = await res.json();
    if (json.quotaFinished) {
      throw new Error(
        'MyMemory daily quota finished. ' +
          'The script defaults MYMEMORY_EMAIL to info@coloradomesh.org; set MYMEMORY_EMAIL to override. ' +
          'Or set LIBRETRANSLATE_URL + LIBRETRANSLATE_KEY to use a LibreTranslate instance.',
      );
    }
    const translated = json.responseData?.translatedText ?? stripped;
    return restorePlaceholders(translated, placeholders);
  };

  try {
    return await fetchTranslation();
  } catch (err) {
    if (typeof err === 'object' && err !== null && err.code === MYMEMORY_RATE_LIMIT_CODE) {
      throw err;
    }
    if (err instanceof Error && err.message.startsWith('MyMemory daily quota')) {
      throw err;
    }
    await sleep(1200);
    return await fetchTranslation();
  }
}

// ── Google Translate (public endpoint) fallback ───────────────────────────────

async function translateGoogle(text, targetGoogle) {
  const { stripped, placeholders } = stripPlaceholders(text);
  const params = new URLSearchParams({
    client: 'gtx',
    sl: 'en',
    tl: targetGoogle,
    dt: 't',
    q: stripped,
  });
  const url = `https://translate.googleapis.com/translate_a/single?${params.toString()}`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await sleep(500 * attempt);
    }
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      lastErr = new Error(`GoogleTranslate ${res.status}`);
      continue;
    }
    const json = await res.json();
    const translated = Array.isArray(json?.[0])
      ? json[0].map((chunk) => (Array.isArray(chunk) ? (chunk[0] ?? '') : '')).join('')
      : stripped;
    return restorePlaceholders(translated || stripped, placeholders);
  }
  throw lastErr ?? new Error('GoogleTranslate unknown error');
}

// ── Router ────────────────────────────────────────────────────────────────────

let myMemoryDisabledForRun = false;
let googleFallbackAnnounced = false;

function noteGoogleFallbackActive(reason) {
  if (googleFallbackAnnounced) return;
  googleFallbackAnnounced = true;
  console.warn(`  Using Google only now (MyMemory skipped). ${reason}`);
}

async function translate(text, lang) {
  if (LT_URL) {
    try {
      return await translateLibreTranslate(text, lang.lt);
    } catch (err) {
      console.warn(`  LibreTranslate: ${err.message} → MyMemory/Google`);
    }
  }
  if (!myMemoryDisabledForRun) {
    try {
      return await translateMyMemory(text, lang.mm);
    } catch (err) {
      console.warn(`  MyMemory: ${err.message} → Google`);
      if (typeof err === 'object' && err !== null && err.code === MYMEMORY_RATE_LIMIT_CODE) {
        myMemoryDisabledForRun = true;
        noteGoogleFallbackActive('rate limit');
      }
    }
  }
  return translateGoogle(text, lang.g);
}

/** Short tag for startup line only. */
function shortRunMode(translateAllGaps, hasGitBaseline, auditIdentical) {
  if (auditIdentical) return translateAllGaps ? '--all --audit' : '--audit';
  if (translateAllGaps) return '--all gap vs EN';
  if (hasGitBaseline) return 'incremental (new EN vs HEAD)';
  return 'gap vs EN (no HEAD)';
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const translateAllGaps = process.argv.includes('--all') || process.env.I18N_TRANSLATE_ALL === '1';
  const auditIdentical = process.argv.includes('--audit') || process.env.I18N_AUDIT === '1';

  const enPath = join(LOCALES_DIR, 'en/translation.json');
  const en = readJson(enPath);
  const enFlat = flatten(en);
  const enKeys = Object.keys(enFlat);

  const enAtHead = readJsonFromGit('HEAD:src/renderer/locales/en/translation.json');
  const hasGitBaseline = Boolean(enAtHead);
  let addedEnglishKeysSet = null;
  /** Stable order of new EN paths vs HEAD (incremental); empty if N/A. */
  let addedEnglishKeysOrdered = [];
  if (enAtHead) {
    const enAtHeadKeys = new Set(Object.keys(flatten(enAtHead)));
    const addedEnglishKeys = enKeys.filter((key) => !enAtHeadKeys.has(key));
    if (addedEnglishKeys.length === 0 && !translateAllGaps && !auditIdentical) {
      console.log(
        'No new English keys compared to git HEAD; incremental mode would fill nothing — skipping auto-translate.',
      );
      process.exit(0);
    }
    if (!translateAllGaps) {
      addedEnglishKeysSet = new Set(addedEnglishKeys);
      addedEnglishKeysOrdered = addedEnglishKeys;
    }
  }

  let anyMissing = false;
  let anyKeysFailed = false;
  const missingByLang = new Map();
  for (const lang of LANG_CODES) {
    const existing = flatten(readJson(join(LOCALES_DIR, `${lang.dir}/translation.json`)));
    const missing = filterMissingKeysToTranslate(enKeys, existing, addedEnglishKeysSet, {
      translateAllGaps,
      hasGitBaseline,
      auditIdentical,
      enFlat,
    });
    const keysToTranslateCount =
      !translateAllGaps && addedEnglishKeysOrdered.length > 0 && !auditIdentical
        ? addedEnglishKeysOrdered.filter((k) => !(k in existing) && typeof enFlat[k] === 'string')
            .length
        : missing.filter((k) => typeof enFlat[k] === 'string').length;
    if (missing.length > 0) {
      anyMissing = true;
      missingByLang.set(lang, { existing, missing, keysToTranslateCount });
    }
  }

  if (!anyMissing) {
    console.log(
      'Nothing to do: no locale is missing any keys that this run would machine-translate (under the current mode).',
    );
    process.exit(0);
  }

  const localeQueue = [...missingByLang.entries()];
  const localeRunTotal = localeQueue.length;

  let totalScheduledJobs = 0;
  for (const [, { keysToTranslateCount }] of missingByLang) {
    totalScheduledJobs += keysToTranslateCount;
  }

  const apiTag = LT_URL ? `LibreTranslate ${LT_URL}` : 'MyMemory→Google';
  console.log(
    `${apiTag} · ${shortRunMode(translateAllGaps, hasGitBaseline, auditIdentical)} · ` +
      `${localeRunTotal}/${LANG_CODES.length} locales · ${totalScheduledJobs} jobs`,
  );
  if (!translateAllGaps && !hasGitBaseline) {
    console.warn('No HEAD:en baseline — not incremental.');
  }

  let completedJobs = 0;

  for (let localeRunIndex = 0; localeRunIndex < localeQueue.length; localeRunIndex++) {
    const [lang, { missing }] = localeQueue[localeRunIndex];
    const localeOrdinal = localeRunIndex + 1;
    const scanOrdinal = LANG_CODES.findIndex((l) => l.dir === lang.dir) + 1;

    const target = readJson(join(LOCALES_DIR, `${lang.dir}/translation.json`));
    const existingFlat = flatten(target);
    const keysToTranslate =
      !translateAllGaps && !auditIdentical && addedEnglishKeysOrdered.length > 0
        ? addedEnglishKeysOrdered.filter(
            (k) => !(k in existingFlat) && typeof enFlat[k] === 'string',
          )
        : missing.filter((k) => typeof enFlat[k] === 'string');
    const workTotal = keysToTranslate.length;
    const missingTotal = missing.length;

    const q = `${lang.dir} queue ${localeOrdinal}/${localeRunTotal} lang ${scanOrdinal}/${LANG_CODES.length}`;
    if (workTotal === 0) {
      console.log(`${q} · 0 jobs (skip)`);
      continue;
    }
    if (missingTotal > workTotal) {
      console.log(`${q} · note: ${missingTotal - workTotal} non-string missing paths skipped`);
    }
    if (!translateAllGaps && !auditIdentical && addedEnglishKeysSet) {
      console.log(
        `${q} · translate ${workTotal}/${addedEnglishKeysSet.size} new-EN vs HEAD here · ${workTotal} API calls`,
      );
    } else {
      console.log(`${q} · ${workTotal} jobs`);
    }
    if ((localeRunTotal > 1 || totalScheduledJobs > workTotal) && completedJobs > 0) {
      console.log(`  run so far ${completedJobs}/${totalScheduledJobs}`);
    }
    if (
      !translateAllGaps &&
      !auditIdentical &&
      addedEnglishKeysSet &&
      workTotal > addedEnglishKeysSet.size
    ) {
      console.warn(
        `  Unexpected: locale job count (${workTotal}) exceeds incremental new-EN path count (${addedEnglishKeysSet.size}) — report this as a bug.`,
      );
    }

    let count = 0;
    let failed = 0;
    const progressEvery = workTotal <= 30 ? 1 : 25;
    const truncateKey = (k) => (k.length > 64 ? `${k.slice(0, 61)}…` : k);

    let localeJobDone = 0;
    for (const key of keysToTranslate) {
      const englishValue = enFlat[key];
      try {
        const translated = await translate(englishValue, lang);
        setDeepLocaleValue(target, key, translated);
        count++;
        localeJobDone++;
        completedJobs++;
        if (
          localeJobDone === 1 ||
          localeJobDone === workTotal ||
          localeJobDone % progressEvery === 0
        ) {
          console.log(`  [${lang.dir}] ${localeJobDone}/${workTotal} · ${truncateKey(key)}`);
        }
        await sleep(300);
      } catch (err) {
        console.error(
          `  Failed to machine-translate one missing string — locale ${lang.dir}, key "${key}": ${err.message}`,
        );
        failed++;
      }
    }
    if (failed > 0) {
      anyKeysFailed = true;
      console.error(
        `  ${failed} missing key(s) in locale ${lang.dir} could not be machine-translated — run again to retry only failed keys (already-filled keys stay saved).`,
      );
    }

    const outPath = resolve(join(LOCALES_ROOT, `${lang.dir}/translation.json`));
    const body = sanitizeLocaleTranslationJsonFileBodyForDisk(
      JSON.stringify(target, null, 2) + '\n',
    );
    const payload = JSON.stringify({ outPath, body });
    const persist = spawnSync(process.execPath, [WRITE_SUBPROCESS, LOCALES_ROOT], {
      input: payload,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
    });
    if (persist.error) {
      throw persist.error;
    }
    if (persist.status !== 0) {
      throw new Error(
        persist.stderr?.trim() || `locale persist subprocess exited with status ${persist.status}`,
      );
    }
    const tail =
      localeRunTotal > 1 || totalScheduledJobs > workTotal
        ? ` · run ${completedJobs}/${totalScheduledJobs}`
        : '';
    console.log(`  ${lang.dir}: saved +${count} keys${tail}`);
  }

  if (anyKeysFailed) {
    console.error('Done with failures (exit 1).');
  } else {
    console.log('Done (exit 0).');
  }
  return anyKeysFailed;
}

main()
  .then((hadFailures) => {
    process.exit(hadFailures ? 1 : 0);
  })
  .catch((err) => {
    console.error('Auto-translate aborted with an unexpected error:', err);
    process.exit(1);
  });

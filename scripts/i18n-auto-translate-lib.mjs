/**
 * Pure helpers for i18n-auto-translate.mjs (unit-tested).
 */

/** MyMemory/CAT often spaces out __PHn__ tokens (e.g. __ PH0 __, __ PH 1 __). */
export const MT_PLACEHOLDER_TOKEN_RE = /__\s*PH\s*(\d+)\s*__/gi;

/**
 * Replace i18next {{name}} tokens with opaque __PHn__ markers before MT.
 *
 * @param {string} str
 * @returns {{ stripped: string; placeholders: string[] }}
 */
export function stripPlaceholders(str) {
  const placeholders = [];
  const stripped = str.replace(/\{\{[^}]+\}\}/g, (m) => {
    const idx = placeholders.length;
    placeholders.push(m);
    return `__PH${idx}__`;
  });
  return { stripped, placeholders };
}

/**
 * Restore i18next placeholders after MT, tolerating spaced __ PH n __ variants.
 *
 * @param {string} str
 * @param {string[]} placeholders
 * @returns {string}
 */
export function restorePlaceholders(str, placeholders) {
  return str.replace(MT_PLACEHOLDER_TOKEN_RE, (_, idx) => placeholders[Number(idx)] ?? '');
}

/** Segments that must not be used as nested object keys (prototype pollution). */
const UNSAFE_LOCALE_KEY_PARTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Strip dangerous control characters from a UTF-8 JSON document before `writeFileSync`.
 * Preserves TAB/LF/CR so pretty-printed `JSON.stringify` output stays valid JSON.
 * Remote translation APIs return strings that become file content; this blocks NUL/C1
 * controls (and Unicode line/paragraph separators) from reaching the locale file body.
 *
 * @param {string} body
 * @returns {string}
 */
export function sanitizeLocaleTranslationJsonFileBodyForDisk(body) {
  const noCtl = String(body).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u2028\u2029]/g, ''); // eslint-disable-line no-control-regex
  try {
    return JSON.stringify(JSON.parse(noCtl), null, 2) + '\n';
  } catch {
    // catch-no-log-ok: if stripped text is not valid JSON, persist control-stripped body only
    return noCtl;
  }
}

/**
 * Set a nested string value on a plain locale object using a dotted path (e.g. `tabs.chat`).
 * Rejects prototype-pollution paths; only assigns through own enumerable object slots.
 *
 * @param {Record<string, unknown>} obj
 * @param {string} dotKey
 * @param {string} value
 */
export function setDeepLocaleValue(obj, dotKey, value) {
  const parts = dotKey.split('.');
  if (parts.length === 0 || parts.some((p) => p.length === 0)) {
    throw new Error(`Invalid locale key path (empty segment): "${dotKey}"`);
  }
  for (const part of parts) {
    if (UNSAFE_LOCALE_KEY_PARTS.has(part)) {
      throw new Error(`Unsafe locale key segment "${part}" in "${dotKey}"`);
    }
  }

  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const existing =
      Object.hasOwn(cur, part) &&
      typeof cur[part] === 'object' &&
      cur[part] !== null &&
      !Array.isArray(cur[part])
        ? /** @type {Record<string, unknown>} */ (cur[part])
        : undefined;
    if (existing === undefined) {
      const next = {};
      cur[part] = next;
      cur = next;
    } else {
      cur = existing;
    }
  }
  const last = parts[parts.length - 1];
  cur[last] = value;
}

// Multi-word brands / protocol phrases stripped before the single-token list.
const SKIP_AUDIT_PHRASE_RE =
  /\b(Colorado Mesh|Nomad Network|Ripple Networks|mesh-client|Mesh-Client|Liam's|CalTopo|LetsMesh|MeshMapper|Flood Advert|Reticulum)\b/gi;

// Tokens that are legitimately identical across languages and should not be
// treated as "untranslated" when a locale value matches English verbatim.
const SKIP_AUDIT_RE =
  /\b(TAK|Discord|Meshtastic|MeshCore|MQTT|LoRa|GPS|BLE|SNR|RSSI|dBm|Hz|MHz|kHz|bps|ACK|NAK|CSV|JSON|URL|URI|UUID|API|WiFi|USB|Bluetooth|SX126x|GPIO|Base64|base64|AES-128|AES-256|SHA-256|NTP|Hops?|MGRS|Firmware|Router|Flood|Advert|ADVERT|FLOOD|DIRECT|LOCAL|TXT_MSG|Sniffer|Repeater|Repeaters|Radio|Client|Imperial|hello)\b/gi;

/** Leaf keys that must stay English (protocol chips / wire samples) — never audit-retranslate. */
const SKIP_AUDIT_LEAF_KEYS = new Set([
  'floodAdvertButton',
  'floodAdvertSection',
  'buttonFloodAdvert',
  'sendButtonDm',
  'pinPlaceholder',
  'channelPsksPlaceholder',
  'guestPasswordPlaceholder',
  'filterChipAdvert',
  'filterChipFlood',
  'filterChipDirect',
  'filterChipLocal',
  'filterChipTxtMsg',
  'filterChipGrpTxt',
  'filterChipPath',
  'filterChipTrace',
  'filterChipAnon',
]);

/**
 * Returns true when an English value contains enough non-technical content to
 * be worth machine-translating. Values that reduce to nothing after stripping
 * placeholders and known loanwords/brands are skipped in --audit mode.
 * @param {string} enVal
 */
export function hasTranslatableContent(enVal) {
  const stripped = enVal
    .replace(/\{\{[^}]+\}\}/g, '') // remove i18next {{placeholders}}
    .replace(SKIP_AUDIT_PHRASE_RE, '')
    .replace(SKIP_AUDIT_RE, '')
    .replace(/[^a-zA-Z]/g, '')
    .trim();
  return stripped.length >= 4;
}

/**
 * Keys to machine-translate for one locale: present in English but absent locally,
 * optionally restricted to keys newly added in English vs git HEAD.
 * With auditIdentical=true, also includes keys whose locale value equals English
 * (present but never translated), skipping values that are legitimately identical
 * (pure brand names, technical loanwords, placeholder-only strings).
 *
 * @param {string[]} enKeys
 * @param {Record<string, unknown>} existingFlat
 * @param {Set<string> | null} addedEnglishKeysSet — keys in working-tree EN not in HEAD EN; null if unknown
 * @param {{ translateAllGaps: boolean; hasGitBaseline: boolean; auditIdentical?: boolean; enFlat?: Record<string, unknown> | null }} opts
 * @returns {string[]}
 */
export function filterMissingKeysToTranslate(enKeys, existingFlat, addedEnglishKeysSet, opts) {
  const { translateAllGaps, hasGitBaseline, auditIdentical = false, enFlat = null } = opts;
  return enKeys.filter((k) => {
    if (k in existingFlat) {
      const leaf = k.split('.').pop() ?? k;
      if (SKIP_AUDIT_LEAF_KEYS.has(leaf)) return false;
      return (
        auditIdentical &&
        enFlat !== null &&
        existingFlat[k] === enFlat[k] &&
        typeof enFlat[k] === 'string' &&
        hasTranslatableContent(enFlat[k])
      );
    }
    if (translateAllGaps) return true;
    if (!hasGitBaseline || addedEnglishKeysSet === null) {
      return true;
    }
    return addedEnglishKeysSet.has(k);
  });
}

const DEFAULT_TRANSLATE_DELAY_MS = 300;
const DEFAULT_LT_CONCURRENCY = 3;
const MAX_TRANSLATE_DELAY_MS = 5000;
const MAX_TRANSLATE_CONCURRENCY = 10;

/**
 * @param {string | undefined} ltUrl
 * @param {string | undefined} envDelayMs
 */
export function resolveTranslateDelayMs(ltUrl, envDelayMs) {
  if (envDelayMs !== undefined && envDelayMs !== '') {
    const parsed = Number(envDelayMs);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_TRANSLATE_DELAY_MS;
  }
  return ltUrl ? 0 : DEFAULT_TRANSLATE_DELAY_MS;
}

/**
 * @param {string | undefined} ltUrl
 * @param {string | undefined} envConcurrency
 */
export function resolveTranslateConcurrency(ltUrl, envConcurrency) {
  if (envConcurrency !== undefined && envConcurrency !== '') {
    const parsed = Number(envConcurrency);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.min(MAX_TRANSLATE_CONCURRENCY, Math.floor(parsed));
    }
  }
  return ltUrl ? DEFAULT_LT_CONCURRENCY : 1;
}

/** Increase delay after Google/MyMemory rate-limit responses (cap at MAX_TRANSLATE_DELAY_MS). */
export function nextDelayAfterRateLimit(currentDelayMs) {
  const base = Math.max(currentDelayMs, DEFAULT_TRANSLATE_DELAY_MS);
  return Math.min(MAX_TRANSLATE_DELAY_MS, base * 2);
}

/**
 * Run async jobs with bounded concurrency.
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<void>} worker
 */
export async function mapWithConcurrency(items, concurrency, worker) {
  const limit = Math.max(1, concurrency);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

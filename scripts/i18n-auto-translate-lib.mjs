/**
 * Pure helpers for i18n-auto-translate.mjs (unit-tested).
 */

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

// Tokens that are legitimately identical across languages and should not be
// treated as "untranslated" when a locale value matches English verbatim.
const SKIP_AUDIT_RE =
  /\b(TAK|Discord|Meshtastic|MeshCore|MQTT|LoRa|GPS|BLE|SNR|RSSI|dBm|Hz|MHz|kHz|bps|ACK|NAK|CSV|JSON|URL|URI|UUID|API|WiFi|USB|Bluetooth|SX126x|GPIO|Base64|base64|AES-128|AES-256|SHA-256|NTP|Hops?|Mesh-Client|MGRS|Firmware|Router)\b/gi;

/**
 * Returns true when an English value contains enough non-technical content to
 * be worth machine-translating. Values that reduce to nothing after stripping
 * placeholders and known loanwords/brands are skipped in --audit mode.
 * @param {string} enVal
 */
function hasTranslatableContent(enVal) {
  const stripped = enVal
    .replace(/\{\{[^}]+\}\}/g, '') // remove i18next {{placeholders}}
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

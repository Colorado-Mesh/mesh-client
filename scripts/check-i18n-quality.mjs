/**
 * Locale string quality rules shared by check-i18n.mjs and its tests.
 *
 * @typedef {{ locale: string, flatKey: string, val: string, enVal: string }} LocaleStringContext
 */

/** Keys under this prefix describe Meshtastic radio channels (not TV/broadcast). */
export const CHANNEL_URL_PREFIX = 'radioPanel.channelUrl.';

/** Leaf keys that must be translated (not left identical to English). */
export const MUST_TRANSLATE_LEAF_KEYS = new Set([
  'copyMeshtastic',
  'copyPublicKey',
  'generateLink',
  'copyFailed',
]);

/** appPanel filter where French "chaînes" is a known false friend. */
export const FR_MESH_CHANNEL_KEYS = new Set([
  `${CHANNEL_URL_PREFIX}addWarning`,
  `${CHANNEL_URL_PREFIX}confirmReplaceMessage`,
  `${CHANNEL_URL_PREFIX}confirmAddTitle`,
  `${CHANNEL_URL_PREFIX}confirmAddMessage`,
  'appPanel.allChannelsOption',
]);

/** CAT / Memsource placeholder tokens (e.g. __ PH0 __) that must be {{name}} instead. */
export const CAT_PH_PLACEHOLDER_RE = /__\s*PH\s*\d/i;

/** Brand / product names preserved verbatim when present in English. */
export const PROTECTED_BRANDS = ['TAK', 'Discord', 'Meshtastic', 'MeshCore', 'MQTT'];

// UTF-8 Cyrillic (etc.) misread as Latin-1 in JSON.
const MOJIBAKE_RE = /Ð[\u0080-\u00FF]{2,}|Ã[\u0080-\u00BF]{2,}|Â[\u0080-\u00BF]{2,}/;

const BROKEN_MESHTASTIC_SCHEME_RE = /meshtastic[\s\u00a0]+:\/\//i;

const MESHTASTIC_MISSPELLING_RE = /meshtastisch/i;

const MESHTASTIC_CYRILLIC_TRANSLIT_RE = /мештаст/i;

const ZH_CAT_GARBAGE_RE = /%\s*\d+.*文件夹|文件夹.*%\s*\d+/;

const FR_CHANNEL_FALSE_FRIEND_RE = /\bchaînes?\b/i;

const UNTRANSLATED_COPY_MESHTASTIC_RE = /^Copy meshtastic/i;

const UNTRANSLATED_REMOTE_ADMIN_DOCS_RE = /remote admin docs/i;

/** True if the string contains at least one cased lowercase letter (incl. Polish, etc.). */
function hasLowercaseLetter(s) {
  return [...s].some((ch) => ch === ch.toLowerCase() && ch !== ch.toUpperCase());
}

function brandOccurrenceCount(text, brand) {
  const re = new RegExp(`\\b${brand}\\b`, 'g');
  return (text.match(re) || []).length;
}

/**
 * @param {string} enVal
 * @param {string} val
 * @param {string[]} [brands]
 * @returns {string[]} Human-readable issue descriptions (empty if OK).
 */
export function protectedBrandIssues(enVal, val, brands = PROTECTED_BRANDS) {
  const issues = [];
  for (const brand of brands) {
    const enCount = brandOccurrenceCount(enVal, brand);
    if (enCount === 0) continue;
    const locCount = brandOccurrenceCount(val, brand);
    if (locCount < enCount) {
      issues.push(
        `Brand "${brand}" missing: English has ${enCount} occurrence(s), locale has ${locCount}`,
      );
    }
  }
  return issues;
}

/**
 * @param {LocaleStringContext} ctx
 * @returns {string[]} Human-readable issue descriptions (empty if OK).
 */
export function localeStringQualityIssues({ locale, flatKey, val, enVal }) {
  const issues = [];
  const leafKey = flatKey.split('.').pop() ?? flatKey;

  if (CAT_PH_PLACEHOLDER_RE.test(val)) {
    issues.push('CAT/XLIFF __ PH __ placeholder residue is not allowed');
  }

  if (MOJIBAKE_RE.test(val)) {
    issues.push('mojibake/encoding corruption detected');
  }

  if (BROKEN_MESHTASTIC_SCHEME_RE.test(val)) {
    issues.push('meshtastic:// scheme must not contain whitespace before "://"');
  }

  if (
    enVal.includes('meshtastic://') &&
    /meshtastic/i.test(val) &&
    !val.includes('meshtastic://')
  ) {
    issues.push('meshtastic:// URL scheme is broken or missing');
  }

  if (MESHTASTIC_MISSPELLING_RE.test(val)) {
    issues.push('use protocol spelling "meshtastic", not "meshtastisch"');
  }

  if (
    enVal.includes('Meshtastic') &&
    !val.includes('Meshtastic') &&
    MESHTASTIC_CYRILLIC_TRANSLIT_RE.test(val)
  ) {
    issues.push('use brand name "Meshtastic", not Cyrillic transliteration');
  }

  if (locale === 'zh' && ZH_CAT_GARBAGE_RE.test(val)) {
    issues.push('Chinese CAT/Qt placeholder garbage (e.g. "% 1 个文件夹")');
  }

  if (
    locale === 'fr' &&
    (flatKey.startsWith(CHANNEL_URL_PREFIX) || FR_MESH_CHANNEL_KEYS.has(flatKey)) &&
    FR_CHANNEL_FALSE_FRIEND_RE.test(val)
  ) {
    issues.push('French "chaîne(s)" means broadcast channel; use "canal/canaux" for mesh channels');
  }

  if (locale !== 'en' && MUST_TRANSLATE_LEAF_KEYS.has(leafKey) && val === enVal) {
    issues.push(`"${leafKey}" is still identical to English — translate the UI text`);
  }

  if (
    locale !== 'en' &&
    leafKey === 'copyMeshtastic' &&
    UNTRANSLATED_COPY_MESHTASTIC_RE.test(val)
  ) {
    issues.push('copyMeshtastic still starts with English "Copy meshtastic"');
  }

  if (
    locale !== 'en' &&
    enVal.includes('remote admin docs') &&
    UNTRANSLATED_REMOTE_ADMIN_DOCS_RE.test(val)
  ) {
    issues.push('translate "remote admin docs" — do not leave the English phrase');
  }

  if (
    locale !== 'en' &&
    leafKey === 'offline_gate' &&
    enVal.includes('Catch up') &&
    /\bCatch up\b/i.test(val)
  ) {
    issues.push('translate "Catch up" using the locale fetchStoreForwardHistory button label');
  }

  // Single Latin letter (e.g. de "B") is a bad MT truncation; short CJK labels are OK.
  if (leafKey === 'roleSecondary' && enVal.length > 5 && /^[A-Za-z]$/.test(val)) {
    issues.push('roleSecondary looks truncated');
  }

  if (
    leafKey === 'modeAdd' &&
    val.length > 4 &&
    /[A-Za-z]/.test(val) &&
    hasLowercaseLetter(enVal) &&
    !hasLowercaseLetter(val)
  ) {
    issues.push('modeAdd must not be ALL CAPS');
  }

  if (enVal.includes('{{usePreset}}') && !val.includes('{{usePreset}}')) {
    issues.push('missing {{usePreset}} interpolation from English source');
  }

  return issues;
}

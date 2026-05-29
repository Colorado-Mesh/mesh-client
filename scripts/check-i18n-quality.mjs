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
  'channelLoading',
  'channelLoadFailed',
  'retryRemoteChannels',
]);

/** appPanel filter where French "chaînes" is a known false friend. */
export const FR_MESH_CHANNEL_KEYS = new Set([
  `${CHANNEL_URL_PREFIX}addWarning`,
  `${CHANNEL_URL_PREFIX}confirmReplaceMessage`,
  `${CHANNEL_URL_PREFIX}confirmAddTitle`,
  `${CHANNEL_URL_PREFIX}confirmAddMessage`,
  'appPanel.allChannelsOption',
]);

/** MT often mis-parses "Retry loading channels" as freight/TV "loading channels". */
export const RETRY_REMOTE_CHANNELS_FORBIDDEN = {
  es: [
    {
      re: /canales de carga/i,
      hint: 'retry fetching mesh channels, not freight "loading channels"',
    },
  ],
  fr: [
    {
      re: /canaux de chargement/i,
      hint: 'use "chargement des canaux", not "canaux de chargement"',
    },
  ],
  de: [{ re: /Ladekan[äa]le/i, hint: 'use "Kanäle laden", not TV "Ladekanäle"' }],
  id: [
    {
      re: /saluran pemuatan/i,
      hint: 'use "memuat saluran", not "saluran pemuatan"',
    },
  ],
  nl: [{ re: /laadkanalen/i, hint: 'use "kanalen laden", not "laadkanalen"' }],
  ko: [{ re: /로딩\s*채널/i, hint: 'use "채널 불러오기", not English loanword "로딩 채널"' }],
};

export const RETRY_REMOTE_CHANNELS_KEY = 'radioPanel.retryRemoteChannels';

/** MeshCore Room panel — chat room servers, not hotel/bedroom/meeting rooms. */
export const ROOMS_PANEL_PREFIX = 'roomsPanel.';

/** Keys outside roomsPanel that still refer to MeshCore Room servers. */
export const MESHCORE_ROOM_UI_KEYS = new Set(['tabs.rooms', 'nodeDetailModal.openRoomButton']);

/**
 * MT often translates MeshCore Room (chat server) as hotel/bedroom/meeting room.
 * Matched by locale on roomsPanel.* and tabs.rooms.
 */
export const ROOMS_PANEL_FALSE_FRIENDS = {
  de: [{ re: /\bZimmer\b/i, hint: 'use "Raum" for MeshCore Room, not hotel "Zimmer"' }],
  fr: [{ re: /\bchambre\b/i, hint: 'use "salle" for MeshCore Room, not hotel "chambre"' }],
  es: [{ re: /\bhabitaci[oó]n\b/i, hint: 'use "sala" for MeshCore Room, not hotel "habitación"' }],
  'pt-BR': [{ re: /\bquarto\b/i, hint: 'use "sala" for MeshCore Room, not hotel "quarto"' }],
  ko: [
    {
      re: /객실|회의실/,
      hint: 'use "룸" for MeshCore Room, not hotel/meeting "객실/회의실"',
    },
  ],
  ru: [
    {
      re: /номер/i,
      hint: 'use "комната" for MeshCore Room, not hotel "номер"',
    },
    {
      re: /помещени/i,
      hint: 'use "комната" for MeshCore Room admin copy, not generic "помещение"',
    },
  ],
  id: [{ re: /\bkamar\b/i, hint: 'use "ruangan" for MeshCore Room, not hotel "kamar"' }],
  nl: [{ re: /\bgaas\b/i, hint: 'use "mesh" for the network, not fabric "gaas"' }],
  uk: [
    {
      re: /приміщен/i,
      hint: 'use "кімната" for MeshCore Room admin copy, not generic "приміщення"',
    },
  ],
  pl: [
    {
      re: /\b[Pp]omieszczen/i,
      hint: 'use "pokój" for MeshCore Room, not physical-space "pomieszczenie"',
    },
  ],
};

/** Default-password hint placeholders — must stay short literals, not MT sentences. */
export const ROOMS_PANEL_PASSWORD_PLACEHOLDER_KEYS = new Set([
  'guestPasswordPlaceholder',
  'adminPasswordPlaceholder',
]);

export const ROOMS_PANEL_PASSWORD_PLACEHOLDER_MAX_LEN = 24;

/** Four or more whitespace-separated tokens, or sentence-ending punctuation. */
export const ROOMS_PANEL_PASSWORD_PLACEHOLDER_SENTENCE_RE = /[.!?]|(?:\S+\s+){3,}\S+/;

/** roomsPanel leaf keys that must not remain identical to English. */
export const ROOMS_PANEL_MUST_TRANSLATE_LEAF_KEYS = new Set(['readOnlyBadge', 'aclLevelLabel']);

/** Leaf keys where English ends with … and locale must not use ASCII dot runs. */
export const ELLIPSIS_HYGIENE_LEAF_KEYS = new Set(['channelLoading', 'savingChannel']);

/** CAT / Memsource placeholder tokens (e.g. __ PH0 __) that must be {{name}} instead. */
export const CAT_PH_PLACEHOLDER_RE = /__\s*PH\s*\d/i;

/** CAT / XLIFF / Memsource XML tags that must never ship in JSON values. */
export const LOCALE_ARTIFACT_RES = [
  /<g\s+id=/i,
  /<\/g>/i,
  /<ph\s+id=/i,
  /<bpt\b/i,
  /<ept\b/i,
  /equiv-text=/i,
];

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

const UNTRANSLATED_READ_ONLY_BADGE_RE = /\(read only\)/i;

function isMeshcoreRoomUiKey(flatKey) {
  return flatKey.startsWith(ROOMS_PANEL_PREFIX) || MESHCORE_ROOM_UI_KEYS.has(flatKey);
}

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

  for (const re of LOCALE_ARTIFACT_RES) {
    if (re.test(val)) {
      issues.push(`CAT/XLIFF/Memsource XML residue is not allowed (matched ${re})`);
      break;
    }
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

  if (
    locale !== 'en' &&
    ELLIPSIS_HYGIENE_LEAF_KEYS.has(leafKey) &&
    enVal.endsWith('…') &&
    (/\.{4,}/.test(val) || /\.{3,}$/.test(val))
  ) {
    issues.push('use Unicode ellipsis (…) instead of ASCII dots when English uses …');
  }

  if (flatKey === RETRY_REMOTE_CHANNELS_KEY) {
    for (const { re, hint } of RETRY_REMOTE_CHANNELS_FORBIDDEN[locale] ?? []) {
      if (re.test(val)) {
        issues.push(`retryRemoteChannels false friend: ${hint}`);
      }
    }
  }

  if (locale === 'nl' && leafKey === 'channelLoadFailed' && /\bmislukte\b/i.test(val)) {
    issues.push('use past participle "mislukt" for failed-state labels, not "mislukte"');
  }

  if (isMeshcoreRoomUiKey(flatKey)) {
    for (const { re, hint } of ROOMS_PANEL_FALSE_FRIENDS[locale] ?? []) {
      if (re.test(val)) {
        issues.push(`roomsPanel false friend: ${hint}`);
      }
    }
  }

  if (
    locale !== 'en' &&
    flatKey.startsWith(ROOMS_PANEL_PREFIX) &&
    ROOMS_PANEL_MUST_TRANSLATE_LEAF_KEYS.has(leafKey) &&
    val === enVal
  ) {
    issues.push(`"${leafKey}" is still identical to English — translate the UI text`);
  }

  if (
    locale !== 'en' &&
    flatKey.startsWith(ROOMS_PANEL_PREFIX) &&
    leafKey === 'readOnlyBadge' &&
    UNTRANSLATED_READ_ONLY_BADGE_RE.test(val)
  ) {
    issues.push('translate readOnlyBadge — do not leave English "(read only)"');
  }

  if (
    flatKey.startsWith(ROOMS_PANEL_PREFIX) &&
    ROOMS_PANEL_PASSWORD_PLACEHOLDER_KEYS.has(leafKey)
  ) {
    if (val.length > ROOMS_PANEL_PASSWORD_PLACEHOLDER_MAX_LEN) {
      issues.push(
        'roomsPanel password placeholder must be a short literal default-password hint, not a long phrase',
      );
    } else if (ROOMS_PANEL_PASSWORD_PLACEHOLDER_SENTENCE_RE.test(val.trim())) {
      issues.push(
        'roomsPanel password placeholder looks like an MT sentence — use a short literal (e.g. hello, password)',
      );
    }
  }

  return issues;
}

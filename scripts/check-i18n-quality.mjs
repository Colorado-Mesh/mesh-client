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
export const MESHCORE_ROOM_UI_KEYS = new Set([
  'tabs.rooms',
  'nodeDetailModal.openRoomButton',
  'meshcoreContactSettings.typeRoomServers',
  'nodesPanel.meshcoreTypeRoom',
]);

/** modulePanel MQTT proxy toggle + error (must not use legal/delegation false friends). */
export const MQTT_PROXY_UI_KEYS = new Set([
  'modulePanel.fields.mqttProxyToClientEnabled',
  'modulePanel.errors.mqttProxyRequired',
]);

/** Auto-translate often turns "proxy to client" into power-of-attorney / legal delegation. */
export const MQTT_PROXY_LEGAL_FALSE_FRIENDS = [
  { re: /\bProkura\b/i, hint: 'use networking "Proxy … client", not legal Prokura' },
  { re: /Volmacht aan/i, hint: 'use "Proxy naar client", not legal volmacht' },
  { re: /Pełnomocnik/i, hint: 'use "Proxy do klienta", not legal pełnomocnik' },
  { re: /Müşteriye vekalet/i, hint: 'use "İstemciye proxy", not legal vekalet' },
  { re: /^Delega al cliente$/i, hint: 'use "Proxy al client", not legal delega' },
  { re: /^委托给/i, hint: 'use "代理到客户端" or "向客户端代理", not legal 委托' },
];

/** English toggle label left in localized mqttProxyRequired error text. */
export const MQTT_PROXY_EN_LABEL_RE = /Proxy to client/i;

/** MyMemory/CAT often inserts spaces inside Wi-Fi. */
export const WIFI_SPACED_RE = /Wi\s+-\s*Fi/i;

/** CJK in locales that are not Chinese, Japanese, or Korean. */
export const CJK_SCRIPT_RE = /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/;
export const CJK_LOCALES = new Set(['zh', 'ja', 'ko']);

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
export function looksLikePasswordPlaceholderSentence(text) {
  if (/[.!?]/.test(text)) return true;
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  return tokens.length >= 4;
}

/** roomsPanel leaf keys that must not remain identical to English. */
export const ROOMS_PANEL_MUST_TRANSLATE_LEAF_KEYS = new Set([
  'readOnlyBadge',
  'aclLevelLabel',
  'aclLevelAdmin',
  'postButton',
  'postCount',
  'syncInterval120',
  'syncInterval240',
  'unreadPosts',
]);

/** Hints that describe the wire default guest password (literal hello, not a greeting translation). */
export const ROOMS_PANEL_LITERAL_HELLO_KEYS = new Set(['loginHelp', 'emptyGuestLoginHint']);

/**
 * Auto-translate often replaces the MeshCore default password "hello" with a localized greeting.
 * Only checked on ROOMS_PANEL_LITERAL_HELLO_KEYS when English mentions "hello".
 */
export const ROOMS_HELLO_PASSWORD_FALSE_FRIENDS = {
  cs: [{ re: /\bahoj\b/i, hint: 'keep wire password "hello", not Czech greeting "ahoj"' }],
  de: [{ re: /\bHallo\b/i, hint: 'keep wire password "hello", not German greeting "Hallo"' }],
  es: [{ re: /\bhola\b/i, hint: 'keep wire password "hello", not Spanish greeting "hola"' }],
  fr: [{ re: /bonjour/i, hint: 'keep wire password "hello", not French greeting "bonjour"' }],
  id: [{ re: /\bhalo\b/i, hint: 'keep wire password "hello", not Indonesian greeting "halo"' }],
  it: [{ re: /\bciao\b/i, hint: 'keep wire password "hello", not Italian greeting "ciao"' }],
  'pt-BR': [{ re: /\bolá\b/i, hint: 'keep wire password "hello", not Portuguese greeting "olá"' }],
  nl: [{ re: /\bhallo\b/i, hint: 'keep wire password "hello", not Dutch greeting "hallo"' }],
  pl: [{ re: /\bwitaj\b/i, hint: 'keep wire password "hello", not Polish greeting "witaj"' }],
  ru: [{ re: /привет/i, hint: 'keep wire password "hello", not Russian greeting "привет"' }],
  tr: [{ re: /merhaba/i, hint: 'keep wire password "hello", not Turkish greeting "merhaba"' }],
  uk: [{ re: /привіт/i, hint: 'keep wire password "hello", not Ukrainian greeting "привіт"' }],
};

/** Outdated loginHelp that tells users to leave the field empty instead of Continue read-only. */
export const STALE_ROOMS_LOGIN_HELP_RES = [
  /leave (?:it )?empty/i,
  /leave blank/i,
  /leer lassen/i,
  /laissez vide/i,
  /deixe em branco/i,
  /dejar vac[ií]o/i,
  /lasciare vuoto/i,
  /ponechte pr[aá]zdn[eé]/i,
  /pozostaw puste/i,
  /biarkan kosong/i,
  /boş bırak/i,
  /留空/,
  /空白のまま/,
  /비워\s*둡/,
  /залиште порожнім/i,
  /оставьте пустым/i,
];

/** Polish MT often uses "Nowość" (novelty) instead of "new" for unread counts. */
export const PL_UNREAD_NOWOSC_RE = /Nowość/i;

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

const BRAND_WORD_RES = new Map([
  ['TAK', /\bTAK\b/g],
  ['Discord', /\bDiscord\b/g],
  ['Meshtastic', /\bMeshtastic\b/g],
  ['MeshCore', /\bMeshCore\b/g],
  ['MQTT', /\bMQTT\b/g],
]);

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

function isMqttProxyUiKey(flatKey) {
  return MQTT_PROXY_UI_KEYS.has(flatKey);
}

/** Dutch MT often translates English "mesh" as fabric "gaas". */
function nlMeshGaasIssue(enVal, val) {
  if (!/\bmesh\b/i.test(enVal) || !/\bgaas\b/i.test(val)) return null;
  return 'use "mesh" for the network, not fabric "gaas"';
}

/** True if the string contains at least one cased lowercase letter (incl. Polish, etc.). */
function hasLowercaseLetter(s) {
  return [...s].some((ch) => ch === ch.toLowerCase() && ch !== ch.toUpperCase());
}

function brandOccurrenceCount(text, brand) {
  const re = BRAND_WORD_RES.get(brand);
  if (!re) return 0;
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

  if (locale === 'ja' && flatKey === 'nodesPanel.meshcoreTypeRoom' && /部屋/.test(val)) {
    issues.push('roomsPanel false friend: use "ルーム" for MeshCore Room type, not hotel 部屋');
  }

  if (locale === 'nl' && isMeshcoreRoomUiKey(flatKey) && /\b[Kk]amer\b/.test(val)) {
    issues.push('roomsPanel false friend: use "ruimte" for MeshCore Room, not hotel "kamer"');
  }

  if (locale === 'nl') {
    const gaasIssue = nlMeshGaasIssue(enVal, val);
    if (gaasIssue) issues.push(gaasIssue);
  }

  if (isMqttProxyUiKey(flatKey)) {
    for (const { re, hint } of MQTT_PROXY_LEGAL_FALSE_FRIENDS) {
      if (re.test(val)) {
        issues.push(`mqttProxy false friend: ${hint}`);
      }
    }
    if (
      flatKey === 'modulePanel.errors.mqttProxyRequired' &&
      locale !== 'en' &&
      MQTT_PROXY_EN_LABEL_RE.test(val)
    ) {
      issues.push(
        'mqttProxyRequired still quotes English "Proxy to client" — use the locale mqttProxyToClientEnabled label',
      );
    }
  }

  if (enVal.includes('Wi-Fi') && WIFI_SPACED_RE.test(val)) {
    issues.push('use "Wi-Fi" without spaces around the hyphen (not "Wi - Fi")');
  }

  if (!CJK_LOCALES.has(locale) && CJK_SCRIPT_RE.test(val) && !CJK_SCRIPT_RE.test(enVal)) {
    issues.push('wrong-script contamination (CJK characters in a non-CJK locale)');
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
    locale !== 'en' &&
    flatKey === `${ROOMS_PANEL_PREFIX}loginHelp` &&
    enVal.includes('Continue read-only')
  ) {
    for (const re of STALE_ROOMS_LOGIN_HELP_RES) {
      if (re.test(val)) {
        issues.push(
          'loginHelp still tells users to leave the field empty — mention Continue read-only and Login sending "hello"',
        );
        break;
      }
    }
  }

  if (
    locale !== 'en' &&
    flatKey === `${ROOMS_PANEL_PREFIX}emptyGuestLoginHint` &&
    /Continue read-only/i.test(val)
  ) {
    issues.push(
      'emptyGuestLoginHint still quotes English "Continue read-only" — use the locale continueReadOnly button label',
    );
  }

  if (
    locale !== 'en' &&
    flatKey.startsWith(ROOMS_PANEL_PREFIX) &&
    ROOMS_PANEL_LITERAL_HELLO_KEYS.has(leafKey) &&
    enVal.includes('"hello"')
  ) {
    if (!/hello/i.test(val)) {
      issues.push('MeshCore default guest password must stay literal "hello" in this hint');
    }
    for (const { re, hint } of ROOMS_HELLO_PASSWORD_FALSE_FRIENDS[locale] ?? []) {
      if (re.test(val)) {
        issues.push(`roomsPanel hello password: ${hint}`);
      }
    }
  }

  if (
    locale === 'pl' &&
    flatKey === `${ROOMS_PANEL_PREFIX}unreadPosts` &&
    PL_UNREAD_NOWOSC_RE.test(val)
  ) {
    issues.push('unreadPosts uses "Nowość" (novelty) — use "nowe" or "nowych" for unread count');
  }

  if (
    flatKey.startsWith(ROOMS_PANEL_PREFIX) &&
    ROOMS_PANEL_PASSWORD_PLACEHOLDER_KEYS.has(leafKey)
  ) {
    if (val.length > ROOMS_PANEL_PASSWORD_PLACEHOLDER_MAX_LEN) {
      issues.push(
        'roomsPanel password placeholder must be a short literal default-password hint, not a long phrase',
      );
    } else if (looksLikePasswordPlaceholderSentence(val.trim())) {
      issues.push(
        'roomsPanel password placeholder looks like an MT sentence — use a short literal (e.g. hello, password)',
      );
    }
  }

  return issues;
}

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
  de: [{ re: /\bZimmer/i, hint: 'use "Raum" for MeshCore Room, not hotel "Zimmer"' }],
  fr: [{ re: /\bchambre/i, hint: 'use "salle" for MeshCore Room, not hotel "chambre"' }],
  es: [{ re: /\bhabitaci[oó]n/i, hint: 'use "sala" for MeshCore Room, not hotel "habitación"' }],
  'pt-BR': [{ re: /\bquarto/i, hint: 'use "sala" for MeshCore Room, not hotel "quarto"' }],
  ko: [
    {
      re: /객실|회의실/,
      hint: 'use "룸" for MeshCore Room, not hotel/meeting "객실/회의실"',
    },
  ],
  it: [{ re: /\b[Cc]amera/i, hint: 'use "sala" for MeshCore Room, not hotel bedroom "camera"' }],
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
  id: [{ re: /\bkamar/i, hint: 'use "ruangan" for MeshCore Room, not hotel "kamar"' }],
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
export const ROOMS_PANEL_LITERAL_HELLO_KEYS = new Set([
  'loginHelp',
  'emptyGuestLoginHint',
  'loginAllSavedTooltip',
]);

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

/** chatPanel.composeLimit.approaching is a numeric ratio; identical "{{count}} / {{limit}}" is OK. */
export const COMPOSE_LIMIT_NUMERIC_LEAF_KEYS = new Set(['approaching']);

export const CHAT_PANEL_MUST_TRANSLATE_LEAF_KEYS = new Set([
  'replyRequiresPacketId',
  'queueButton',
]);

/** roomsPanel members / leave UX from recent MeshCore Rooms work. */
export const ROOMS_MEMBERS_MUST_TRANSLATE_LEAF_KEYS = new Set([
  'membersHeading',
  'membersRecognizedHeading',
  'membersRecognizedEmpty',
  'membersAclFetchFailed',
  'upgradeAccess',
  'leavingRoom',
  'closeManage',
]);

/**
 * English "Recognized posters" means users who posted, not wall posters / beneficiaries.
 * Checked on membersRecognizedHeading and membersRecognizedEmpty.
 */
export const RECOGNIZED_POSTER_PHYSICAL_RES = [
  /plak[aá]t/i,
  /\bPlakat/i,
  /\baffiches?\b/i,
  /\bcartel(es)?\b/i,
  /\bcartaz(es)?\b/i,
  /\bmanifesti\b/i,
  /плакат/i,
  /海报/,
  /ポスター/,
  /포스터/,
  /Bénéficiare/i,
  /Cartazes reconhecidos/i,
  /carteles reconocidos/i,
];

/** Obvious garbage for roomsPanel.membersHeading. */
export const MEMBERS_HEADING_GARBAGE_RES = [
  /^zdarma$/i,
  /de la AEC/i,
  /^office$/i,
  /^Soci$/i,
  /^pergi$/i,
  /^йде$/i,
  /^メンバ$/,
  /^Latende$/i,
  /^Partida$/i,
  /^出庫$/,
];

const REPLY_REQUIRES_EN_LEADING_RE = /^Reply\s+(requires|richiede)\b/i;

const REPLY_REQUIRES_EN_PHRASE_RES = [/\bsend ack\b/i, /\brefresh chat\b/i, /\bRF packet id\b/i];

/** MT turns "remote" into TV remote control on membersAclEmpty. */
const REMOTE_TV_FALSE_FRIEND_RES = [
  /télécommande/i,
  /Пульт дистанційного керування/i,
  /пульт дистанционного управления/i,
];

const UPGRADE_ACCESS_FALSE_FRIENDS = [
  { re: /vers Access/i, hint: 'use access-upgrade wording, not "vers Access"' },
  { re: /升级到访问/, hint: 'use "提升访问权限", not "upgrade to visit"' },
];

const ACL_LISTING_AD_FALSE_FRIEND_RES = [/ACL-advertentie/i, /Iklan ACL/i];

/** Leaf keys where English ends with … and locale must not use ASCII dot runs. */
export const ELLIPSIS_HYGIENE_LEAF_KEYS = new Set(['channelLoading', 'savingChannel']);

/** CAT / Memsource placeholder tokens (e.g. __ PH0 __) that must be {{name}} instead. */
export const CAT_PH_PLACEHOLDER_RE = /__\s*PH\s*\d/i;

/** i18next interpolation names in appearance order (for duplicate names, set dedupes). */
export function placeholderNameSet(s) {
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  const out = new Set();
  let m;
  while ((m = re.exec(s))) {
    out.add(m[1]);
  }
  return out;
}

function setsEqualStrings(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
}

/**
 * @param {string} enVal
 * @param {string} val
 * @returns {string[]} Issues when locale {{name}} sets differ from English.
 */
export function interpolationPlaceholderIssues(enVal, val) {
  const enPh = placeholderNameSet(enVal);
  const locPh = placeholderNameSet(val);
  if (setsEqualStrings(enPh, locPh)) return [];
  const enList = [...enPh].sort().join(', ') || '(none)';
  const locList = [...locPh].sort().join(', ') || '(none)';
  return [`i18next placeholder names must match English (EN: {${enList}}, locale: {${locList}})`];
}

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

  if (locale === 'nl' && isMeshcoreRoomUiKey(flatKey) && /\b[Kk]amer/i.test(val)) {
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
    locale !== 'en' &&
    flatKey.startsWith('chatPanel.composeLimit.') &&
    !COMPOSE_LIMIT_NUMERIC_LEAF_KEYS.has(leafKey) &&
    val === enVal
  ) {
    issues.push(`"${leafKey}" is still identical to English — translate the UI text`);
  }

  if (
    locale !== 'en' &&
    flatKey.startsWith('chatPanel.') &&
    CHAT_PANEL_MUST_TRANSLATE_LEAF_KEYS.has(leafKey) &&
    val === enVal
  ) {
    issues.push(`"${leafKey}" is still identical to English — translate the UI text`);
  }

  if (locale !== 'en' && flatKey === 'chatPanel.replyRequiresPacketId') {
    if (REPLY_REQUIRES_EN_LEADING_RE.test(val)) {
      issues.push('replyRequiresPacketId still starts with English "Reply requires/richiede"');
    }
    for (const re of REPLY_REQUIRES_EN_PHRASE_RES) {
      if (re.test(val)) {
        issues.push(
          'replyRequiresPacketId still has English "send ack", "refresh chat", or "RF packet id" — translate',
        );
        break;
      }
    }
  }

  if (
    locale !== 'en' &&
    flatKey.startsWith(ROOMS_PANEL_PREFIX) &&
    ROOMS_MEMBERS_MUST_TRANSLATE_LEAF_KEYS.has(leafKey) &&
    val === enVal
  ) {
    issues.push(`"${leafKey}" is still identical to English — translate the UI text`);
  }

  if (flatKey === `${ROOMS_PANEL_PREFIX}membersHeading`) {
    for (const re of MEMBERS_HEADING_GARBAGE_RES) {
      if (re.test(val)) {
        issues.push('membersHeading looks like auto-translate garbage — use "Members" equivalent');
        break;
      }
    }
  }

  if (
    (flatKey === `${ROOMS_PANEL_PREFIX}membersRecognizedHeading` ||
      flatKey === `${ROOMS_PANEL_PREFIX}membersRecognizedEmpty`) &&
    enVal.includes('poster')
  ) {
    for (const re of RECOGNIZED_POSTER_PHYSICAL_RES) {
      if (re.test(val)) {
        issues.push(
          'membersRecognized* uses wall-poster wording — English means users who posted in the room',
        );
        break;
      }
    }
  }

  if (
    locale !== 'en' &&
    flatKey === `${ROOMS_PANEL_PREFIX}membersAclFetchFailed` &&
    enVal.includes('ACL') &&
    !/ACL/i.test(val)
  ) {
    issues.push(
      'membersAclFetchFailed must mention ACL — do not truncate to generic "could not fetch"',
    );
  }

  if (flatKey === `${ROOMS_PANEL_PREFIX}membersAclEmpty` && enVal.includes('Remote')) {
    for (const re of REMOTE_TV_FALSE_FRIEND_RES) {
      if (re.test(val)) {
        issues.push(
          'membersAclEmpty uses TV-remote false friend — use remote/distant wording for `get acl`',
        );
        break;
      }
    }
  }

  if (flatKey === `${ROOMS_PANEL_PREFIX}membersAclRemoteHint`) {
    for (const re of ACL_LISTING_AD_FALSE_FRIEND_RES) {
      if (re.test(val)) {
        issues.push(
          'membersAclRemoteHint confuses ACL listing with advertising (advertentie/iklan)',
        );
        break;
      }
    }
  }

  if (flatKey === `${ROOMS_PANEL_PREFIX}upgradeAccess`) {
    for (const { re, hint } of UPGRADE_ACCESS_FALSE_FRIENDS) {
      if (re.test(val)) {
        issues.push(`upgradeAccess: ${hint}`);
      }
    }
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

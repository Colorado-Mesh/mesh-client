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
  ja: [{ re: /部屋/, hint: 'use "ルーム" for MeshCore Room, not hotel 部屋' }],
};

/** Leaf keys from flood-advert / zero-hop UI where MT must not use commercial "ad" wording. */
export const MESH_ADVERT_COMMERCIAL_CHECK_LEAF_KEYS = new Set([
  'floodAdvertTypeLabel',
  'floodAdvertTypeFlood',
  'floodAdvertTypeZeroHop',
  'zeroHopAdvertButton',
  'zeroHopAdvertSent',
]);

export function isMeshAdvertCommercialCheckKey(flatKey) {
  const leaf = flatKey.split('.').pop() ?? flatKey;
  return MESH_ADVERT_COMMERCIAL_CHECK_LEAF_KEYS.has(leaf);
}

/**
 * Auto-translate often turns mesh "advert" into commercial advertising by locale.
 * Checked on MESH_ADVERT_COMMERCIAL_CHECK_LEAF_KEYS and (nl only) any isMeshAdvertUiKey().
 */
export const MESH_ADVERT_COMMERCIAL_FALSE_FRIENDS = {
  nl: [
    {
      re: /advertentie/i,
      hint: 'use "advert" or "flood-advert", not commercial "advertentie"',
    },
  ],
  de: [
    {
      re: /\b(Werbung|Anzeigen)\b/i,
      hint: 'use "Advert" mesh protocol term, not commercial Werbung/Anzeigen',
    },
  ],
  fr: [
    {
      re: /\b[Pp]ublicité\b/i,
      hint: 'use "advert", not commercial "publicité"',
    },
  ],
  ru: [
    {
      re: /\bРеклам/i,
      hint: 'use "advert", not commercial "реклама"',
    },
  ],
  uk: [
    {
      re: /\bРеклам/i,
      hint: 'use "advert", not commercial "реклама"',
    },
  ],
  tr: [
    {
      re: /\b[Rr]eklam\b/i,
      hint: 'use "advert", not commercial "reklam"',
    },
  ],
  id: [
    {
      re: /\b[Ii]klan\b/i,
      hint: 'use "advert", not commercial "iklan"',
    },
  ],
  cs: [
    {
      re: /\b[Rr]eklam/i,
      hint: 'use "advert", not commercial "reklama"',
    },
  ],
  pl: [
    {
      re: /\b[Rr]eklam/i,
      hint: 'use "advert" or "ogłoszenie", not commercial "reklama"',
    },
  ],
  ko: [
    {
      re: /광고/,
      hint: 'use "advert" protocol term, not commercial 광고',
    },
  ],
  ja: [
    {
      re: /広告/,
      hint: 'use "advert" protocol term, not commercial 広告',
    },
  ],
  zh: [
    {
      re: /广告/,
      hint: 'use "advert" or 通告, not commercial 广告',
    },
  ],
};

/** Raw packet log panel — route/transport labels and protocol enum copy. */
export const RAW_PACKET_LOG_PREFIX = 'rawPacketLog.';

export const RAW_PACKET_LOG_PROTOCOL_KEYS = new Set([
  'transportLegendHint',
  'transportCodesAbsent',
  'transportCodesAbsentTooltip',
]);

export const RAW_PACKET_LOG_SHORT_LABEL_KEYS = new Set([
  'routeLabel',
  'payloadLabel',
  'transportHeading',
]);

/** MyMemory/CAT padding with dot runs in short UI labels. */
export const CAT_DOT_PADDING_RE = /\.{4,}/;

/** Protocol enum names that must stay verbatim when English includes them. */
export const MESHCORE_ROUTE_PROTOCOL_TOKENS = [
  'TRANSPORT_FLOOD',
  'TRANSPORT_DIRECT',
  'FLOOD',
  'DIRECT',
];

/**
 * @param {string} flatKey
 * @param {string} enVal
 * @param {string} val
 * @returns {string[]}
 */
export function meshcoreProtocolTokenIssues(flatKey, enVal, val) {
  if (!flatKey.startsWith(RAW_PACKET_LOG_PREFIX)) return [];
  const leafKey = flatKey.split('.').pop() ?? flatKey;
  if (!RAW_PACKET_LOG_PROTOCOL_KEYS.has(leafKey)) return [];
  const issues = [];
  for (const tok of MESHCORE_ROUTE_PROTOCOL_TOKENS) {
    if (enVal.includes(tok) && !val.includes(tok)) {
      issues.push(`preserve protocol token "${tok}" from English in rawPacketLog copy`);
    }
  }
  return issues;
}

/** App → Appearance reduce-motion accessibility copy (added with lucide icon motion). */
export const REDUCE_MOTION_KEY = 'appPanel.reduceMotion';
export const REDUCE_MOTION_DESC_KEY = 'appPanel.reduceMotionDesc';

/** Toast hint for large MeshCore map contact sets (App tab → Appearance section). */
export const MESHCORE_DISTANCE_FILTER_HINT_KEY = 'toasts.meshcoreDistanceFilterHint';

/** appPanel import guard when backup schema exceeds build version. */
export const IMPORT_SCHEMA_TOO_NEW_KEY = 'appPanel.importSchemaTooNew';

/** App Panel debug snapshot copy (support reports). */
export const APP_PANEL_DEBUG_SNAPSHOT_LEAF_KEYS = new Set([
  'copyDebugSnapshot',
  'copyDebugSnapshotButton',
  'debugSnapshotCopied',
  'debugSnapshotFailed',
]);

export const DEBUG_SNAPSHOT_COPIED_KEY = 'appPanel.debugSnapshotCopied';

/** MT parses "Debug snapshot copied" as imperative "Debug [the] snapshot". */
export const DEBUG_SNAPSHOT_COPIED_FALSE_FRIENDS = {
  fr: [
    {
      re: /^D[ée]boguer\b/i,
      hint: 'debugSnapshotCopied must be "Instantané de débogage copié…", not imperative "Déboguer"',
    },
  ],
  'pt-BR': [
    {
      re: /^Depurar\b/i,
      hint: 'debugSnapshotCopied must be "Instantâneo de depuração copiado…", not imperative "Depurar"',
    },
  ],
  ko: [
    {
      re: /^클립보드에 복사된\s+스냅샷\s+디버그$/,
      hint: 'debugSnapshotCopied word order should be "디버그 스냅샷이 클립보드에 복사되었습니다"',
    },
  ],
};

/** English "snapshot" loanword in locales that should fully translate debug snapshot UI. */
export const DEBUG_SNAPSHOT_MIXED_EN_SNAPSHOT_RES = {
  nl: [
    {
      re: /\bfoutopsporing\s+snapshot\b/i,
      hint: 'use consistent "Debug-snapshot", not mixed EN "snapshot"',
    },
  ],
  fr: [
    {
      re: /\bsnapshot\b/i,
      hint: 'translate "snapshot" as "instantané", not English "snapshot"',
    },
  ],
};

/** German debugSnapshotFailed must match Debug-Snapshot term used elsewhere. */
export const DE_DEBUG_SNAPSHOT_FAILED_WRONG_TERM_RE = /Fehlerbehebungs/i;

/** MyMemory often inserts spaces in the Mesh-Client product name. */
export const MESH_CLIENT_SPACED_RE = /Mesh\s+-\s+Client/;

/** Lowercase mesh-client product name with CAT spaces around the hyphen. */
export const MESH_CLIENT_LOWERCASE_SPACED_RE = /mesh\s+-\s+client/i;

/** App → MeshCore Open wire (experimental) toggle copy. */
export const MESHCORE_OPEN_WIRE_APP_LEAF_KEYS = new Set([
  'meshcoreOpenWireExperimentalTitle',
  'meshcoreOpenWireCompatLabel',
  'meshcoreOpenWireCompatHint',
]);

/** Chat composer Giphy / MeshCore Open g: wire copy. */
export const MESHCORE_GIF_WIRE_CHAT_LEAF_KEYS = new Set([
  'meshcoreGifButton',
  'meshcoreGifButtonHint',
  'meshcoreGifTitle',
  'meshcoreGifHint',
  'meshcoreGifPlaceholder',
  'meshcoreGifSend',
  'meshcoreGifInvalid',
]);

/** MeshCore mesh reaction picker (added with Open wire / tapback work). */
export const MESHCORE_REACTION_UI_LEAF_KEYS = new Set([
  'meshcoreReactionPickerLabel',
  'meshcoreReactionEmojiOption',
  'meshcoreReactionNotInteroperable',
]);

/** connectionBanner USB serial reselect CTA (added with zombie-port recovery). */
export const CONNECTION_BANNER_SERIAL_RESELECT_ACTION_KEY = 'connectionBanner.serialReselectAction';

/** MT often copies COM-port picker ellipsis into the reselect action label. */
export const SERIAL_RESELECT_ACTION_FALSE_FRIEND_RES = [
  { re: /COM…/, hint: 'serialReselectAction must not include COM… placeholder text' },
  {
    re: /\bporto\s+serie\b/i,
    hint: 'serialReselectAction use Spanish "puerto serie", not Portuguese "porto"',
  },
];

/** MT mistranslates "bare GIF id" as naked/empty instead of without g: prefix. */
export const MESHCORE_GIF_HINT_BARE_FALSE_FRIEND_RES = [
  { re: /\bholého\b/i, hint: 'bare GIF id means without g: prefix, not Czech "holý/naked"' },
  { re: /\bkosong\b/i, hint: 'bare GIF id means without prefix, not Indonesian "empty/kosong"' },
];

/** MT inserts spaces inside Ukrainian apostrophe words (з 'єднання, пам 'ять). */
export const UK_BROKEN_APOSTROPHE_RE =
  /[\s(][а-яіїєґА-ЯІЇЄҐ]+\s+'|[а-яіїєґА-ЯІЇЄҐ]\s+'|[а-яіїєґА-ЯІЇЄҐ]'\s+[а-яіїєґ]/;

/** MT confuses "React with" and "Contact" on meshcoreReactionEmojiOption. */
export const MESHCORE_REACTION_EMOJI_OPTION_FALSE_FRIENDS = {
  uk: [
    {
      re: /Зв\s*'?яжіться/i,
      hint: 'meshcoreReactionEmojiOption must be "Реагуйте з {{emoji}}", not contact "Зв\'яжіться"',
    },
  ],
  nl: [
    {
      re: /\bmaasreactie\b/i,
      hint: 'use "mesh-reactie", not fabric "maasreactie"',
    },
  ],
};

/** roomsPanel sidebar collapse/expand controls (MeshCore Room servers). */
export const ROOMS_LIST_COLLAPSE_LEAF_KEYS = new Set(['collapseRoomList', 'expandRoomList']);

/** MT leaves English "Open-aware" in meshcoreOpenWireCompatHint. */
export const OPEN_AWARE_ENGLISH_RE = /\bOpen\s*-?\s*aware\b/i;

/** MT mistranslates mesh "companion wire format" as physical cable/wiring. */
export const COMPANION_WIRE_PHYSICAL_FALSE_FRIEND_RES = [
  { re: /metaaldraad/i, hint: 'use companion wire protocol format, not metal "metaaldraad"' },
  {
    re: /Begleitdraht/i,
    hint: 'use "Companion-Wire-Format", not physical cable "Begleitdraht"',
  },
  {
    re: /Przerwa w przewodzie/i,
    hint: 'title is MeshCore Open wire format, not a break/pause in a cable',
  },
  { re: /przewód towarzyszą/i, hint: 'use companion wire format, not "przewód towarzyszący"' },
  { re: /cavo associato/i, hint: 'use companion wire format, not "cavo associato"' },
  { re: /cable complementario/i, hint: 'use companion wire format, not "cable complementario"' },
  { re: /fio complementar/i, hint: 'use companion wire format, not "fio complementar"' },
  { re: /doprovodného drátu/i, hint: 'use companion wire format, not "doprovodný drát"' },
  { re: /kawat pendamping/i, hint: 'use companion wire format, not "kawat pendamping"' },
  { re: /tamamlayıcı kablo/i, hint: 'use companion wire format, not "tamamlayıcı kablo"' },
  { re: /сопутствующего провода/i, hint: 'use companion wire format, not "сопутствующий провод"' },
  { re: /супутнього дроту/i, hint: 'use companion wire format, not "супутній дріт"' },
  { re: /配套电线/, hint: 'use companion wire format, not electrical "配套电线"' },
];

/** MT confuses keyed text replies with encryption/typing/encoding. */
export const KEYED_REPLY_FALSE_FRIENDS = {
  de: [
    {
      re: /verschlüsselte/i,
      hint: 'use "mit Schlüssel" for keyed replies, not encrypted "verschlüsselte"',
    },
  ],
  it: [
    {
      re: /\bdigitate\b/i,
      hint: 'use "con chiave" for keyed replies, not typed "digitate"',
    },
  ],
  nl: [
    {
      re: /gecodeerde/i,
      hint: 'use "met sleutel" for keyed replies, not encoded "gecodeerde"',
    },
  ],
};

/**
 * @param {string} enVal
 * @param {string} val
 * @returns {string[]}
 */
export function meshcoreOpenWireProtocolTokenIssues(enVal, val) {
  const issues = [];
  if (enVal.includes('@[Name#key]')) {
    if (!val.includes('@[Name#key]')) {
      if (/@[\s\u00a0]+\[|@\[\s|Name\s+#|#\s+key/i.test(val)) {
        issues.push('preserve wire token "@[Name#key]" without spaces inside brackets');
      } else {
        issues.push('preserve wire token "@[Name#key]" from English');
      }
    }
  }
  if (enVal.includes('g:ID') && !val.includes('g:ID') && /g:\s+ID/i.test(val)) {
    issues.push('preserve wire token "g:ID" without space after colon');
  }
  if (enVal.includes('r:') && /r\s+:/.test(val)) {
    issues.push('preserve wire prefix "r:" without space before colon');
  }
  if (enVal.includes('g:') && /g\s+:/.test(val)) {
    issues.push('preserve wire prefix "g:" without space before colon');
  }
  return issues;
}

export function isMeshcoreOpenWireUiLeafKey(leafKey) {
  return (
    MESHCORE_OPEN_WIRE_APP_LEAF_KEYS.has(leafKey) || MESHCORE_GIF_WIRE_CHAT_LEAF_KEYS.has(leafKey)
  );
}

/** English UI nav left in auto-translated meshcoreDistanceFilterHint. */
export const UNTRANSLATED_APP_APPEARANCE_NAV_RE = /App\s*→\s*Appearance/i;

/** MT drops the App tab name before → appearanceSection. */
export const ORPHAN_UI_ARROW_NAV_RE = /\b(?:in|ve|na|w|vo)\s+→/i;

/**
 * MT often mistranslates UI "loading spinner" as textile/industrial equipment.
 * Checked only on appPanel.reduceMotionDesc where English mentions "Loading spinners".
 */
export const REDUCE_MOTION_LOADING_SPINNER_FALSE_FRIENDS = {
  es: [
    {
      re: /girador(es)?\s+de\s+carga/i,
      hint: 'use "indicadores de carga" or "spinners de carga", not textile "girador de carga"',
    },
  ],
  'pt-BR': [
    {
      re: /girador(es)?\s+de\s+carga/i,
      hint: 'use "spinners de carregamento", not textile "girador de carga"',
    },
  ],
  pl: [
    {
      re: /tarcz\s+obrotow/i,
      hint: 'use "wskaźniki ładowania", not rotating-disk "tarcze obrotowe"',
    },
  ],
  ru: [
    {
      re: /вращател/i,
      hint: 'use "индикаторы загрузки", not mechanical "вращатели"',
    },
  ],
  tr: [
    {
      re: /iplikçi/i,
      hint: 'use "yükleme göstergesi", not textile "iplikçi"',
    },
  ],
  id: [
    {
      re: /\bpemintal\b/i,
      hint: 'use "spinner pemuatan", not textile "pemintal"',
    },
  ],
  zh: [
    {
      re: /旋转器/,
      hint: 'use "加载指示器" or "加载动画", not mechanical "旋转器"',
    },
  ],
};

/** MT sometimes translates "still animate" as "still active/alive". */
export const REDUCE_MOTION_STILL_ANIMATE_FALSE_FRIENDS = {
  nl: [
    {
      re: /blijft\s+actief/i,
      hint: 'use "blijven geanimeerd", not "blijft actief" (still active)',
    },
  ],
  it: [
    {
      re: /ancora\s+attiv/i,
      hint: 'use "restano animati", not "ancora attivi" (still active)',
    },
  ],
  id: [
    {
      re: /masih\s+bernyawa/i,
      hint: 'use "tetap animasi", not "masih bernyawa" (still alive)',
    },
  ],
};

/** Keys or English copy that refer to MeshCore/Meshtastic adverts (not TV/commercial ads). */
export function isMeshAdvertUiKey(flatKey, enVal) {
  return (
    /advert|floodAdvert/i.test(flatKey) ||
    /\bflood advert\b/i.test(enVal) ||
    /\badvert\b/i.test(enVal)
  );
}

/** German MT confuses Meshtastic device roles with unrelated business/woodworking terms. */
export const DE_DEVICE_ROLE_FALSE_FRIENDS = [
  {
    re: /\bOberfräse\b/,
    hint: '"Oberfräse" is woodworking equipment — use "Router" for the device role',
  },
  {
    re: /\bAuftraggeber\b/,
    hint: '"Auftraggeber" means contractor/principal — use "Client" for the device role',
  },
  {
    re: /\bKundenstamm\b/,
    hint: '"Kundenstamm" means customer base — use "Client-Basis" for Client Base role',
  },
];

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
 * Returns opaque issue codes; human-readable log copy lives in check-i18n.mjs (CodeQL).
 */
export const ROOMS_HELLO_PASSWORD_FALSE_FRIEND_RES = {
  cs: [/\bahoj\b/i],
  de: [/\bHallo\b/i],
  es: [/\bhola\b/i],
  fr: [/bonjour/i],
  id: [/\bhalo\b/i],
  it: [/\bciao\b/i],
  'pt-BR': [/\bolá\b/i],
  nl: [/\bhallo\b/i],
  pl: [/\bwitaj\b/i],
  ru: [/привет/i],
  tr: [/merhaba/i],
  uk: [/привіт/i],
};

/** Opaque locale-quality codes for MeshCore wire-password hint checks. */
export const LOCALE_QUALITY_ROOMS_HELLO_MISSING_LITERAL = 'rooms-hello-missing-literal';

export function roomsHelloFalseFriendIssueCode(locale) {
  return `rooms-hello-false-friend:${locale}`;
}

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
  'outboxStatusQueued',
  'outboxStatusSending',
  'outboxStatusBlocked',
  'outboxStatusFailed',
  'retryOutboxMessage',
  'retryOutbox',
  'cancelOutboxMessage',
  'dayToday',
  'dayYesterday',
  'newMessagesDivider',
  'emptyNoSearchMatches',
  'emptyNoDmMessages',
  'emptyNoMessagesYet',
  'emptyConnectFirst',
]);

/** chatPanel outbox / date divider keys checked for known auto-translate false friends. */
export const CHAT_PANEL_OUTBOX_UI_LEAF_KEYS = new Set([
  'outboxStatusQueued',
  'outboxStatusSending',
  'outboxStatusBlocked',
  'outboxStatusFailed',
  'retryOutbox',
  'cancelOutboxMessage',
  'dayToday',
  'dayYesterday',
  'newMessagesDivider',
]);

/**
 * MyMemory often mistranslates chat outbox status and chat date dividers.
 * Matched on chatPanel.* keys listed in CHAT_PANEL_OUTBOX_UI_LEAF_KEYS.
 */
export const CHAT_PANEL_OUTBOX_UI_FALSE_FRIENDS = {
  de: [
    {
      re: /^Nicht bestanden$/i,
      hint: 'outboxStatusFailed use "Fehlgeschlagen", not exam "Nicht bestanden"',
    },
  ],
  es: [{ re: /En la actualidad/i, hint: 'dayToday must be "Hoy", not "En la actualidad"' }],
  fr: [
    { re: /Aujourdh.?ui/i, hint: 'dayToday must be "Aujourd\'hui"' },
    { re: /^Nouveau message$/i, hint: 'newMessagesDivider must be plural "Nouveaux messages"' },
  ],
  id: [
    { re: /Diantrekan/i, hint: 'outboxStatusQueued use "Dalam antrean", not invalid "Diantrekan"' },
  ],
  it: [
    { re: /^Bloccati$/i, hint: 'outboxStatusBlocked must be singular "Bloccato"' },
    {
      re: /Messaggio di annullamento posta/i,
      hint: 'cancelOutboxMessage must be imperative "Annulla messaggio in uscita"',
    },
  ],
  ja: [
    {
      re: /送信中・+/i,
      hint: 'outboxStatusSending use Unicode ellipsis "送信中…", not middle dots ・',
    },
  ],
  pl: [{ re: /^Yesterday$/i, hint: 'dayYesterday must be "Wczoraj", not English' }],
  ru: [
    { re: /Новые письма/i, hint: 'newMessagesDivider must use "сообщения", not email "письма"' },
    {
      re: /^За (сегодня|вчера)$/i,
      hint: 'dayToday/dayYesterday should be "Сегодня"/"Вчера", not "За …"',
    },
    { re: /^отправка/, hint: 'outboxStatusSending should be capitalized "Отправка…"' },
  ],
  tr: [
    { re: /Sırada\s+Sırada/i, hint: 'outboxStatusQueued duplicated "Sırada"' },
    { re: /^Bugun$/i, hint: 'dayToday must be "Bugün"' },
  ],
  uk: [
    { re: /^Заклад,/i, hint: 'outboxStatusSending must be "Надсилання…", not bookmark "Заклад"' },
    { re: /^нове повідомлення$/i, hint: 'newMessagesDivider must be plural "Нові повідомлення"' },
  ],
  zh: [
    { re: /^封锁$/, hint: 'outboxStatusBlocked use "已阻止", not geopolitical "封锁"' },
    { re: /支持失败/, hint: 'outboxStatusFailed must be "失败", not "支持失败"' },
    { re: /再次挑战/, hint: 'retryOutbox must be "重试", not "再次挑战"' },
  ],
};

/** MeshCore Rooms saved-password sidebar (recent work). */
export const ROOMS_SAVED_PASSWORDS_MUST_TRANSLATE_LEAF_KEYS = new Set([
  'savedPasswordsHeading',
  'sidebarLegendTitle',
  'legendNotSaved',
  'legendSaved',
  'legendLoggedIn',
  'stopAutoLogin',
]);

/** Polish MT often turns "Saved passwords" into browser autofill copy. */
export const PL_SAVED_PASSWORDS_HEADING_AUTOFILL_RE = /wypełnianie.*hasłem/i;

/** Simplified Chinese should use 登录 for sign-in, not ship-boarding 登陆. */
export const ZH_LOGIN_WRONG_CHAR_RE = /登陆/;

/** Czech MT uses noun "login" instead of logged-in state on legendLoggedIn. */
export const CS_LOGGED_IN_NOUN_RE = /^Přihlášení$/;

/** MeshCore Rooms sidebar marker legend tooltips (sky ◐ / green ● / empty ○). */
export const ROOMS_SIDEBAR_MARKER_TOOLTIP_KEYS = new Set([
  'legendNotSavedTooltip',
  'legendSavedTooltip',
  'legendLoggedInTooltip',
]);

/** Auto-translate often leaves "Sky half-circle" in legendSavedTooltip. */
export const SKY_HALF_CIRCLE_ENGLISH_RES = [
  /\bSky[\s-]*half/i,
  /\bSky[\s-]*Halb/i,
  /\bSky\s+semicerchio/i,
];

/** MT mistranslates "leave the room" as "leave space" on legendLoggedInTooltip. */
export const LEGEND_LEAVE_SPACE_FALSE_FRIEND_RES = [
  /\bleave space\b/i,
  /\bdeixe espaço\b/i,
  /\blaisser de la place\b/i,
  /\blasciare spazio\b/i,
  /\bdejar espacio\b/i,
  /\bponechte prostor\b/i,
  /\bpozostaw miejsce\b/i,
  /\blaat ruimte\b/i,
  /留出空间/,
  /スペースを空/,
  /자리를 비움/,
  /\bоставьте место\b/i,
  /залишити місце/i,
];

/** Turkish MT uses consulting-client "danışan" instead of software client. */
export const TR_CLIENT_DANISAN_RE = /\bdanışan\b/i;

/** French MT uses hotel "pièce" for MeshCore Room in new sidebar copy. */
export const FR_ROOM_PIECE_RE = /\bpièce\b/i;

/** sidebarLegendTitle must mention markers when English does. */
export const SIDEBAR_MARKER_WORD_RE =
  /(?:\bmark(?:er|ierung|ierungen|ering|eringen|ör|e)?\b|markering(?:en)?|marqueur|marcador(?:es)?|indicat(?:or|ore|eur|e)?|znacznik|znak|značk|penanda|işaret|маркер|标记|マーカ|마커)/i;

/** roomsPanel keys where French "pièce" is a known MT hotel-room false friend. */
export const FR_ROOM_PIECE_SIDEBAR_KEYS = new Set([
  'statusPasswordSaved',
  'statusLoggedInSessionTooltip',
  'legendNotSavedTooltip',
]);

export const ROOMS_STATUS_LOGGED_IN_SESSION_KEY = `${ROOMS_PANEL_PREFIX}statusLoggedInSession`;
export const ROOMS_LEGEND_LOGGED_IN_KEY = `${ROOMS_PANEL_PREFIX}legendLoggedIn`;
export const ROOMS_STATUS_PASSWORD_SAVED_KEY = `${ROOMS_PANEL_PREFIX}statusPasswordSaved`;
export const ROOMS_SIDEBAR_LEGEND_TITLE_KEY = `${ROOMS_PANEL_PREFIX}sidebarLegendTitle`;

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
const placeholderNameSetCache = new Map();

export function placeholderNameSet(s) {
  const cached = placeholderNameSetCache.get(s);
  if (cached) return cached;
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  const out = new Set();
  let m;
  while ((m = re.exec(s))) {
    out.add(m[1]);
  }
  placeholderNameSetCache.set(s, out);
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
// GPIO is a hardware acronym that must not be translated or expanded in UI strings.
export const PROTECTED_BRANDS = ['TAK', 'Discord', 'Meshtastic', 'MeshCore', 'MQTT', 'GPIO'];

const BRAND_WORD_RES = new Map([
  ['TAK', /\bTAK\b/g],
  ['Discord', /\bDiscord\b/g],
  ['Meshtastic', /\bMeshtastic\b/g],
  ['MeshCore', /\bMeshCore\b/g],
  ['MQTT', /\bMQTT\b/g],
  ['GPIO', /\bGPIO\b/g],
]);

// UTF-8 Cyrillic (etc.) misread as Latin-1 in JSON.
const MOJIBAKE_RE = /Ð[\u0080-\u00FF]{2,}|Ã[\u0080-\u00BF]{2,}|Â[\u0080-\u00BF]{2,}/;

const BROKEN_MESHTASTIC_SCHEME_RE = /meshtastic[\s\u00a0]+:\/\//i;

const MESHTASTIC_MISSPELLING_RE = /meshtastisch/i;

const MESHTASTIC_CYRILLIC_TRANSLIT_RE = /мештаст/i;

const ZH_CAT_GARBAGE_RE = /%\s*\d+.*文件夹|文件夹.*%\s*\d+/;

/** MyMemory/CAT often leaks Qt plural-form notes into short labels. */
export const CAT_PLURAL_FORM_RESIDUE_RE = /plural form:|&apos;/i;

/** MeshCore path-hash UI — CLI token in meshcorePathHashModeHint must stay verbatim. */
export const MESHCORE_PATH_HASH_HINT_KEY = 'appPanel.meshcorePathHashModeHint';
export const MESHCORE_PATH_HASH_CLI_LITERAL = 'set path.hash.mode {0|1|2}';

const MESHCORE_PATH_HASH_MODE_BYTE_LEAF_KEYS = new Set([
  'meshcorePathHashMode1Byte',
  'meshcorePathHashMode2Byte',
  'meshcorePathHashMode3Byte',
]);

const MESHCORE_PATH_HASH_MODE_SHORT_LEAF_KEYS = new Set([
  'meshcorePathHashModeShort0',
  'meshcorePathHashModeShort1',
  'meshcorePathHashModeShort2',
]);

/** Brewing-ingredient hop false friends on path-hash hop-count strings only. */
const PATH_HASH_BREWING_HOP_FALSE_FRIEND_RES = [/chmel/i, /хмел/i];

const MESHCORE_PATH_HASH_SHORT_PAREN_ONLY_RE = /^\([^)]+\)$/;

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
 * @typedef {{ locale: string, flatKey: string, val: string, enVal: string, leafKey: string }} LocaleQualityCtx
 */

/**
 * @param {LocaleQualityCtx} ctx
 * @returns {string[]}
 */
function checkCatEncodingAndMeshtasticIssues(ctx) {
  const { locale, flatKey, val, enVal } = ctx;
  const issues = [];
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

  if (CAT_PLURAL_FORM_RESIDUE_RE.test(val)) {
    issues.push('CAT/Qt plural-form placeholder residue is not allowed');
  }

  if (
    locale === 'fr' &&
    (flatKey.startsWith(CHANNEL_URL_PREFIX) || FR_MESH_CHANNEL_KEYS.has(flatKey)) &&
    FR_CHANNEL_FALSE_FRIEND_RE.test(val)
  ) {
    issues.push('French "chaîne(s)" means broadcast channel; use "canal/canaux" for mesh channels');
  }
  return issues;
}

/**
 * @param {LocaleQualityCtx} ctx
 * @returns {string[]}
 */
function checkMustTranslateAndFormFieldIssues(ctx) {
  const { locale, val, enVal, leafKey } = ctx;
  const issues = [];
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
  return issues;
}

/**
 * @param {LocaleQualityCtx} ctx
 * @returns {string[]}
 */
function checkRadioPanelChannelIssues(ctx) {
  const { locale, flatKey, val, leafKey } = ctx;
  const issues = [];
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
  return issues;
}

/**
 * @param {LocaleQualityCtx} ctx
 * @returns {string[]}
 */
function checkRoomsPanelFalseFriendIssues(ctx) {
  const { locale, flatKey, val } = ctx;
  const issues = [];
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
  return issues;
}

/**
 * @param {LocaleQualityCtx} ctx
 * @returns {string[]}
 */
function checkMeshAdvertAndRawPacketLogIssues(ctx) {
  const { locale, flatKey, val, enVal } = ctx;
  const issues = [];
  const shouldCheckMeshAdvertCommercial =
    isMeshAdvertCommercialCheckKey(flatKey) ||
    (locale === 'nl' && isMeshAdvertUiKey(flatKey, enVal));
  if (shouldCheckMeshAdvertCommercial) {
    for (const { re, hint } of MESH_ADVERT_COMMERCIAL_FALSE_FRIENDS[locale] ?? []) {
      if (re.test(val)) {
        issues.push(`${locale} mesh-advert false friend: ${hint}`);
      }
    }
  }

  if (flatKey.startsWith(RAW_PACKET_LOG_PREFIX)) {
    const packetLeaf = flatKey.split('.').pop() ?? flatKey;
    if (RAW_PACKET_LOG_SHORT_LABEL_KEYS.has(packetLeaf)) {
      if (CAT_DOT_PADDING_RE.test(val)) {
        issues.push('rawPacketLog short label has CAT dot-padding garbage — use a concise label');
      }
      if (packetLeaf === 'payloadLabel' && val.length > 24) {
        issues.push('payloadLabel looks too long — use a short label (e.g. Payload)');
      }
    }
    if (locale === 'uk' && packetLeaf === 'transportHeading' && /Телепортувати/i.test(val)) {
      issues.push(
        'transportHeading must be mesh transport header label, not verb "teleport" (Телепортувати)',
      );
    }
    for (const issue of meshcoreProtocolTokenIssues(flatKey, enVal, val)) {
      issues.push(issue);
    }
  }

  if (
    locale === 'de' &&
    (flatKey.startsWith('radioPanel.deviceRoles') || flatKey.startsWith('roleInfo.roles.'))
  ) {
    for (const { re, hint } of DE_DEVICE_ROLE_FALSE_FRIENDS) {
      if (re.test(val)) {
        issues.push(`de device role false friend: ${hint}`);
      }
    }
  }
  return issues;
}

/**
 * @param {LocaleQualityCtx} ctx
 * @returns {string[]}
 */
function checkRoomsGuestPasswordAndNlMeshIssues(ctx) {
  const { locale, flatKey, val, enVal } = ctx;
  const issues = [];
  if (
    locale !== 'en' &&
    flatKey === `${ROOMS_PANEL_PREFIX}guestPasswordPlaceholder` &&
    enVal === 'hello' &&
    val.toLowerCase() !== 'hello'
  ) {
    issues.push('guestPasswordPlaceholder must stay literal wire password "hello"');
  }

  if (locale === 'nl' && isMeshcoreRoomUiKey(flatKey) && /\b[Kk]amer/i.test(val)) {
    issues.push('roomsPanel false friend: use "ruimte" for MeshCore Room, not hotel "kamer"');
  }

  if (locale === 'nl') {
    const gaasIssue = nlMeshGaasIssue(enVal, val);
    if (gaasIssue) issues.push(gaasIssue);
  }
  return issues;
}

/**
 * @param {LocaleQualityCtx} ctx
 * @returns {string[]}
 */
function checkMqttWifiAndScriptIssues(ctx) {
  const { locale, flatKey, val, enVal } = ctx;
  const issues = [];
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
  return issues;
}

/**
 * @param {LocaleQualityCtx} ctx
 * @returns {string[]}
 */
function checkRoomsPanelTranslationIssues(ctx) {
  const { locale, flatKey, val, enVal, leafKey } = ctx;
  const issues = [];
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
      issues.push(LOCALE_QUALITY_ROOMS_HELLO_MISSING_LITERAL);
    }
    for (const re of ROOMS_HELLO_PASSWORD_FALSE_FRIEND_RES[locale] ?? []) {
      if (re.test(val)) {
        issues.push(roomsHelloFalseFriendIssueCode(locale));
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
  return issues;
}

/**
 * @param {LocaleQualityCtx} ctx
 * @returns {string[]}
 */
function checkChatPanelIssues(ctx) {
  const { locale, flatKey, val, enVal, leafKey } = ctx;
  const issues = [];
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

  if (
    locale !== 'en' &&
    flatKey.startsWith('chatPanel.') &&
    CHAT_PANEL_OUTBOX_UI_LEAF_KEYS.has(leafKey)
  ) {
    for (const { re, hint } of CHAT_PANEL_OUTBOX_UI_FALSE_FRIENDS[locale] ?? []) {
      if (re.test(val)) {
        issues.push(`chatPanel outbox/date false friend: ${hint}`);
      }
    }
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
  return issues;
}

/**
 * @param {LocaleQualityCtx} ctx
 * @returns {string[]}
 */
function checkRoomsPanelMembersIssues(ctx) {
  const { locale, flatKey, val, enVal, leafKey } = ctx;
  const issues = [];
  if (
    locale !== 'en' &&
    flatKey.startsWith(ROOMS_PANEL_PREFIX) &&
    ROOMS_MEMBERS_MUST_TRANSLATE_LEAF_KEYS.has(leafKey) &&
    val === enVal
  ) {
    issues.push(`"${leafKey}" is still identical to English — translate the UI text`);
  }

  if (
    locale !== 'en' &&
    flatKey.startsWith(ROOMS_PANEL_PREFIX) &&
    ROOMS_SAVED_PASSWORDS_MUST_TRANSLATE_LEAF_KEYS.has(leafKey) &&
    val === enVal
  ) {
    issues.push(`"${leafKey}" is still identical to English — translate the UI text`);
  }

  if (
    locale === 'pl' &&
    leafKey === 'savedPasswordsHeading' &&
    PL_SAVED_PASSWORDS_HEADING_AUTOFILL_RE.test(val)
  ) {
    issues.push(
      'savedPasswordsHeading confuses saved passwords with browser autofill — use "Zapisane hasła"',
    );
  }

  if (
    locale === 'zh' &&
    flatKey.startsWith(ROOMS_PANEL_PREFIX) &&
    (leafKey === 'badgeAutoLogin' || leafKey === 'stopAutoLogin' || leafKey === 'legendLoggedIn') &&
    ZH_LOGIN_WRONG_CHAR_RE.test(val)
  ) {
    issues.push('use 登录 for sign-in, not 登陆 (boarding a ship)');
  }

  if (
    locale === 'cs' &&
    (leafKey === 'legendLoggedIn' || leafKey === 'statusLoggedInSession') &&
    enVal === 'Logged in' &&
    CS_LOGGED_IN_NOUN_RE.test(val)
  ) {
    issues.push(`${leafKey} must be "Přihlášen" (logged in), not noun "Přihlášení" (login)`);
  }

  if (
    locale !== 'en' &&
    flatKey.startsWith(ROOMS_PANEL_PREFIX) &&
    ROOMS_SIDEBAR_MARKER_TOOLTIP_KEYS.has(leafKey) &&
    leafKey === 'legendSavedTooltip' &&
    enVal.includes('Sky half-circle')
  ) {
    for (const re of SKY_HALF_CIRCLE_ENGLISH_RES) {
      if (re.test(val)) {
        issues.push(
          'legendSavedTooltip still quotes English "Sky half-circle" — describe the sky-blue ◐ marker',
        );
        break;
      }
    }
  }

  if (flatKey === `${ROOMS_PANEL_PREFIX}legendLoggedInTooltip` && enVal.includes('leave room')) {
    for (const re of LEGEND_LEAVE_SPACE_FALSE_FRIEND_RES) {
      if (re.test(val)) {
        issues.push(
          'legendLoggedInTooltip uses "leave space" false friend — say leave the MeshCore room when the server is offline',
        );
        break;
      }
    }
  }

  if (
    locale === 'fr' &&
    flatKey.startsWith(ROOMS_PANEL_PREFIX) &&
    FR_ROOM_PIECE_SIDEBAR_KEYS.has(leafKey) &&
    FR_ROOM_PIECE_RE.test(val) &&
    (enVal.includes('room') || enVal.includes('Room'))
  ) {
    issues.push('roomsPanel false friend: use "salle" for MeshCore Room, not hotel "pièce"');
  }

  if (
    locale === 'tr' &&
    flatKey === `${ROOMS_PANEL_PREFIX}statusLoggedInSessionTooltip` &&
    TR_CLIENT_DANISAN_RE.test(val)
  ) {
    issues.push('statusLoggedInSessionTooltip uses "danışan" — use "istemci" for software client');
  }

  if (
    flatKey === ROOMS_STATUS_PASSWORD_SAVED_KEY &&
    enVal.includes('(sky marker') &&
    locale !== 'en'
  ) {
    if (/sky marker/i.test(val)) {
      issues.push(
        'statusPasswordSaved still quotes English "sky marker" — describe the sky-blue sidebar marker',
      );
    } else if (!/[(（]/.test(val)) {
      issues.push(
        'statusPasswordSaved must mention the sky-blue sidebar marker when not logged in',
      );
    }
  }

  if (
    flatKey === ROOMS_SIDEBAR_LEGEND_TITLE_KEY &&
    enVal.includes('marker') &&
    locale !== 'en' &&
    !SIDEBAR_MARKER_WORD_RE.test(val)
  ) {
    issues.push('sidebarLegendTitle must mention sidebar markers, not only room status');
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

/**
 * @param {LocaleQualityCtx} ctx
 * @returns {string[]}
 */
function checkAppPanelReduceMotionAndBrandIssues(ctx) {
  const { locale, flatKey, val, enVal } = ctx;
  const issues = [];
  if (flatKey === REDUCE_MOTION_DESC_KEY && enVal.includes('Loading spinners')) {
    for (const { re, hint } of REDUCE_MOTION_LOADING_SPINNER_FALSE_FRIENDS[locale] ?? []) {
      if (re.test(val)) {
        issues.push(`reduceMotionDesc loading-spinner false friend: ${hint}`);
      }
    }
    for (const { re, hint } of REDUCE_MOTION_STILL_ANIMATE_FALSE_FRIENDS[locale] ?? []) {
      if (re.test(val)) {
        issues.push(`reduceMotionDesc still-animate false friend: ${hint}`);
      }
    }
  }

  if (locale === 'pt-BR' && flatKey === REDUCE_MOTION_KEY && /\bReduzam\b/.test(val)) {
    issues.push(
      'reduceMotion uses plural imperative "Reduzam" — use infinitive "Reduzir movimento"',
    );
  }

  if (
    locale === 'zh' &&
    flatKey === REDUCE_MOTION_KEY &&
    enVal === 'Reduce motion' &&
    /减少运动/.test(val)
  ) {
    issues.push('reduceMotion uses 运动 (exercise) — use 动态效果 or 动画 for UI motion');
  }

  if (enVal.includes('Mesh-Client') && MESH_CLIENT_SPACED_RE.test(val)) {
    issues.push('use "Mesh-Client" without spaces around the hyphen (not "Mesh - Client")');
  }

  if (enVal.includes('mesh-client') && MESH_CLIENT_LOWERCASE_SPACED_RE.test(val)) {
    issues.push('use "mesh-client" without spaces around the hyphen (not "mesh - client")');
  }
  return issues;
}

/**
 * @param {LocaleQualityCtx} ctx
 * @returns {string[]}
 */
function checkMeshcoreOpenWireIssues(ctx) {
  const { locale, flatKey, val, enVal, leafKey } = ctx;
  const issues = [];
  if (locale !== 'en' && isMeshcoreOpenWireUiLeafKey(leafKey) && val === enVal) {
    issues.push(`"${leafKey}" is still identical to English — translate the UI text`);
  }

  if (isMeshcoreOpenWireUiLeafKey(leafKey)) {
    for (const issue of meshcoreOpenWireProtocolTokenIssues(enVal, val)) {
      issues.push(`meshcoreOpenWire protocol token: ${issue}`);
    }
  }

  if (
    leafKey === 'meshcoreOpenWireCompatHint' &&
    enVal.includes('companion wire') &&
    locale !== 'en'
  ) {
    for (const { re, hint } of COMPANION_WIRE_PHYSICAL_FALSE_FRIEND_RES) {
      if (re.test(val)) {
        issues.push(`companion wire false friend: ${hint}`);
      }
    }
    if (OPEN_AWARE_ENGLISH_RE.test(val)) {
      issues.push(
        'translate "Open-aware" — use locale wording for MeshCore Open-compatible clients',
      );
    }
    if (/\br:\s*reactions\b/i.test(val)) {
      issues.push(
        'translate "r: reactions" — do not leave English "reactions" after wire prefix r:',
      );
    }
    for (const { re, hint } of KEYED_REPLY_FALSE_FRIENDS[locale] ?? []) {
      if (re.test(val)) {
        issues.push(`keyed reply false friend: ${hint}`);
      }
    }
  }

  if (
    leafKey === 'meshcoreOpenWireExperimentalTitle' &&
    enVal.includes('Open wire') &&
    locale !== 'en'
  ) {
    for (const { re, hint } of COMPANION_WIRE_PHYSICAL_FALSE_FRIEND_RES) {
      if (re.test(val)) {
        issues.push(`open wire title false friend: ${hint}`);
      }
    }
  }

  if (leafKey === 'meshcoreGifHint' && enVal.includes('bare GIF id')) {
    if (/\bBARE GIF\b/i.test(val)) {
      issues.push('translate "bare GIF id" — do not leave English "BARE GIF"');
    }
    for (const { re, hint } of MESHCORE_GIF_HINT_BARE_FALSE_FRIEND_RES) {
      if (re.test(val)) {
        issues.push(`meshcoreGifHint bare-id false friend: ${hint}`);
      }
    }
  }

  if (
    leafKey === 'meshcoreGifButtonHint' &&
    enVal.includes('MeshCore Open g: wire') &&
    /MeshCore\s+Abrir\s+g:/i.test(val)
  ) {
    issues.push('meshcoreGifButtonHint broke "MeshCore Open" — do not translate Open as a verb');
  }

  if (
    locale !== 'en' &&
    flatKey.startsWith('appPanel.') &&
    APP_PANEL_DEBUG_SNAPSHOT_LEAF_KEYS.has(leafKey) &&
    val === enVal
  ) {
    issues.push(`"${leafKey}" is still identical to English — translate the UI text`);
  }

  if (flatKey === DEBUG_SNAPSHOT_COPIED_KEY) {
    for (const { re, hint } of DEBUG_SNAPSHOT_COPIED_FALSE_FRIENDS[locale] ?? []) {
      if (re.test(val)) {
        issues.push(`debugSnapshotCopied false friend: ${hint}`);
      }
    }
  }

  if (flatKey.startsWith('appPanel.') && APP_PANEL_DEBUG_SNAPSHOT_LEAF_KEYS.has(leafKey)) {
    for (const { re, hint } of DEBUG_SNAPSHOT_MIXED_EN_SNAPSHOT_RES[locale] ?? []) {
      if (re.test(val)) {
        issues.push(`debugSnapshot mixed EN snapshot: ${hint}`);
      }
    }
  }

  if (
    locale === 'de' &&
    flatKey === 'appPanel.debugSnapshotFailed' &&
    DE_DEBUG_SNAPSHOT_FAILED_WRONG_TERM_RE.test(val)
  ) {
    issues.push(
      'debugSnapshotFailed must use "Debug-Snapshot" consistently, not "Fehlerbehebungs-Snapshot"',
    );
  }

  if (
    locale === 'id' &&
    flatKey === DEBUG_SNAPSHOT_COPIED_KEY &&
    enVal.includes('clipboard') &&
    /\bclipboard\b/i.test(val)
  ) {
    issues.push('debugSnapshotCopied uses English "clipboard" — use "papan klip"');
  }
  return issues;
}

/**
 * @param {LocaleQualityCtx} ctx
 * @returns {string[]}
 */
function checkUkrainianApostropheIssues(ctx) {
  const { locale, val } = ctx;
  const issues = [];
  if (locale === 'uk' && UK_BROKEN_APOSTROPHE_RE.test(val)) {
    issues.push(
      "Ukrainian apostrophe words must not have a space before ' (e.g. з'єднання, not з 'єднання)",
    );
  }
  return issues;
}

/**
 * @param {LocaleQualityCtx} ctx
 * @returns {string[]}
 */
function checkMeshcoreReactionAndConnectionIssues(ctx) {
  const { locale, flatKey, val, enVal, leafKey } = ctx;
  const issues = [];
  if (
    locale !== 'en' &&
    flatKey.startsWith('chatPanel.') &&
    MESHCORE_REACTION_UI_LEAF_KEYS.has(leafKey) &&
    val === enVal
  ) {
    issues.push(`"${leafKey}" is still identical to English — translate the UI text`);
  }

  if (
    locale !== 'en' &&
    flatKey.startsWith('chatPanel.') &&
    MESHCORE_REACTION_UI_LEAF_KEYS.has(leafKey)
  ) {
    for (const { re, hint } of MESHCORE_REACTION_EMOJI_OPTION_FALSE_FRIENDS[locale] ?? []) {
      if (re.test(val)) {
        issues.push(`meshcoreReaction false friend: ${hint}`);
      }
    }
  }

  if (
    locale !== 'en' &&
    flatKey === CONNECTION_BANNER_SERIAL_RESELECT_ACTION_KEY &&
    val === enVal
  ) {
    issues.push('"serialReselectAction" is still identical to English — translate the UI text');
  }

  if (flatKey === CONNECTION_BANNER_SERIAL_RESELECT_ACTION_KEY) {
    for (const { re, hint } of SERIAL_RESELECT_ACTION_FALSE_FRIEND_RES) {
      if (re.test(val)) {
        issues.push(`serialReselectAction false friend: ${hint}`);
      }
    }
  }

  if (
    locale === 'it' &&
    flatKey.startsWith(ROOMS_PANEL_PREFIX) &&
    ROOMS_LIST_COLLAPSE_LEAF_KEYS.has(leafKey) &&
    /\bstanze\b/i.test(val)
  ) {
    issues.push('roomsPanel false friend: use "sale" for MeshCore Room list, not hotel "stanze"');
  }

  if (flatKey === MESHCORE_DISTANCE_FILTER_HINT_KEY && enVal.includes('App → Appearance')) {
    if (locale !== 'en' && UNTRANSLATED_APP_APPEARANCE_NAV_RE.test(val)) {
      issues.push(
        'meshcoreDistanceFilterHint still quotes English "App → Appearance" — use locale tabs.app and appPanel.appearanceSection labels',
      );
    }
    if (/\bApp App\b/.test(val)) {
      issues.push('meshcoreDistanceFilterHint has duplicated "App App" MT garbage');
    }
    if (locale !== 'en' && ORPHAN_UI_ARROW_NAV_RE.test(val)) {
      issues.push(
        'meshcoreDistanceFilterHint has orphan "→" navigation — prefix with locale App tab name before → appearanceSection',
      );
    }
  }

  return issues;
}

/**
 * @param {LocaleQualityCtx} ctx
 * @returns {string[]}
 */
function checkMeshcorePathHashIssues(ctx) {
  const { locale, flatKey, val, enVal, leafKey } = ctx;
  const issues = [];

  if (MESHCORE_PATH_HASH_MODE_BYTE_LEAF_KEYS.has(leafKey)) {
    for (const re of PATH_HASH_BREWING_HOP_FALSE_FRIEND_RES) {
      if (re.test(val)) {
        issues.push(
          'meshcore path-hash hop count uses brewing-hop false friend — use routing hop/skok/хоп term',
        );
        break;
      }
    }
  }

  if (MESHCORE_PATH_HASH_MODE_SHORT_LEAF_KEYS.has(leafKey)) {
    if (MESHCORE_PATH_HASH_SHORT_PAREN_ONLY_RE.test(val)) {
      issues.push('meshcorePathHashModeShort label must not be parenthesis-only MT garbage');
    }
    if (locale !== 'en' && val === enVal) {
      issues.push(
        `"${leafKey}" is still identical to English — translate the short byte-size label`,
      );
    }
  }

  if (flatKey === MESHCORE_PATH_HASH_HINT_KEY && enVal.includes(MESHCORE_PATH_HASH_CLI_LITERAL)) {
    if (!val.includes(MESHCORE_PATH_HASH_CLI_LITERAL)) {
      issues.push(
        `meshcorePathHashModeHint must preserve CLI literal ${JSON.stringify(MESHCORE_PATH_HASH_CLI_LITERAL)} verbatim`,
      );
    }
  }

  return issues;
}

const LOCALE_STRING_QUALITY_CHECKS = [
  checkCatEncodingAndMeshtasticIssues,
  checkMustTranslateAndFormFieldIssues,
  checkRadioPanelChannelIssues,
  checkRoomsPanelFalseFriendIssues,
  checkMeshAdvertAndRawPacketLogIssues,
  checkRoomsGuestPasswordAndNlMeshIssues,
  checkMqttWifiAndScriptIssues,
  checkRoomsPanelTranslationIssues,
  checkChatPanelIssues,
  checkRoomsPanelMembersIssues,
  checkAppPanelReduceMotionAndBrandIssues,
  checkMeshcoreOpenWireIssues,
  checkUkrainianApostropheIssues,
  checkMeshcoreReactionAndConnectionIssues,
  checkMeshcorePathHashIssues,
];

/**
 * @param {LocaleStringContext} ctx
 * @returns {string[]} Human-readable issue descriptions (empty if OK).
 */
export function localeStringQualityIssues({ locale, flatKey, val, enVal }) {
  const leafKey = flatKey.split('.').pop() ?? flatKey;
  const qualityCtx = { locale, flatKey, val, enVal, leafKey };
  const issues = [];
  for (const check of LOCALE_STRING_QUALITY_CHECKS) {
    issues.push(...check(qualityCtx));
  }
  return issues;
}

/** nodeListPanel MQTT connection tooltips added with hybrid RF+MQTT path icons. */
export const NODE_LIST_PANEL_MQTT_CONNECTED_KEY = 'nodeListPanel.mqttConnectedTooltip';
export const NODE_LIST_PANEL_RF_MQTT_CONNECTED_KEY = 'nodeListPanel.connectedViaRfAndMqttTooltip';

/**
 * Cross-key checks for nodeListPanel connection tooltips (mqtt-only vs RF+MQTT).
 *
 * @param {string} locale
 * @param {Record<string, string>} localeFlat
 * @returns {string[]} Human-readable issue descriptions (empty if OK).
 */
export function nodeListPanelConnectionCrossKeyIssues(locale, localeFlat) {
  const issues = [];
  const mqtt = localeFlat[NODE_LIST_PANEL_MQTT_CONNECTED_KEY];
  const hybrid = localeFlat[NODE_LIST_PANEL_RF_MQTT_CONNECTED_KEY];
  if (typeof mqtt !== 'string' || typeof hybrid !== 'string') return issues;

  if (locale === 'tr' && /bağlanıldı/i.test(mqtt) && /\bbağlanır\b/i.test(hybrid)) {
    issues.push(
      'connectedViaRfAndMqtt* uses present "bağlanır" — match mqttConnectedTooltip past "bağlanıldı" for connected state',
    );
  }
  if (locale === 'de' && /^Verbunden\b/i.test(mqtt) && /^Anbindung\b/i.test(hybrid)) {
    issues.push(
      'connectedViaRfAndMqtt* uses noun "Anbindung" — match mqttConnectedTooltip adjective "Verbunden"',
    );
  }
  if (locale === 'pl' && /^Połączono\b/i.test(mqtt) && /^Połączony\b/i.test(hybrid)) {
    issues.push(
      'connectedViaRfAndMqtt* uses "Połączony" — match mqttConnectedTooltip impersonal "Połączono"',
    );
  }
  return issues;
}

/**
 * Cross-key checks for roomsPanel saved-password legend and auto-login labels.
 *
 * @param {Record<string, string>} localeFlat
 * @param {Record<string, string>} enFlat
 * @returns {string[]} Human-readable issue descriptions (empty if OK).
 */
export function roomsSavedPasswordsCrossKeyIssues(localeFlat, enFlat) {
  const issues = [];
  const notSavedKey = `${ROOMS_PANEL_PREFIX}legendNotSaved`;
  const savedKey = `${ROOMS_PANEL_PREFIX}legendSaved`;
  const stopKey = `${ROOMS_PANEL_PREFIX}stopAutoLogin`;
  const badgeKey = `${ROOMS_PANEL_PREFIX}badgeAutoLogin`;

  const notSaved = localeFlat[notSavedKey];
  const saved = localeFlat[savedKey];
  const stop = localeFlat[stopKey];
  const badge = localeFlat[badgeKey];
  const enNotSaved = enFlat[notSavedKey];
  const enSaved = enFlat[savedKey];
  const enStop = enFlat[stopKey];
  const enBadge = enFlat[badgeKey];

  if (typeof notSaved === 'string' && typeof saved === 'string' && notSaved === saved) {
    issues.push('legendNotSaved must differ from legendSaved');
  }
  if (
    typeof notSaved === 'string' &&
    typeof enSaved === 'string' &&
    typeof enNotSaved === 'string' &&
    enNotSaved !== enSaved &&
    notSaved === enSaved
  ) {
    issues.push('legendNotSaved must not reuse legendSaved (password saved) wording');
  }
  if (
    typeof stop === 'string' &&
    typeof badge === 'string' &&
    typeof enStop === 'string' &&
    typeof enBadge === 'string' &&
    enStop !== enBadge &&
    stop === badge
  ) {
    issues.push('stopAutoLogin must not duplicate badgeAutoLogin');
  }
  return issues;
}

/**
 * Cross-key checks for MeshCore Rooms sidebar marker legend strings.
 *
 * @param {Record<string, string>} localeFlat
 * @param {Record<string, string>} enFlat
 * @returns {string[]} Human-readable issue descriptions (empty if OK).
 */
export function roomsSidebarMarkerCrossKeyIssues(localeFlat, enFlat) {
  const issues = [];
  const session = localeFlat[ROOMS_STATUS_LOGGED_IN_SESSION_KEY];
  const legend = localeFlat[ROOMS_LEGEND_LOGGED_IN_KEY];
  const enSession = enFlat[ROOMS_STATUS_LOGGED_IN_SESSION_KEY];
  const enLegend = enFlat[ROOMS_LEGEND_LOGGED_IN_KEY];

  if (
    typeof session === 'string' &&
    typeof legend === 'string' &&
    typeof enSession === 'string' &&
    typeof enLegend === 'string' &&
    enSession === enLegend &&
    session !== legend
  ) {
    issues.push('statusLoggedInSession must match legendLoggedIn');
  }
  return issues;
}

/**
 * Pure helpers for i18n-auto-translate.mjs (unit-tested).
 */

/** MyMemory/CAT often spaces out __PHn__ tokens (e.g. __ PH0 __, __ PH 1 __). */
export const MT_PLACEHOLDER_TOKEN_RE = /__\s*PH\s*(\d+)\s*__/gi;

/**
 * When MT drops the underscores entirely (whole-string brand shields → "PH0" / "Ph0").
 * Only used when a matching placeholder index exists — avoids rewriting prose "PH".
 */
export const MT_BARE_PH_TOKEN_RE = /\bPH\s*(\d+)\b/gi;

/**
 * Strip CAT / XLIFF / Memsource tags that sometimes leak into free-API MT output.
 * Linear scan — avoids nested-quantifier regex (eslint security/detect-unsafe-regex).
 * @param {string} text
 * @returns {string}
 */
export function stripCatXmlTags(text) {
  const names = new Set([
    'ph',
    'g',
    'x',
    'bx',
    'ex',
    'bpt',
    'ept',
    'it',
    'mrk',
    'primary',
    'secondary',
  ]);
  let out = '';
  for (let i = 0; i < text.length;) {
    if (text[i] !== '<') {
      out += text[i];
      i += 1;
      continue;
    }
    const close = text.indexOf('>', i + 1);
    if (close === -1) {
      out += text.slice(i);
      break;
    }
    const inner = text.slice(i + 1, close).trim();
    let tagScan = inner.startsWith('/') ? inner.slice(1).trimStart() : inner;
    let tagName = '';
    if (/^[A-Za-z]/.test(tagScan)) {
      tagName = tagScan[0];
      tagScan = tagScan.slice(1);
      while (tagScan.length > 0 && /^[A-Za-z0-9]/.test(tagScan[0])) {
        tagName += tagScan[0];
        tagScan = tagScan.slice(1);
      }
    }
    const name = tagName.toLowerCase();
    if (name && names.has(name)) {
      i = close + 1;
      continue;
    }
    out += text.slice(i, close + 1);
    i = close + 1;
  }
  return out;
}

/**
 * @param {string[]} terms
 * @returns {RegExp | null}
 */
function buildProtectedTermRe(terms) {
  if (terms.length === 0) return null;
  const alternation = [...terms]
    .sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  // eslint-disable-next-line security/detect-non-literal-regexp -- Terms are checked-in brand/protocol lists, regex-escaped above.
  return new RegExp(`(?<![\\w-])(?:${alternation})(?![\\w-])`, 'g');
}

/**
 * Replace i18next {{name}} tokens — and any `protectedTerms` (brand / protocol names
 * check:i18n requires verbatim) — with opaque __PHn__ markers before MT.
 *
 * @param {string} str
 * @param {string[]} [protectedTerms]
 * @returns {{ stripped: string; placeholders: string[] }}
 */
export function stripPlaceholders(str, protectedTerms = []) {
  const placeholders = [];
  const shield = (m) => {
    const idx = placeholders.length;
    placeholders.push(m);
    return `__PH${idx}__`;
  };
  let stripped = str.replace(/\{\{[^}]+\}\}/g, shield);
  const termRe = buildProtectedTermRe(protectedTerms);
  if (termRe) stripped = stripped.replace(termRe, shield);
  return { stripped, placeholders };
}

/** Ukrainian apostrophe words MT splits with spaces (з 'єднання, зв' язку). */
const UK_SPLIT_APOSTROPHE_RE = /([а-яіїєґА-ЯІЇЄҐ])\s*['\u2019\u02bc]\s*([а-яіїєґА-ЯІЇЄҐ])/g;

/**
 * Locale-specific cleanup of MT output before it is saved.
 * Also strips CAT/XLIFF tag residue and trims whitespace MT often appends.
 *
 * @param {string} text
 * @param {string} localeDir
 * @returns {string}
 */
export function normalizeMachineTranslation(text, localeDir) {
  let out = stripCatXmlTags(String(text)).trim();
  if (localeDir === 'uk') out = out.replace(UK_SPLIT_APOSTROPHE_RE, "$1'$2");
  return out;
}

/**
 * Restore i18next placeholders after MT, tolerating spaced __ PH n __ variants
 * and bare PH n residue when the engine drops the underscores.
 *
 * @param {string} str
 * @param {string[]} placeholders
 * @returns {string}
 */
export function restorePlaceholders(str, placeholders) {
  const withUnderscores = str.replace(
    MT_PLACEHOLDER_TOKEN_RE,
    (_, idx) => placeholders[Number(idx)] ?? '',
  );
  if (placeholders.length === 0) return withUnderscores;
  return withUnderscores.replace(MT_BARE_PH_TOKEN_RE, (match, idx) => {
    const replacement = placeholders[Number(idx)];
    return replacement === undefined ? match : replacement;
  });
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
  /\b(Colorado Mesh|Nomad Network|Ripple Networks|mesh-client|Mesh-Client|Liam's|CalTopo|LetsMesh|MeshMapper|Flood Advert|Discovery Flood|Room Advert|Neighbor Info|Node Info|SharedArrayBuffer|TCP\/IP|Wi-Fi|GitHub|Reticulum)\b/gi;

// Tokens that are legitimately identical across languages and should not be
// treated as "untranslated" when a locale value matches English verbatim.
const SKIP_AUDIT_RE =
  /\b(TAK|Discord|Meshtastic|MeshCore|MQTT|LoRa|GPS|BLE|SNR|RSSI|dBm|Hz|MHz|kHz|bps|ACK|NAK|CSV|JSON|URL|URI|UUID|API|WiFi|USB|Bluetooth|SX126x|GPIO|Base64|base64|AES-128|AES-256|SHA-256|NTP|Hops?|MGRS|Firmware|Router|Flood|Advert|ADVERT|FLOOD|DIRECT|LOCAL|TXT_MSG|Sniffer|Repeater|Repeaters|Radio|Client|Imperial|hello|GitHub|LXMF|LXST|RNS|MECP|RMAP|SSID|DHCP|NMEA|NodeInfo|Telemetry|NeighborInfo|DiscoveryFlood|RoomAdvert|Zinc)\b/gi;

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
  'seedAddressesPlaceholder',
  'networkNamePlaceholder',
  'networkIdentityPlaceholder',
  'staticPeersPlaceholder',
  'enterUrlPlaceholder',
  'xmodemFilenamePlaceholder',
  'aclPubkeyPlaceholder',
  'manualHashPlaceholder',
]);

/**
 * Key prefixes whose values are protobuf-derived codes, hardware proper nouns,
 * theme palette names, mesh network presets, or routing-port protocol identifiers.
 * Machine translation turns "ANZ" into sentences, "TAK" into "yes", and "Zinc"
 * into metal nouns, so these stay English everywhere.
 */
export const KEEP_ENGLISH_KEY_PREFIXES = [
  'radioPanel.regions.',
  'radioPanel.modemPresets.',
  'radioPanel.oledTypes.',
  'radioPanel.displayUnits.',
  'radioPanel.spreadFactors.',
  'appPanel.themePreset.',
  'appPanel.themeSurfaces.',
  'connectionPanel.meshcorePreset.',
  'diagnosticsPanel.routingPort.',
];

/**
 * Device-role *labels* are protocol terms and brands (Client, Router, TAK). Translators
 * turn them into false friends ("Oberfräse" for Router, "Tak"/"yes" for TAK), so labels
 * stay English while the accompanying descriptions are still translated.
 */
const KEEP_ENGLISH_KEY_PATTERNS = [
  /^radioPanel\.bandwidthKhz$/,
  /^radioPanel\.deviceRoles\.[A-Z0-9_]+\.label$/,
  // TAK role blurbs are short and brand-dominated; every engine renders the brand
  // as the Turkish/Polish word "tak" or transliterates it away.
  /^radioPanel\.deviceRoles\.TAK(?:_TRACKER)?\.description$/,
];

/** @param {string} key */
export function isKeepEnglishKey(key) {
  return (
    KEEP_ENGLISH_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
    KEEP_ENGLISH_KEY_PATTERNS.some((pattern) => pattern.test(key))
  );
}

/**
 * True for wire samples / filesystem paths / hex blobs that look translated
 * only because letter runs survive stripping (MAC addresses, identity paths).
 * @param {string} enVal
 */
export function looksLikeTechnicalSample(enVal) {
  const t = enVal.trim();
  if (t.length === 0) return false;
  // MAC / colon-hex (split avoids nested-quantifier regex)
  const macParts = t.split(':');
  if (
    macParts.length === 6 &&
    macParts.every((part) => part.length === 2 && /^[0-9A-Fa-f]{2}$/.test(part))
  ) {
    return true;
  }
  // Hex digests / ellipsis-truncated hashes (length checks avoid unbounded quantifiers)
  const hexBody = t.replace(/(?:…|\.\.\.)$/u, '');
  if (/^[0-9A-Fa-f]+$/u.test(hexBody) && hexBody.length >= 8 && t.length <= 128) return true;
  // Path / URI samples with no prose spaces (hash:/…, ~/.reticulum/…, config.txt)
  if (!/\s/.test(t) && (t.startsWith('~/') || t.startsWith('hash:/') || t.includes('/'))) {
    return true;
  }
  if (!/\s/.test(t) && /\.[a-z0-9]{1,5}$/i.test(t)) return true;
  // snake_case network ids used as placeholders
  if (!/\s/.test(t) && t.includes('_') && /^[a-z][a-z0-9_]*$/i.test(t)) return true;
  return false;
}

/**
 * Returns true when an English value contains enough non-technical content to
 * be worth machine-translating. Values that reduce to nothing after stripping
 * placeholders and known loanwords/brands are skipped in --audit mode.
 * @param {string} enVal
 */
export function hasTranslatableContent(enVal) {
  if (looksLikeTechnicalSample(enVal)) return false;
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
    // Keep-English keys are copied verbatim rather than machine-translated, so they
    // are only "missing" when absent from the locale entirely.
    if (isKeepEnglishKey(k)) return !(k in existingFlat);
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

/**
 * Read `--prefix a.b,c.d` (or `--prefix=a.b,c.d`) from argv. Returns null when absent.
 * @param {string[]} argv
 * @returns {string[] | null}
 */
export function parseKeyPrefixes(argv) {
  const idx = argv.findIndex((a) => a === '--prefix' || a.startsWith('--prefix='));
  if (idx === -1) return null;
  const raw = argv[idx].startsWith('--prefix=')
    ? argv[idx].slice('--prefix='.length)
    : argv[idx + 1];
  // Fail closed: a missing operand must not silently widen a scoped run to every key.
  if (raw === undefined || raw.startsWith('-')) {
    throw new Error('--prefix requires a comma-separated list of key prefixes');
  }
  const prefixes = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (prefixes.length === 0) {
    throw new Error('--prefix requires a comma-separated list of key prefixes');
  }
  return prefixes;
}

/**
 * True when `key` equals a prefix or sits beneath it at a dot boundary
 * (`modulePanel` matches `modulePanel.x`, not `modulePanelExtra.x`).
 * @param {string} key
 * @param {string[] | null} prefixes
 */
export function matchesKeyPrefix(key, prefixes) {
  if (prefixes === null) return true;
  return prefixes.some((p) => {
    const base = p.endsWith('.') ? p.slice(0, -1) : p;
    return key === base || key.startsWith(`${base}.`);
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

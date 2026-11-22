/**
 * MeshCom callsign watchlist (base call, ignore SSID) — alert when listed traffic is heard.
 * Inspired by dg9vh/MeshCom-Client Settings → Watchlist.
 */
import { getAppSettingsRaw, mergeAppSetting } from '../appSettingsStorage';
import { CHAT_NOTIF_MUTED_STORAGE_KEY } from '../chatInactiveNotifications';
import { playMessageNotification } from '../chatNotifications';
import { fireNotification } from '../desktopNotification';
import i18n from '../i18n';
import { parseStoredJson } from '../parseStoredJson';
import { normalizeMeshcomCallsign } from './meshcomCallsign';

export const MESHCOM_CALLSIGN_WATCHLIST_KEY = 'meshcomCallsignWatchlist';
export const MESHCOM_CALLSIGN_WATCHLIST_MAX = 50;

/** Base callsign for watch matching: strip SSID (`OE1ABC-9` → `OE1ABC`). */
export function meshcomWatchlistBaseCall(raw: string): string {
  const normalized = normalizeMeshcomCallsign(raw);
  if (!normalized) return '';
  const hyphen = normalized.lastIndexOf('-');
  if (hyphen <= 0) return normalized;
  return normalized.slice(0, hyphen);
}

const EMPTY_WATCHLIST: readonly string[] = Object.freeze([]);
let cachedWatchlist: readonly string[] = EMPTY_WATCHLIST;
let watchlistStorageSynced = false;

function sameWatchlist(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function normalizeWatchlist(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const base = meshcomWatchlistBaseCall(entry);
    if (!base || seen.has(base)) continue;
    seen.add(base);
    out.push(base);
    if (out.length >= MESHCOM_CALLSIGN_WATCHLIST_MAX) break;
  }
  return out;
}

function cacheWatchlist(next: string[]): readonly string[] {
  if (next.length === 0) {
    cachedWatchlist = EMPTY_WATCHLIST;
    return cachedWatchlist;
  }
  if (sameWatchlist(cachedWatchlist, next)) return cachedWatchlist;
  cachedWatchlist = Object.freeze([...next]);
  return cachedWatchlist;
}

function syncWatchlistFromStorage(): void {
  try {
    const settings = parseStoredJson<Record<string, unknown>>(
      getAppSettingsRaw(),
      'meshcom callsign watchlist',
    );
    cacheWatchlist(normalizeWatchlist(settings?.[MESHCOM_CALLSIGN_WATCHLIST_KEY]));
    watchlistStorageSynced = true;
  } catch {
    // catch-no-log-ok blocked storage must not break ingest; leave unsynced so later reads retry
    cacheWatchlist([]);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('mesh-client:appSettings', () => {
    watchlistStorageSynced = false;
  });
}

/** Stable snapshot for `useSyncExternalStore` (same reference when contents unchanged). */
export function getMeshcomCallsignWatchlist(): readonly string[] {
  if (!watchlistStorageSynced) syncWatchlistFromStorage();
  return cachedWatchlist;
}

let revision = 0;
let writes = Promise.resolve();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeMeshcomCallsignWatchlist(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function saveMeshcomCallsignWatchlist(callsigns: readonly string[]): Promise<void> {
  revision++;
  const normalized = normalizeWatchlist([...callsigns]);
  const save = writes.then(async () => {
    await window.electronAPI.appSettings.set(
      MESHCOM_CALLSIGN_WATCHLIST_KEY,
      JSON.stringify(normalized),
    );
    const prev = cachedWatchlist;
    mergeAppSetting(MESHCOM_CALLSIGN_WATCHLIST_KEY, normalized, 'meshcom callsign watchlist save');
    cacheWatchlist(normalized);
    watchlistStorageSynced = true;
    if (!sameWatchlist(prev, cachedWatchlist)) notify();
  });
  writes = save.catch(() => {
    // catch-no-log-ok caller surfaces errors; keep next write usable
  });
  return save;
}

export async function loadMeshcomCallsignWatchlist(): Promise<void> {
  const before = revision;
  const raw = await window.electronAPI.appSettings.getAll();
  if (before !== revision) return;
  const stored = parseStoredJson<unknown>(
    raw[MESHCOM_CALLSIGN_WATCHLIST_KEY],
    'meshcom callsign watchlist hydrate',
  );
  const normalized = normalizeWatchlist(stored);
  const prev = cachedWatchlist;
  cacheWatchlist(normalized);
  watchlistStorageSynced = true;
  mergeAppSetting(MESHCOM_CALLSIGN_WATCHLIST_KEY, normalized, 'meshcom callsign watchlist hydrate');
  if (!sameWatchlist(prev, cachedWatchlist)) notify();
}

export function isMeshcomWatchlistCallsign(callsign: string): boolean {
  const base = meshcomWatchlistBaseCall(callsign);
  if (!base) return false;
  return getMeshcomCallsignWatchlist().includes(base);
}

/** Dedup alert spam for the same base call within a short window. */
const lastAlertAtByBase = new Map<string, number>();
const WATCHLIST_ALERT_COOLDOWN_MS = 30_000;

/**
 * If `callsign` is on the watchlist, play the DM tone and show an OS notification.
 * Returns true when an alert fired.
 */
export function maybeAlertMeshcomWatchlistCallsign(callsign: string): boolean {
  const base = meshcomWatchlistBaseCall(callsign);
  if (!base || !getMeshcomCallsignWatchlist().includes(base)) return false;
  const now = Date.now();
  const last = lastAlertAtByBase.get(base) ?? 0;
  if (now - last < WATCHLIST_ALERT_COOLDOWN_MS) return false;
  lastAlertAtByBase.set(base, now);
  let muted = false;
  try {
    muted = localStorage.getItem(CHAT_NOTIF_MUTED_STORAGE_KEY) === '1';
  } catch {
    // catch-no-log-ok localStorage may be unavailable in tests / restricted contexts
  }
  if (!muted) {
    playMessageNotification('dm');
  }
  fireNotification(
    i18n.t('meshcomWatchlist.alertTitle', { callsign: base }),
    i18n.t('meshcomWatchlist.alertBody', { callsign: normalizeMeshcomCallsign(callsign) || base }),
    { silent: muted },
  );
  return true;
}

/** Test helper. */
export function resetMeshcomCallsignWatchlistAlertsForTests(): void {
  lastAlertAtByBase.clear();
  cachedWatchlist = EMPTY_WATCHLIST;
  watchlistStorageSynced = false;
}

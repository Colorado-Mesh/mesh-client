/**
 * Persist dismissed stale-alternate LXMF banner pairs so dismiss survives DM remounts.
 */

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { parseStoredJson } from '@/renderer/lib/parseStoredJson';
import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';

export const RETICULUM_STALE_ALTERNATE_DISMISS_STORAGE_KEY =
  'mesh-client:reticulumStaleAlternateDismissed';

/** Cap persisted pair keys (newest kept). */
export const RETICULUM_STALE_ALTERNATE_DISMISS_MAX = 200;

const listeners = new Set<() => void>();

/** In-memory cache; reloaded from localStorage on first read / after write. */
let cachedKeys: Set<string> | null = null;

/** Snapshot version for `useSyncExternalStore` — bumps on every persist/notify. */
let snapshotVersion = 0;

function notify(): void {
  snapshotVersion += 1;
  for (const listener of listeners) {
    listener();
  }
}

function loadKeys(): Set<string> {
  if (cachedKeys) return cachedKeys;
  const raw = localStorage.getItem(RETICULUM_STALE_ALTERNATE_DISMISS_STORAGE_KEY);
  const parsed = parseStoredJson<unknown>(raw, 'reticulumStaleAlternateDismiss');
  const next = new Set<string>();
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (typeof entry !== 'string') continue;
      if (!/^[0-9a-f]{32}:[0-9a-f]{32}$/.test(entry)) continue;
      next.add(entry);
    }
  }
  cachedKeys = next;
  return next;
}

function persistKeys(keys: Set<string>): void {
  let ordered = [...keys];
  if (ordered.length > RETICULUM_STALE_ALTERNATE_DISMISS_MAX) {
    ordered = ordered.slice(ordered.length - RETICULUM_STALE_ALTERNATE_DISMISS_MAX);
  }
  cachedKeys = new Set(ordered);
  try {
    localStorage.setItem(RETICULUM_STALE_ALTERNATE_DISMISS_STORAGE_KEY, JSON.stringify(ordered));
  } catch (e) {
    console.warn('[reticulumStaleAlternateDismiss] persist failed ' + errLikeToLogString(e));
  }
  notify();
}

/**
 * Canonical `openHash:alternateHash` key, or null when either hash is invalid.
 */
export function staleAlternateDismissKey(openHash: string, alternateHash: string): string | null {
  const open = canonicalizeReticulumDestinationHash(openHash);
  const alt = canonicalizeReticulumDestinationHash(alternateHash);
  if (!open || !alt) return null;
  return `${open}:${alt}`;
}

export function isReticulumStaleAlternateDismissed(
  openHash: string,
  alternateHash: string,
): boolean {
  const key = staleAlternateDismissKey(openHash, alternateHash);
  if (!key) return false;
  return loadKeys().has(key);
}

export function dismissReticulumStaleAlternate(openHash: string, alternateHash: string): boolean {
  const key = staleAlternateDismissKey(openHash, alternateHash);
  if (!key) return false;
  const keys = loadKeys();
  if (keys.has(key)) {
    notify();
    return true;
  }
  const next = new Set(keys);
  next.add(key);
  persistKeys(next);
  return true;
}

/** Subscribe to dismiss-set changes (for `useSyncExternalStore`). */
export function subscribeReticulumStaleAlternateDismiss(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Snapshot for `useSyncExternalStore` — version bumps on every persist/notify. */
export function getReticulumStaleAlternateDismissVersion(): number {
  loadKeys();
  return snapshotVersion;
}

/** @internal test helper — clear cache + storage. */
export function resetReticulumStaleAlternateDismissForTests(): void {
  cachedKeys = null;
  snapshotVersion = 0;
  try {
    localStorage.removeItem(RETICULUM_STALE_ALTERNATE_DISMISS_STORAGE_KEY);
  } catch {
    // catch-no-log-ok test cleanup
  }
  notify();
}

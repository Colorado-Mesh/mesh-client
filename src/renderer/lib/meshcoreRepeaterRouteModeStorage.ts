import { useSyncExternalStore } from 'react';

import { logCaughtDebug } from './caughtErrorPolicy';
import type { MeshcoreRepeaterRouteMode } from './meshcoreRepeaterRouteEscalation';

/**
 * Per-repeater route mode (issue 1566), keyed by the repeater's 64-hex public key so the choice
 * follows the repeater across radios. Only non-Auto choices are stored. A low-stakes preference:
 * losing it falls back to Auto, today's behaviour, so localStorage is the whole record.
 */
export const MESHCORE_REPEATER_ROUTE_MODES_KEY = 'mesh-client:meshcoreRepeaterRouteModes:v1';

type StoredModes = Readonly<Record<string, Exclude<MeshcoreRepeaterRouteMode, 'auto'>>>;

const PUBKEY_HEX_RE = /^[0-9a-f]{64}$/;
const EMPTY: StoredModes = Object.freeze({});

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedModes: StoredModes = EMPTY;

/** Storage key for a public key: lowercase 64-hex, or null when it is not a full key. */
export function meshcoreRepeaterRouteModeKey(pubKeyHex: string | null | undefined): string | null {
  const key = (pubKeyHex ?? '').trim().toLowerCase();
  return PUBKEY_HEX_RE.test(key) ? key : null;
}

const normalizeKey = meshcoreRepeaterRouteModeKey;

function parseModes(raw: string | null): StoredModes {
  if (!raw) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    logCaughtDebug('[meshcoreRepeaterRouteModeStorage] parse', e);
    return EMPTY;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY;
  const modes: Record<string, Exclude<MeshcoreRepeaterRouteMode, 'auto'>> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const normalized = normalizeKey(key);
    if (normalized && (value === 'direct' || value === 'zeroHop')) modes[normalized] = value;
  }
  return modes;
}

function readModes(): StoredModes {
  let raw: string | null;
  try {
    raw = localStorage.getItem(MESHCORE_REPEATER_ROUTE_MODES_KEY);
  } catch (e: unknown) {
    // Storage denied (SecurityError): every repeater stays on Auto.
    logCaughtDebug('[meshcoreRepeaterRouteModeStorage] read', e);
    return EMPTY;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedModes = parseModes(raw);
  }
  return cachedModes;
}

export function getMeshcoreRepeaterRouteMode(pubKeyHex: string): MeshcoreRepeaterRouteMode {
  const key = normalizeKey(pubKeyHex);
  if (!key) return 'auto';
  return readModes()[key] ?? 'auto';
}

export function setMeshcoreRepeaterRouteMode(
  pubKeyHex: string,
  mode: MeshcoreRepeaterRouteMode,
): void {
  const key = normalizeKey(pubKeyHex);
  if (!key) return;
  const next = Object.fromEntries(
    Object.entries(readModes()).filter(([existing]) => existing !== key),
  );
  if (mode !== 'auto') next[key] = mode;
  try {
    localStorage.setItem(MESHCORE_REPEATER_ROUTE_MODES_KEY, JSON.stringify(next));
  } catch (e: unknown) {
    // Quota full or storage denied: the previous choice stays in effect.
    logCaughtDebug('[meshcoreRepeaterRouteModeStorage] write', e);
    return;
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === MESHCORE_REPEATER_ROUTE_MODES_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Saved non-Auto modes by lowercase public key hex; re-renders when any choice changes. */
export function useMeshcoreRepeaterRouteModes(): StoredModes {
  return useSyncExternalStore(subscribe, readModes, () => EMPTY);
}

/**
 * Helpers for the SQLite-backed message retention setting.
 *
 * Two independent caps (one per protocol) live in the `app_settings` KV table:
 *   - meshtasticMessageRetentionEnabled / meshtasticMessageRetentionCount
 *   - meshcoreMessageRetentionEnabled  / meshcoreMessageRetentionCount
 *
 * Defaults: enabled with a cap of 4000 messages per table. Pruning is invoked
 * from the renderer at app startup (see `App.tsx`) and applies the cap by
 * keeping the newest N rows by `timestamp`.
 *
 * Failure mode: if IPC throws (DB locked / preload unavailable), callers fall
 * back to defaults so the UI stays responsive; the next startup will retry.
 */

export const MESSAGE_RETENTION_DEFAULT_COUNT = 4000;
export const MESSAGE_RETENTION_MIN_COUNT = 100;
export const MESSAGE_RETENTION_MAX_COUNT = 100_000;

export interface MessageRetentionSettings {
  meshtasticEnabled: boolean;
  meshtasticCount: number;
  meshcoreEnabled: boolean;
  meshcoreCount: number;
}

export const DEFAULT_MESSAGE_RETENTION: MessageRetentionSettings = {
  meshtasticEnabled: true,
  meshtasticCount: MESSAGE_RETENTION_DEFAULT_COUNT,
  meshcoreEnabled: true,
  meshcoreCount: MESSAGE_RETENTION_DEFAULT_COUNT,
};

export const MESSAGE_RETENTION_KEYS = {
  meshtasticEnabled: 'meshtasticMessageRetentionEnabled',
  meshtasticCount: 'meshtasticMessageRetentionCount',
  meshcoreEnabled: 'meshcoreMessageRetentionEnabled',
  meshcoreCount: 'meshcoreMessageRetentionCount',
} as const;

function parseBool(v: string | undefined, fallback: boolean): boolean {
  if (v === '1') return true;
  if (v === '0') return false;
  return fallback;
}

function parseCount(v: string | undefined, fallback: number): number {
  if (typeof v !== 'string') return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(MESSAGE_RETENTION_MIN_COUNT, Math.min(MESSAGE_RETENTION_MAX_COUNT, n));
}

export function parseMessageRetention(
  raw: Record<string, string> | null | undefined,
): MessageRetentionSettings {
  const r = raw ?? {};
  return {
    meshtasticEnabled: parseBool(
      r[MESSAGE_RETENTION_KEYS.meshtasticEnabled],
      DEFAULT_MESSAGE_RETENTION.meshtasticEnabled,
    ),
    meshtasticCount: parseCount(
      r[MESSAGE_RETENTION_KEYS.meshtasticCount],
      DEFAULT_MESSAGE_RETENTION.meshtasticCount,
    ),
    meshcoreEnabled: parseBool(
      r[MESSAGE_RETENTION_KEYS.meshcoreEnabled],
      DEFAULT_MESSAGE_RETENTION.meshcoreEnabled,
    ),
    meshcoreCount: parseCount(
      r[MESSAGE_RETENTION_KEYS.meshcoreCount],
      DEFAULT_MESSAGE_RETENTION.meshcoreCount,
    ),
  };
}

/**
 * Read all four retention values from the DB. Returns defaults on any error so
 * UI hydration and startup pruning never block on a failed IPC.
 */
export async function fetchMessageRetention(): Promise<MessageRetentionSettings> {
  try {
    const raw = await window.electronAPI.appSettings.getAll();
    return parseMessageRetention(raw);
  } catch (e) {
    console.warn('[messageRetention] fetchMessageRetention failed; using defaults', e);
    return { ...DEFAULT_MESSAGE_RETENTION };
  }
}

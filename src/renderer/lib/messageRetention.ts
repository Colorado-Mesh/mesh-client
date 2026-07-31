import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
/**
 * Helpers for the SQLite-backed message retention setting.
 *
 * Independent caps per protocol live in the `app_settings` KV table:
 *   - meshtasticMessageRetentionEnabled / meshtasticMessageRetentionCount
 *   - meshcoreMessageRetentionEnabled  / meshcoreMessageRetentionCount
 *   - reticulumMessageRetentionEnabled / reticulumMessageRetentionCount
 *   - rrcMessageRetentionEnabled / rrcMessageRetentionCount
 *
 * Defaults: enabled with a cap of 4000 messages per LoRa/LXMF table (RRC default
 * 10000). Pruning is invoked from the renderer at app startup (see `App.tsx`)
 * and applies the cap by keeping the newest N rows by `timestamp`.
 *
 * Failure mode: if IPC throws (DB locked / preload unavailable), callers fall
 * back to defaults so the UI stays responsive; the next startup will retry.
 */

export const MESSAGE_RETENTION_DEFAULT_COUNT = 4000;
export const RRC_MESSAGE_RETENTION_DEFAULT_COUNT = 10_000;
/** Age prune for RRC history when retention is enabled (startup). */
export const RRC_MESSAGE_RETENTION_DEFAULT_AGE_DAYS = 30;
export const MESSAGE_RETENTION_MIN_COUNT = 100;
export const MESSAGE_RETENTION_MAX_COUNT = 100_000;

export interface MessageRetentionSettings {
  meshtasticEnabled: boolean;
  meshtasticCount: number;
  meshcoreEnabled: boolean;
  meshcoreCount: number;
  reticulumEnabled: boolean;
  reticulumCount: number;
  rrcEnabled: boolean;
  rrcCount: number;
}

export const DEFAULT_MESSAGE_RETENTION: MessageRetentionSettings = {
  meshtasticEnabled: true,
  meshtasticCount: MESSAGE_RETENTION_DEFAULT_COUNT,
  meshcoreEnabled: true,
  meshcoreCount: MESSAGE_RETENTION_DEFAULT_COUNT,
  reticulumEnabled: true,
  reticulumCount: MESSAGE_RETENTION_DEFAULT_COUNT,
  rrcEnabled: true,
  rrcCount: RRC_MESSAGE_RETENTION_DEFAULT_COUNT,
};

export const MESSAGE_RETENTION_KEYS = {
  meshtasticEnabled: 'meshtasticMessageRetentionEnabled',
  meshtasticCount: 'meshtasticMessageRetentionCount',
  meshcoreEnabled: 'meshcoreMessageRetentionEnabled',
  meshcoreCount: 'meshcoreMessageRetentionCount',
  reticulumEnabled: 'reticulumMessageRetentionEnabled',
  reticulumCount: 'reticulumMessageRetentionCount',
  rrcEnabled: 'rrcMessageRetentionEnabled',
  rrcCount: 'rrcMessageRetentionCount',
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

const MESSAGE_RETENTION_PROTOCOLS = ['meshtastic', 'meshcore', 'reticulum', 'rrc'] as const;

export function parseMessageRetention(
  raw: Record<string, string> | null | undefined,
): MessageRetentionSettings {
  const r = raw ?? {};
  const settings = { ...DEFAULT_MESSAGE_RETENTION };
  for (const protocol of MESSAGE_RETENTION_PROTOCOLS) {
    const enabledKey = `${protocol}Enabled` as const;
    const countKey = `${protocol}Count` as const;
    settings[enabledKey] = parseBool(
      r[MESSAGE_RETENTION_KEYS[enabledKey]],
      DEFAULT_MESSAGE_RETENTION[enabledKey],
    );
    settings[countKey] = parseCount(
      r[MESSAGE_RETENTION_KEYS[countKey]],
      DEFAULT_MESSAGE_RETENTION[countKey],
    );
  }
  return settings;
}

/**
 * Read all retention values from the DB. Returns defaults on any error so
 * UI hydration and startup pruning never block on a failed IPC.
 */
export async function fetchMessageRetention(): Promise<MessageRetentionSettings> {
  try {
    const raw = await window.electronAPI.appSettings.getAll();
    return parseMessageRetention(raw);
  } catch (e) {
    console.warn(
      '[messageRetention] fetchMessageRetention failed; using defaults ' + errLikeToLogString(e),
    );
    return { ...DEFAULT_MESSAGE_RETENTION };
  }
}

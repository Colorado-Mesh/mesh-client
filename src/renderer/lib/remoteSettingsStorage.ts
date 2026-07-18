/**
 * Local settings for the Reticulum Remote tab (rnsh shell + rncp transfer).
 * Persisted to `localStorage` — mirrors other Reticulum UI-only prefs (`rrcHubPrefs.ts`)
 * rather than SQLite, since these are soft client-side defaults, not shared state.
 */
import type { RncpInboundMode } from '@/shared/remote-types';

const STORAGE_KEY = 'mesh-client:reticulumRemoteSettings';

export interface RemoteSettings {
  autoReconnectShell: boolean;
  maxReconnectAttempts: number;
  autoRetryTransfer: boolean;
  maxRetryAttempts: number;
  inboundMode: RncpInboundMode;
}

export const DEFAULT_REMOTE_SETTINGS: RemoteSettings = {
  autoReconnectShell: true,
  maxReconnectAttempts: 5,
  autoRetryTransfer: true,
  maxRetryAttempts: 3,
  // Secure default: no inbound rnsh/rncp until the user opts in.
  inboundMode: 'off',
};

function sanitize(raw: unknown): RemoteSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_REMOTE_SETTINGS };
  const r = raw as Record<string, unknown>;
  const inboundMode: RncpInboundMode =
    r.inboundMode === 'ask' || r.inboundMode === 'allow_all_listed' || r.inboundMode === 'off'
      ? r.inboundMode
      : DEFAULT_REMOTE_SETTINGS.inboundMode;
  return {
    autoReconnectShell:
      typeof r.autoReconnectShell === 'boolean'
        ? r.autoReconnectShell
        : DEFAULT_REMOTE_SETTINGS.autoReconnectShell,
    maxReconnectAttempts:
      typeof r.maxReconnectAttempts === 'number' && Number.isFinite(r.maxReconnectAttempts)
        ? Math.max(0, Math.min(20, Math.trunc(r.maxReconnectAttempts)))
        : DEFAULT_REMOTE_SETTINGS.maxReconnectAttempts,
    autoRetryTransfer:
      typeof r.autoRetryTransfer === 'boolean'
        ? r.autoRetryTransfer
        : DEFAULT_REMOTE_SETTINGS.autoRetryTransfer,
    maxRetryAttempts:
      typeof r.maxRetryAttempts === 'number' && Number.isFinite(r.maxRetryAttempts)
        ? Math.max(0, Math.min(10, Math.trunc(r.maxRetryAttempts)))
        : DEFAULT_REMOTE_SETTINGS.maxRetryAttempts,
    inboundMode,
  };
}

export function loadRemoteSettings(): RemoteSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_REMOTE_SETTINGS };
    return sanitize(JSON.parse(raw));
  } catch {
    // catch-no-log-ok localStorage may be unavailable or contain malformed JSON
    return { ...DEFAULT_REMOTE_SETTINGS };
  }
}

export function saveRemoteSettings(settings: RemoteSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitize(settings)));
  } catch {
    // catch-no-log-ok localStorage may be unavailable
  }
}

export function updateRemoteSettings(patch: Partial<RemoteSettings>): RemoteSettings {
  const next = sanitize({ ...loadRemoteSettings(), ...patch });
  saveRemoteSettings(next);
  return next;
}

import { canonicalizeReticulumDestinationHash } from '@/shared/reticulumDestinationHash';

import { getAppSettingsRaw, mergeAppSetting } from './appSettingsStorage';
import { parseStoredJson } from './parseStoredJson';
import { reticulumHashToNodeId } from './reticulum/destHash';

const SETTING_KEY = 'reticulumLastSelfLxmfHash';
/** Fast path before app_settings JSON is hydrated from SQLite. */
export const RETICULUM_LAST_SELF_LXMF_HASH_LS_KEY = 'mesh-client:reticulumLastSelfLxmfHash';

function readPersistedHashCandidate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  return canonicalizeReticulumDestinationHash(raw);
}

/** Last known Reticulum LXMF destination hash from a successful identity sync. */
export function loadPersistedReticulumSelfLxmfHash(): string | null {
  try {
    const direct = localStorage.getItem(RETICULUM_LAST_SELF_LXMF_HASH_LS_KEY);
    const fromLs = readPersistedHashCandidate(direct);
    if (fromLs) return fromLs;
  } catch {
    // catch-no-log-ok localStorage unavailable
  }
  const settings = parseStoredJson<Record<string, unknown>>(
    getAppSettingsRaw(),
    'reticulumLastSelfLxmfHash read',
  );
  return readPersistedHashCandidate(settings?.[SETTING_KEY]);
}

/** Folded uint32 self node id from the persisted LXMF hash (0 when unset/invalid). */
export function loadPersistedReticulumSelfNodeId(): number {
  const hash = loadPersistedReticulumSelfLxmfHash();
  if (!hash) return 0;
  return reticulumHashToNodeId(hash);
}

export function persistReticulumSelfLxmfHash(lxmfHash: string): void {
  const canonical = canonicalizeReticulumDestinationHash(lxmfHash);
  if (!canonical) return;
  try {
    localStorage.setItem(RETICULUM_LAST_SELF_LXMF_HASH_LS_KEY, canonical);
  } catch {
    // catch-no-log-ok localStorage unavailable
  }
  mergeAppSetting(SETTING_KEY, canonical, 'reticulumLastSelfLxmfHash persist');
  void window.electronAPI.appSettings.set(SETTING_KEY, canonical).catch(() => {
    // catch-no-log-ok best-effort mirror to SQLite; localStorage already updated
  });
}

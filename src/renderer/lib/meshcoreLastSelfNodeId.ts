import { getAppSettingsRaw, mergeAppSetting } from './appSettingsStorage';
import { parseStoredJson } from './parseStoredJson';

const SETTING_KEY = 'meshcoreLastSelfNodeId';
/** Fast path for unread filtering before app_settings JSON is hydrated from SQLite. */
export const MESHCORE_LAST_SELF_NODE_LS_KEY = 'mesh-client:meshcoreLastSelfNodeId';

/** Last known MeshCore node id from a successful radio session (for unread filtering before reconnect). */
export function loadPersistedMeshcoreSelfNodeId(): number {
  try {
    const direct = localStorage.getItem(MESHCORE_LAST_SELF_NODE_LS_KEY);
    if (direct?.trim()) {
      const n = Number.parseInt(direct, 10);
      if (Number.isFinite(n) && n > 0) return n >>> 0;
    }
  } catch {
    // catch-no-log-ok localStorage unavailable
  }
  const settings = parseStoredJson<Record<string, unknown>>(
    getAppSettingsRaw(),
    'meshcoreLastSelfNodeId read',
  );
  const raw = settings?.[SETTING_KEY];
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw >>> 0;
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n >>> 0;
  }
  return 0;
}

export function persistMeshcoreSelfNodeId(nodeId: number): void {
  if (!Number.isFinite(nodeId) || nodeId <= 0) return;
  const idStr = String(nodeId >>> 0);
  try {
    localStorage.setItem(MESHCORE_LAST_SELF_NODE_LS_KEY, idStr);
  } catch {
    // catch-no-log-ok localStorage unavailable
  }
  mergeAppSetting(SETTING_KEY, idStr, 'meshcoreLastSelfNodeId persist');
  void window.electronAPI.appSettings.set(SETTING_KEY, idStr).catch(() => {
    // catch-no-log-ok best-effort mirror to SQLite; localStorage already updated
  });
}

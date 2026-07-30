/**
 * Shared rncp listener apply / reconcile helpers.
 *
 * Main's picker allowlist is process-memory only: a persisted `lastSaveDir` from
 * localStorage is rejected after restart until the user re-picks (or we fail closed).
 */
import {
  loadRemoteSettings,
  type RemoteSettings,
  updateRemoteSettings,
} from '@/renderer/lib/remoteSettingsStorage';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';
import type { RncpInboundMode, RncpListenerStatus } from '@/shared/remote-types';

/** IPC / validateRncpListenerDirs rejection when save_dir was not from this session's picker. */
export const RNCP_SAVE_DIR_NOT_FROM_PICKER = 'save_dir_not_from_picker';

/** IPC rejection when fetch_jail was not from this session's picker. */
export const RNCP_FETCH_JAIL_NOT_FROM_PICKER = 'fetch_jail_not_from_picker';

export function isRncpPickerAllowlistError(error: string | null | undefined): boolean {
  return error === RNCP_SAVE_DIR_NOT_FROM_PICKER || error === RNCP_FETCH_JAIL_NOT_FROM_PICKER;
}

/** Map sidecar listener status to the Remote settings inbound mode. */
export function inboundModeFromListenerStatus(status: RncpListenerStatus): RncpInboundMode {
  if (!status.enabled) return 'off';
  if (status.inbound_mode === 'allow_all_listed') return 'allow_all_listed';
  if (status.inbound_mode === 'ask') return 'ask';
  return 'off';
}

/**
 * Pull live listener status from the sidecar and align localStorage + Zustand so
 * the UI cannot claim Ask/enabled when the listener is actually off (e.g. after a
 * failed setListener with a stale persisted save dir).
 *
 * Does not clear `lastSaveDir` when the sidecar is enabled with a restore fallback
 * path (rncp_inbox) — the path string may differ from UI storage; status.enabled is
 * the source of truth for inbound mode.
 */
export async function reconcileRncpListenerFromSidecar(): Promise<{
  settings: RemoteSettings;
  status: RncpListenerStatus;
}> {
  const status = await window.electronAPI.reticulum.rncp.getListener();
  useRncpTransferStore.getState().setListener(status);
  const mode = inboundModeFromListenerStatus(status);
  const current = loadRemoteSettings();
  if (current.inboundMode === mode) {
    return { settings: current, status };
  }
  const settings = updateRemoteSettings({ inboundMode: mode });
  return { settings, status };
}

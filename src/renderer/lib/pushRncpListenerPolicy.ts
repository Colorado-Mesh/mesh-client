import {
  loadRemoteSettings,
  type RemoteSettings,
  updateRemoteSettings,
} from '@/renderer/lib/remoteSettingsStorage';
import { policiesToRncpLists } from '@/renderer/lib/rncpInboundPolicyLists';
import { useReticulumInboundPolicyStore } from '@/renderer/stores/reticulumInboundPolicyStore';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';
import type { RncpListenerRequest } from '@/shared/remote-types';

/**
 * Rebuild sidecar allow/block lists from SQLite policy and re-apply the listener
 * when inbound receive is enabled and a picker-backed save dir is known.
 * Failure point: setListener IPC / sidecar — logged by caller or here at warn.
 */
export async function pushRncpListenerPolicy(
  settings: RemoteSettings = loadRemoteSettings(),
): Promise<{ ok: boolean; error?: string }> {
  if (settings.inboundMode === 'off' || !settings.lastSaveDir) {
    return { ok: true };
  }
  if (settings.allowFetch && !settings.lastFetchJail) {
    return { ok: false, error: 'fetch_jail_required' };
  }
  const { allowed, blocked } = policiesToRncpLists(
    useReticulumInboundPolicyStore.getState().policies,
  );
  const body: RncpListenerRequest = {
    enabled: true,
    save_dir: settings.lastSaveDir,
    allow_fetch: settings.allowFetch,
    fetch_jail: settings.lastFetchJail ?? undefined,
    overwrite: settings.overwriteOnReceive,
    allowed,
    blocked,
  };
  try {
    const res = await window.electronAPI.reticulum.rncp.setListener(body);
    if (res && typeof res === 'object' && 'ok' in res && !res.ok) {
      const err =
        'error' in res && typeof res.error === 'string' ? res.error : 'setListener_failed';
      return { ok: false, error: err };
    }
    const status = await window.electronAPI.reticulum.rncp.getListener();
    useRncpTransferStore.getState().setListener(status);
    return { ok: true };
  } catch (e) {
    console.warn(
      '[pushRncpListenerPolicy] setListener failed: ' +
        (e instanceof Error ? e.message : String(e)),
    );
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function rememberRncpListenerDirs(patch: {
  lastSaveDir?: string | null;
  lastFetchJail?: string | null;
  allowFetch?: boolean;
  overwriteOnReceive?: boolean;
  inboundMode?: RemoteSettings['inboundMode'];
}): RemoteSettings {
  return updateRemoteSettings(patch);
}

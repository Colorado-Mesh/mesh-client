import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
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
 *
 * Failure point: setListener IPC / sidecar — returns `save_dir_not_from_picker`
 * (or `fetch_jail_not_from_picker`) when the persisted path is not allowlisted
 * this session; callers should toast and ask the user to re-choose the folder.
 * Does not open a picker itself (Transfer / policy paths have no dialog context).
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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
    if (res && typeof res === 'object' && 'ok' in res && !res.ok) {
      const err =
        'error' in res && typeof res.error === 'string' ? res.error : 'setListener_failed';
      // Sync store from live status so optimistic Ask cannot stick after reject.
      try {
        const status = await window.electronAPI.reticulum.rncp.getListener();
        useRncpTransferStore.getState().setListener(status);
      } catch (e) {
        console.debug(
          '[pushRncpListenerPolicy] getListener after failure ' + errLikeToLogString(e),
        );
      }
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

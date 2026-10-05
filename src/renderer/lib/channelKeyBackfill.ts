/**
 * Stamp unkeyed SQLite chat history with the connected radio's channel identity keys.
 *
 * Failure point: the `db:backfillChannelKeys` IPC; on failure the rows stay unkeyed (they keep
 * the legacy slot-index display) and the next channel-list change retries.
 */
import type { ChannelIdentityProtocol } from '../../shared/channelIdentityKey';
import type { LiveChannelKeys } from '../stores/liveChannelKeyStore';
import { errLikeToLogString } from './errLikeToLogString';

/**
 * Rows saved before radio scoping have no radio id. The first radio to connect after upgrade
 * claims them once (best effort: they were most likely recorded on that radio); later radios
 * never re-claim them.
 */
export function channelKeyLegacyClaimStorageKey(protocol: ChannelIdentityProtocol): string {
  return `mesh-client:channelKeyLegacyClaimed:${protocol}`;
}

function hasLegacyClaimRun(protocol: ChannelIdentityProtocol): boolean {
  try {
    return localStorage.getItem(channelKeyLegacyClaimStorageKey(protocol)) === '1';
  } catch (e) {
    console.debug('[channelKeyBackfill] localStorage read failed ' + errLikeToLogString(e));
    return true;
  }
}

function markLegacyClaimRun(protocol: ChannelIdentityProtocol): void {
  try {
    localStorage.setItem(channelKeyLegacyClaimStorageKey(protocol), '1');
  } catch (e) {
    console.debug('[channelKeyBackfill] localStorage write failed ' + errLikeToLogString(e));
  }
}

/** Returns the number of rows stamped (0 when there is nothing to do or the IPC failed). */
export async function backfillChannelKeysForLiveRadio(
  protocol: ChannelIdentityProtocol,
  live: LiveChannelKeys,
): Promise<number> {
  const radioNodeId = live.radioNodeId;
  if (radioNodeId == null || radioNodeId <= 0) return 0;
  const entries = Object.entries(live.keyByIndex).map(([index, key]) => ({
    index: Number(index),
    key,
  }));
  if (entries.length === 0) return 0;
  const claimUnscoped = !hasLegacyClaimRun(protocol);
  try {
    const result = await window.electronAPI.db.backfillChannelKeys(
      protocol,
      radioNodeId,
      entries,
      claimUnscoped,
    );
    if (claimUnscoped) markLegacyClaimRun(protocol);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- IPC returns undefined when the DB is unavailable.
    return result?.changes ?? 0;
  } catch (e) {
    console.warn(`[channelKeyBackfill] ${protocol} backfill failed ` + errLikeToLogString(e));
    return 0;
  }
}

/**
 * Stamp unkeyed SQLite chat history with the connected radio's channel identity keys.
 *
 * Failure point: the `db:backfillChannelKeys` IPC; on failure the rows stay unkeyed (only shown
 * while their own radio is connected) and the next channel-list change retries.
 */
import type { ChannelIdentityProtocol } from '../../shared/channelIdentityKey';
import type { LiveChannelKeys } from '../stores/liveChannelKeyStore';
import { errLikeToLogString } from './errLikeToLogString';

/** Returns the number of rows changed (0 when there is nothing to do or the IPC failed). */
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
  try {
    const result = await window.electronAPI.db.backfillChannelKeys(protocol, radioNodeId, entries);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- IPC returns undefined when the DB is unavailable.
    return result?.changes ?? 0;
  } catch (e) {
    console.warn(`[channelKeyBackfill] ${protocol} backfill failed ` + errLikeToLogString(e));
    return 0;
  }
}

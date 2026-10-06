/**
 * SQLite helpers for channel identity keys (`src/shared/channelIdentityKey.ts`): stamping this
 * radio's unkeyed group-channel rows, and key-aware channel clears.
 *
 * Null-radio history stays unkeyed. Assigning it to the first tracked radio misfiles rows when
 * two radios were used or after a radio swap, and a later keyed clear would delete them.
 *
 * Failure point: each helper runs inside one transaction; a thrown statement rolls back the batch
 * and the caller's IPC handler logs it via finishDbIpcHandler.
 */
import { type ChannelIdentityProtocol, isChannelIdentityKey } from '../shared/channelIdentityKey';
import type { NodeSqliteDB } from './db-compat';
import { MESHCORE_MESSAGE_CHANNEL_SQL } from './meshcoreMessageChannel';

export interface ChannelKeyBackfillEntry {
  index: number;
  key: string;
}

/** Group-channel rows only (DMs and room posts never carry a channel key). */
const MESHTASTIC_BROADCAST_SQL = '(to_node IS NULL OR to_node = 0 OR to_node = 4294967295)';

function tableSql(protocol: ChannelIdentityProtocol): { table: string; channelSql: string } {
  return protocol === 'meshcore'
    ? { table: 'meshcore_messages', channelSql: MESHCORE_MESSAGE_CHANNEL_SQL }
    : {
        table: 'messages',
        channelSql: `CASE WHEN ${MESHTASTIC_BROADCAST_SQL} THEN channel ELSE -1 END`,
      };
}

/**
 * Stamp unkeyed group-channel rows whose `radio_node_id` is already `radioNodeId` with the key
 * now in that slot. Rows from other radios, and rows with no radio, stay unkeyed.
 */
export function backfillChannelKeys(
  db: NodeSqliteDB,
  protocol: ChannelIdentityProtocol,
  radioNodeId: number,
  entries: readonly ChannelKeyBackfillEntry[],
): { changes: number } {
  const { table, channelSql } = tableSql(protocol);
  const scoped = db.prepareOnce(
    `UPDATE ${table} SET channel_key = ? ` +
      `WHERE channel_key IS NULL AND radio_node_id = ? AND ${channelSql} = ?`,
  );
  let changes = 0;
  db.transaction(() => {
    for (const { index, key } of entries) {
      changes += Number(scoped.run(key, radioNodeId, index).changes);
    }
  })();
  return { changes };
}

/**
 * Meshtastic per-channel clear. DMs are stored with a channel index, so a missing key deletes
 * nothing rather than every row in that slot.
 */
export function clearMeshtasticMessagesByChannel(
  db: NodeSqliteDB,
  channelIndex: number,
  radioNodeId: number,
  channelKey: unknown,
): { changes: number } {
  if (!isChannelIdentityKey(channelKey)) return { changes: 0 };
  return clearChannelMessagesByKey(db, 'meshtastic', channelIndex, radioNodeId, channelKey);
}

/**
 * Delete a channel's history: every row carrying `channelKey`, plus unkeyed rows in `channelIndex`
 * that belong to this radio (or to no radio). Rows keyed to a different channel are kept.
 */
export function clearChannelMessagesByKey(
  db: NodeSqliteDB,
  protocol: ChannelIdentityProtocol,
  channelIndex: number,
  radioNodeId: number,
  channelKey: string,
): { changes: number } {
  const { table, channelSql } = tableSql(protocol);
  const result = db
    .prepareOnce(
      `DELETE FROM ${table} WHERE channel_key = ? OR (channel_key IS NULL AND ${channelSql} = ? ` +
        'AND (radio_node_id IS NULL OR radio_node_id = ?))',
    )
    .run(channelKey, channelIndex, radioNodeId > 0 ? radioNodeId : -1);
  return { changes: Number(result.changes) };
}

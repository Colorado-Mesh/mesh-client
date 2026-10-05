/**
 * SQLite helpers for channel identity keys (`src/shared/channelIdentityKey.ts`): stamping legacy
 * unkeyed rows with the connected radio's slot mapping, and key-aware channel clears.
 *
 * Failure point: each helper runs inside one transaction; a thrown statement rolls back the batch
 * and the caller's IPC handler logs it via finishDbIpcHandler.
 */
import type { ChannelIdentityProtocol } from '../shared/channelIdentityKey';
import type { NodeSqliteDB } from './db-compat';
import { MESHCORE_MESSAGE_CHANNEL_SQL } from './meshcoreMessageChannel';

export interface ChannelKeyBackfillEntry {
  index: number;
  key: string;
}

export interface ChannelKeyBackfillOptions {
  /** Also claim rows with no radio (pre-`radio_node_id` history) for this radio. */
  claimUnscoped: boolean;
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
 * Stamp unkeyed group-channel rows recorded by `radioNodeId` with the key now in that slot.
 * With `claimUnscoped`, rows that have no radio at all are attributed to this radio too.
 */
export function backfillChannelKeys(
  db: NodeSqliteDB,
  protocol: ChannelIdentityProtocol,
  radioNodeId: number,
  entries: readonly ChannelKeyBackfillEntry[],
  opts: ChannelKeyBackfillOptions,
): { changes: number } {
  const { table, channelSql } = tableSql(protocol);
  const scoped = db.prepareOnce(
    `UPDATE ${table} SET channel_key = ? ` +
      `WHERE channel_key IS NULL AND radio_node_id = ? AND ${channelSql} = ?`,
  );
  const unscoped = db.prepareOnce(
    `UPDATE ${table} SET channel_key = ?, radio_node_id = ? ` +
      `WHERE channel_key IS NULL AND radio_node_id IS NULL AND ${channelSql} = ?`,
  );
  let changes = 0;
  db.transaction(() => {
    for (const { index, key } of entries) {
      changes += Number(scoped.run(key, radioNodeId, index).changes);
      if (opts.claimUnscoped) {
        changes += Number(unscoped.run(key, radioNodeId, index).changes);
      }
    }
  })();
  return { changes };
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

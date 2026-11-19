import {
  MESHCORE_DB_MESSAGE_LOAD_LIMIT,
  MESHCORE_DB_PER_CHANNEL_MESSAGE_LOAD_LIMIT,
  MESHCORE_DB_ROOM_MESSAGE_LOAD_LIMIT,
} from '../shared/meshcoreMessageHydration';
import type { NodeSqliteDB } from './db-compat';
import { MESHCORE_MESSAGE_CHANNEL_SQL } from './meshcoreMessageChannel';

export interface MeshcoreHydrationLoadLimits {
  globalLimit?: number;
  perChannelLimit?: number;
  roomLimit?: number;
}

/**
 * Fair MeshCore chat hydration: newest `globalLimit` rows by receipt time, plus the newest
 * `perChannelLimit` (or `roomLimit` for logical channel -2) per logical channel so quiet
 * group slots are not crowded out by Public traffic.
 *
 * Returns oldest-first within the selected set (same order as `db:getMeshcoreMessages`).
 */
export function selectMeshcoreMessagesForHydration(
  db: NodeSqliteDB,
  limits: MeshcoreHydrationLoadLimits = {},
): Record<string, unknown>[] {
  const globalLimit = Math.max(1, Math.trunc(limits.globalLimit ?? MESHCORE_DB_MESSAGE_LOAD_LIMIT));
  const perChannelLimit = Math.max(
    1,
    Math.trunc(limits.perChannelLimit ?? MESHCORE_DB_PER_CHANNEL_MESSAGE_LOAD_LIMIT),
  );
  const roomLimit = Math.max(
    1,
    Math.trunc(limits.roomLimit ?? MESHCORE_DB_ROOM_MESSAGE_LOAD_LIMIT),
  );
  // Embed MESHCORE_MESSAGE_CHANNEL_SQL once (CTE) to keep the main bundle lean.
  return db
    .prepareOnce(
      `WITH base AS (
         SELECT id, (${MESHCORE_MESSAGE_CHANNEL_SQL}) AS logical_channel,
           received_at, timestamp
         FROM meshcore_messages
       ),
       ranked AS (
         SELECT id, logical_channel,
           ROW_NUMBER() OVER (
             PARTITION BY logical_channel
             ORDER BY COALESCE(received_at, timestamp) DESC, id DESC
           ) AS channel_rn,
           ROW_NUMBER() OVER (
             ORDER BY COALESCE(received_at, timestamp) DESC, id DESC
           ) AS global_rn
         FROM base
       )
       SELECT m.*
       FROM meshcore_messages m
       WHERE m.id IN (
         SELECT id FROM ranked
         WHERE global_rn <= ?
            OR (logical_channel = -2 AND channel_rn <= ?)
            OR (logical_channel != -2 AND channel_rn <= ?)
       )
       ORDER BY m.id ASC`,
    )
    .all(globalLimit, roomLimit, perChannelLimit) as Record<string, unknown>[];
}

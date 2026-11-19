import { maxQueryableChatReceiptMs, SQL_CHAT_RECEIPT_ORDER_MS } from '../shared/chatReceiptDbOrder';
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
  const maxReceipt = maxQueryableChatReceiptMs();
  // Embed MESHCORE_MESSAGE_CHANNEL_SQL once (CTE) to keep the main bundle lean.
  return db
    .prepareOnce(
      `WITH base AS (
         SELECT id, (${MESHCORE_MESSAGE_CHANNEL_SQL}) AS logical_channel,
           received_at, timestamp,
           (${SQL_CHAT_RECEIPT_ORDER_MS}) AS order_ms
         FROM meshcore_messages
       ),
       ranked AS (
         SELECT id, logical_channel,
           ROW_NUMBER() OVER (PARTITION BY logical_channel ORDER BY order_ms DESC, id DESC) AS channel_rn,
           ROW_NUMBER() OVER (ORDER BY order_ms DESC, id DESC) AS global_rn
         FROM base
       )
       SELECT m.*
       FROM meshcore_messages m
       WHERE m.id IN (
         SELECT id FROM ranked
         WHERE global_rn <= @global_limit
            OR (logical_channel = -2 AND channel_rn <= @room_limit)
            OR (logical_channel != -2 AND channel_rn <= @per_channel_limit)
       )
       ORDER BY m.id ASC`,
    )
    .all({
      max_receipt: maxReceipt,
      global_limit: globalLimit,
      room_limit: roomLimit,
      per_channel_limit: perChannelLimit,
    }) as Record<string, unknown>[];
}

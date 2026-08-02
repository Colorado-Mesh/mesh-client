import type { DmPeerRow } from '../shared/electron-api.types';
import { MESHTASTIC_BROADCAST_NODE_NUM } from '../shared/nodeNameUtils';
import type { NodeSqliteDB } from './db-compat';

export type { DmPeerRow };

const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;

export function clampDmPeerLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
}

/**
 * Distinct Meshtastic DM peers for `ownNodeId` (sender or recipient of a directed message).
 * Broadcast `to_node` is excluded.
 */
export function listMeshtasticDmPeersFromDb(
  db: NodeSqliteDB,
  ownNodeId: number,
  limit: unknown = DEFAULT_LIMIT,
): DmPeerRow[] {
  const own = ownNodeId >>> 0;
  const safeLimit = clampDmPeerLimit(limit);
  const broadcast = MESHTASTIC_BROADCAST_NODE_NUM >>> 0;
  const rows = db
    .prepare(
      `SELECT peer_id AS node_id, MAX(timestamp) AS last_message_at
       FROM (
         SELECT
           CASE
             WHEN sender_id = ? THEN to_node
             ELSE sender_id
           END AS peer_id,
           timestamp
         FROM messages
         WHERE to_node IS NOT NULL
           AND to_node != ?
           AND (sender_id = ? OR to_node = ?)
       )
       WHERE peer_id IS NOT NULL
         AND peer_id != ?
         AND peer_id != ?
       GROUP BY peer_id
       ORDER BY last_message_at DESC
       LIMIT ?`,
    )
    .all(own, broadcast, own, own, own, broadcast, safeLimit) as {
    node_id: number;
    last_message_at: number;
  }[];
  return rows.map((r) => ({
    node_id: r.node_id >>> 0,
    last_message_at: r.last_message_at || 0,
  }));
}

/**
 * Distinct MeshCore DM peers (`channel_idx = -1`) for `ownNodeId`.
 * Room-server posts (`channel_idx = -2`) are not included.
 */
export function listMeshcoreDmPeersFromDb(
  db: NodeSqliteDB,
  ownNodeId: number,
  limit: unknown = DEFAULT_LIMIT,
): DmPeerRow[] {
  const own = ownNodeId >>> 0;
  const safeLimit = clampDmPeerLimit(limit);
  const rows = db
    .prepare(
      `SELECT peer_id AS node_id, MAX(timestamp) AS last_message_at
       FROM (
         SELECT
           CASE
             WHEN sender_id = ? AND to_node IS NOT NULL AND to_node != ? THEN to_node
             WHEN to_node = ? AND sender_id IS NOT NULL AND sender_id != ? THEN sender_id
             WHEN to_node IS NULL AND sender_id IS NOT NULL AND sender_id != ? THEN sender_id
             ELSE NULL
           END AS peer_id,
           timestamp
         FROM meshcore_messages
         WHERE channel_idx = -1
           AND (sender_id = ? OR to_node = ? OR (to_node IS NULL AND sender_id IS NOT NULL))
       )
       WHERE peer_id IS NOT NULL
         AND peer_id != ?
       GROUP BY peer_id
       ORDER BY last_message_at DESC
       LIMIT ?`,
    )
    .all(own, own, own, own, own, own, own, own, safeLimit) as {
    node_id: number;
    last_message_at: number;
  }[];
  return rows.map((r) => ({
    node_id: r.node_id >>> 0,
    last_message_at: r.last_message_at || 0,
  }));
}

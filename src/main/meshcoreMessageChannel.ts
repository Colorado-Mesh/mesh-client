import type { NodeSqliteDB } from './db-compat';

/** Matches the shared classifier without rewriting legacy rows or colliding with dedup indexes. */
export const MESHCORE_MESSAGE_CHANNEL_SQL = `CASE
  WHEN room_server_id IS NOT NULL OR channel_idx = -2 THEN -2
  WHEN to_node > 0 AND to_node != 4294967295 THEN -1
  ELSE channel_idx END`;

/**
 * Delete one channel's messages for this radio.
 * `radioNodeId` <= 0 means the radio is unknown: only historical rows with no
 * `radio_node_id` are removed. A positive id also removes those unscoped rows
 * (they cannot be attributed) and keeps rows stamped for a different radio.
 */
export function clearMeshcoreMessagesByChannel(
  db: NodeSqliteDB,
  channelIndex: number,
  radioNodeId: number,
) {
  if (radioNodeId > 0) {
    return db
      .prepareOnce(
        `DELETE FROM meshcore_messages WHERE ${MESHCORE_MESSAGE_CHANNEL_SQL} = ? AND (radio_node_id IS NULL OR radio_node_id = ?)`,
      )
      .run(channelIndex, radioNodeId);
  }
  return db
    .prepareOnce(
      `DELETE FROM meshcore_messages WHERE ${MESHCORE_MESSAGE_CHANNEL_SQL} = ? AND radio_node_id IS NULL`,
    )
    .run(channelIndex);
}

export function validateMeshcoreMessageLocalOrder(localOrder: unknown): void {
  if (localOrder != null && (!Number.isSafeInteger(localOrder) || Number(localOrder) < 0)) {
    throw new Error('db:saveMeshcoreMessage: local_order must be a non-negative safe integer');
  }
}

export interface MeshcoreMessageRowParams {
  sender_id: number | null;
  sender_name: string | null;
  payload: string;
  channel_idx: number;
  timestamp: number;
  local_order: number | null;
  status: string;
  packet_id: number | null;
  emoji: number | null;
  reply_id: number | null;
  to_node: number | null;
  received_via: string | null;
  rx_packet_fingerprint: string | null;
  reply_preview_text: string | null;
  reply_preview_sender: string | null;
  rx_hops: number | null;
  room_server_id: number | null;
  /** Companion radio that stored this row. Null leaves a historical row unscoped. */
  radio_node_id?: number | null;
}

export function persistMeshcoreMessage(db: NodeSqliteDB, rowParams: MeshcoreMessageRowParams) {
  // idx_mc_msg_dedup is a partial UNIQUE index (sender_id IS NOT NULL); SQLite cannot
  // target it with INSERT ON CONFLICT(columns). Update by natural key, then insert.
  const senderId = rowParams.sender_id;
  const sameObservationSql =
    '(local_order = @local_order OR (local_order IS NULL AND id = @local_order))';
  if (
    (senderId != null && Number.isFinite(senderId) && senderId >= 0) ||
    rowParams.local_order != null
  ) {
    const updated = db
      .prepareOnce(
        'UPDATE meshcore_messages SET ' +
          'sender_name = COALESCE(@sender_name, sender_name), ' +
          'local_order = COALESCE(local_order, @local_order), ' +
          'status = CASE ' +
          "WHEN @status IN ('acked', 'failed') THEN @status " +
          "WHEN status = 'acked' THEN status " +
          'ELSE @status END, ' +
          'packet_id = COALESCE(@packet_id, packet_id), ' +
          'emoji = COALESCE(@emoji, emoji), ' +
          'reply_id = COALESCE(@reply_id, reply_id), ' +
          'to_node = COALESCE(@to_node, to_node), ' +
          'received_via = COALESCE(@received_via, received_via), ' +
          'rx_packet_fingerprint = COALESCE(@rx_packet_fingerprint, rx_packet_fingerprint), ' +
          'reply_preview_text = COALESCE(@reply_preview_text, reply_preview_text), ' +
          'reply_preview_sender = COALESCE(@reply_preview_sender, reply_preview_sender), ' +
          'rx_hops = COALESCE(@rx_hops, rx_hops), ' +
          'room_server_id = COALESCE(@room_server_id, room_server_id) ' +
          // A missing recipient may be repaired only on that same DM observation.
          `WHERE (sender_id = @sender_id OR (@sender_id IS NULL AND sender_id IS NULL AND ${sameObservationSql})) ` +
          `AND (to_node IS @to_node OR (@channel_idx = -1 AND (to_node IS NULL OR to_node = 0) ` +
          `AND @to_node > 0 AND @to_node != 4294967295 AND ${sameObservationSql})) ` +
          `AND timestamp = @timestamp AND ${MESHCORE_MESSAGE_CHANNEL_SQL} = @channel_idx AND payload = @payload`,
      )
      .run(rowParams);
    if (updated.changes > 0) {
      return updated;
    }
  }

  const radioNodeId =
    rowParams.radio_node_id != null && rowParams.radio_node_id > 0 ? rowParams.radio_node_id : null;
  return db
    .prepareOnce(
      'INSERT OR IGNORE INTO meshcore_messages ' +
        '(sender_id, sender_name, payload, channel_idx, timestamp, local_order, status, packet_id, emoji, reply_id, to_node, received_via, rx_packet_fingerprint, reply_preview_text, reply_preview_sender, rx_hops, room_server_id, radio_node_id) ' +
        'VALUES (@sender_id, @sender_name, @payload, @channel_idx, @timestamp, @local_order, @status, @packet_id, @emoji, @reply_id, @to_node, @received_via, @rx_packet_fingerprint, @reply_preview_text, @reply_preview_sender, @rx_hops, @room_server_id, @radio_node_id)',
    )
    .run({ ...rowParams, radio_node_id: radioNodeId });
}

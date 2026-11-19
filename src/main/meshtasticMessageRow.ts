import type { NodeSqliteDB } from './db-compat';

/** One Meshtastic chat row as `db:saveMessage` binds it, after IPC validation. */
export interface MeshtasticMessageRowParams {
  sender_id: number;
  sender_name: string;
  payload: string;
  channel: number;
  timestamp: number;
  packet_id: number | null;
  status: string;
  error: string | null;
  emoji: number | null;
  reply_id: number | null;
  to_node: number | null;
  mqtt_status: string | null;
  received_via: string | null;
  reply_preview_text: string | null;
  reply_preview_sender: string | null;
  rx_hops: number | null;
  via_store_forward: 0 | 1;
  radio_node_id: number | null;
  channel_key: string | null;
  /**
   * First local receipt in ms (`src/shared/chatReceivedAt.ts`). INSERT OR IGNORE keeps the first
   * save's row, so a later save of the same packet never moves it.
   */
  received_at: number | null;
}

export function persistMeshtasticMessage(db: NodeSqliteDB, params: MeshtasticMessageRowParams) {
  const inserted = db
    .prepareOnce(
      `INSERT OR IGNORE INTO messages (sender_id, sender_name, payload, channel, timestamp, packet_id, status, error, emoji, reply_id, to_node, mqtt_status, received_via, reply_preview_text, reply_preview_sender, rx_hops, via_store_forward, radio_node_id, channel_key, received_at)
      VALUES (@sender_id, @sender_name, @payload, @channel, @timestamp, @packet_id, @status, @error, @emoji, @reply_id, @to_node, @mqtt_status, @received_via, @reply_preview_text, @reply_preview_sender, @rx_hops, @via_store_forward, @radio_node_id, @channel_key, @received_at)`,
    )
    .run(params);
  return inserted.changes > 0 || params.packet_id == null || params.received_at == null
    ? inserted
    : db
        .prepareOnce(
          'UPDATE messages SET received_at=@received_at WHERE sender_id=@sender_id AND packet_id=@packet_id AND received_at IS NULL',
        )
        .run(params);
}

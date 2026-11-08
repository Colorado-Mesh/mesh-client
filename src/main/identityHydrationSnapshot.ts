/**
 * Combined SQLite snapshots for cold identity hydration (one IPC round-trip per protocol).
 */

import { clampQueryLimit } from '../shared/clampQueryLimit';
import { effectiveMessageTimestampMs } from '../shared/messageTimestampSkew';
import { sanitizeUnicodeReactionScalar } from '../shared/reactionEmoji';
import type { NodeSqliteDB } from './db-compat';
import { selectMeshcoreMessagesForHydration } from './meshcoreMessageChannel';

const MESHTASTIC_MESSAGE_COLUMNS = `id, sender_id, sender_name, payload, channel, timestamp,
         packet_id AS packetId, status, error, emoji, reply_id AS replyId, to_node,
         mqtt_status AS mqttStatus, received_via AS receivedVia,
         reply_preview_text AS replyPreviewText, reply_preview_sender AS replyPreviewSender,
         rx_hops AS rxHops, via_store_forward AS viaStoreForward,
         radio_node_id AS radioNodeId, channel_key AS channelKey`;

export function readMeshtasticIdentityHydration(
  db: NodeSqliteDB,
  messageLimit?: number,
): {
  nodes: unknown[];
  meshcoreContacts: unknown[];
  messages: unknown[];
} {
  const safeLimit = clampQueryLimit(messageLimit, { default: 1000, max: 10000 });
  const nodes = db.prepareOnce('SELECT * FROM nodes ORDER BY last_heard DESC').all();
  const meshcoreContacts = db.prepareOnce('SELECT * FROM meshcore_contacts').all();
  const rows = db
    .prepareOnce(
      `SELECT ${MESHTASTIC_MESSAGE_COLUMNS} FROM messages ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(safeLimit) as Record<string, unknown>[];
  const messages = rows.map((r) => {
    const { to_node, emoji: emojiRaw, viaStoreForward: viaSfRaw, ...rest } = r;
    const emoji =
      emojiRaw != null ? (sanitizeUnicodeReactionScalar(emojiRaw) ?? undefined) : undefined;
    const viaStoreForward = viaSfRaw === 1 || viaSfRaw === true;
    return {
      ...rest,
      emoji,
      to: to_node ?? undefined,
      ...(viaStoreForward ? { viaStoreForward: true } : {}),
    };
  });
  return { nodes, meshcoreContacts, messages };
}

export function readMeshcoreIdentityHydration(
  db: NodeSqliteDB,
  limits?: {
    globalLimit?: number;
    perChannelLimit?: number;
    roomLimit?: number;
  },
): {
  contacts: unknown[];
  nodes: unknown[];
  hopHistory: {
    node_id: number;
    timestamp: number;
    hops: number | null;
    snr: number | null;
    rssi: number | null;
  }[];
  messages: unknown[];
} {
  const contacts = db.prepareOnce('SELECT * FROM meshcore_contacts').all();
  const nodes = db.prepareOnce('SELECT * FROM nodes ORDER BY last_heard DESC').all();
  const hopHistory = db.prepareOnce('SELECT * FROM meshcore_hop_history').all() as {
    node_id: number;
    timestamp: number;
    hops: number | null;
    snr: number | null;
    rssi: number | null;
  }[];
  const rows = selectMeshcoreMessagesForHydration(db, {
    globalLimit: clampQueryLimit(limits?.globalLimit, { default: 500, max: 10000 }),
    perChannelLimit: clampQueryLimit(limits?.perChannelLimit, { default: 100, max: 10000 }),
    roomLimit: clampQueryLimit(limits?.roomLimit, { default: 200, max: 10000 }),
  });
  const messages = rows.map((row) => ({
    ...row,
    timestamp: effectiveMessageTimestampMs(Number(row.timestamp)),
  }));
  return { contacts, nodes, hopHistory, messages };
}

export function readReticulumIdentityHydration(
  db: NodeSqliteDB,
  identityId: string,
  messageLimit?: number,
): {
  destinations: unknown[];
  messages: unknown[];
} {
  const destinations = db
    .prepareOnce('SELECT * FROM reticulum_destinations ORDER BY last_heard DESC')
    .all();
  const safeLimit = clampQueryLimit(messageLimit, { default: 500, max: 10000 });
  const rows = db
    .prepareOnce(
      'SELECT * FROM reticulum_messages WHERE identity_id = ? ORDER BY timestamp DESC LIMIT ?',
    )
    .all(identityId, safeLimit) as Record<string, unknown>[];
  rows.reverse();
  return { destinations, messages: rows };
}

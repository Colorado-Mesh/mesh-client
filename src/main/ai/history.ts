import type { AiHistoryMessage, AiHistoryQuery } from '../../shared/ai-history';
import { AI_MAX_MESSAGES } from '../../shared/ai-types';
import { MESSAGE_TIMESTAMP_MAX_FUTURE_SKEW_SEC } from '../../shared/messageTimestampSkew';
import { MS_PER_SECOND } from '../../shared/timeConstants';
import type { NodeSqliteDB } from '../db-compat';
import { MESHCORE_MESSAGE_CHANNEL_SQL } from '../meshcoreMessageChannel';

export function validateHistoryQuery(value: unknown): AiHistoryQuery {
  if (!value || typeof value !== 'object') throw new Error('Invalid AI history query');
  const q = value as AiHistoryQuery;
  if (
    !['meshtastic', 'meshcore', 'reticulum'].includes(q.protocol) ||
    !['channel', 'dm', 'room', 'rrc'].includes(q.surface) ||
    !Number.isFinite(q.sinceMs) ||
    !Number.isFinite(q.untilMs) ||
    q.sinceMs < 0 ||
    q.untilMs < q.sinceMs ||
    q.untilMs > 8.64e15
  )
    throw new Error('Invalid AI history range');
  for (const v of [q.channel, q.peerId, q.roomServerId, q.radioNodeId])
    if (v !== undefined && (!Number.isSafeInteger(v) || v < 0 || v > 0xffffffff))
      throw new Error('Invalid AI conversation');
  for (const v of [q.identityId, q.peerHash, q.hubHash, q.room, q.channelKey])
    if (v !== undefined && (typeof v !== 'string' || !v || v.length > 256))
      throw new Error('Invalid AI conversation');
  if (
    q.ownNodeIds !== undefined &&
    (!Array.isArray(q.ownNodeIds) ||
      q.ownNodeIds.length > 32 ||
      q.ownNodeIds.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 0xffffffff))
  )
    throw new Error('Invalid AI identities');
  if (
    q.limit !== undefined &&
    (!Number.isSafeInteger(q.limit) || q.limit < 1 || q.limit > AI_MAX_MESSAGES)
  )
    throw new Error('Invalid AI history limit');
  if (
    (q.beforeAt !== undefined || q.beforeId !== undefined) &&
    (typeof q.beforeAt !== 'number' ||
      !Number.isFinite(q.beforeAt) ||
      q.beforeAt < 0 ||
      typeof q.beforeId !== 'number' ||
      !Number.isSafeInteger(q.beforeId) ||
      q.beforeId < 0)
  )
    throw new Error('Invalid AI history cursor');
  if (q.byArrival !== undefined && typeof q.byArrival !== 'boolean')
    throw new Error('Invalid AI history order');
  return q;
}
interface AiHistoryQueryParts {
  table: string;
  where: string[];
  args: (string | number)[];
  body: string;
  sender: string;
  timestamp: string;
}

function buildAiRrcRoomQuery(q: AiHistoryQuery, parts: AiHistoryQueryParts): void {
  if (!q.hubHash || !q.room || !/^[a-f0-9]{32}$/i.test(q.hubHash))
    throw new Error('Invalid AI room');
  parts.table = 'rrc_messages';
  // Reaction lines (rrc-extensions.md K_REACT_TO) are emoji, not conversation.
  parts.where.push('hub_hash = ?', 'room = ?', "kind IN ('msg', 'action')", 'react_to IS NULL');
  parts.args.push(q.hubHash.toLowerCase(), q.room.trim().toLowerCase().replace(/^#+/, ''));
  parts.body = 'body';
  parts.sender = "COALESCE(nickname, sender_hash, '')";
}

function buildAiRrcDmQuery(q: AiHistoryQuery, parts: AiHistoryQueryParts): void {
  if (!q.identityId || !q.peerHash || !/^[a-f0-9]{32}$/i.test(q.peerHash)) {
    throw new Error('Invalid AI DM');
  }
  parts.table = 'reticulum_messages';
  parts.where.push('identity_id = ?', '(sender_id = ? OR to_hash = ?)');
  parts.args.push(q.identityId, q.peerHash.toLowerCase(), q.peerHash.toLowerCase());
}

function applyAiHistoryRoomQuery(q: AiHistoryQuery, parts: AiHistoryQueryParts): void {
  if (q.roomServerId === undefined) throw new Error('Invalid AI room');
  parts.where.push(
    '(room_server_id = ? OR (room_server_id IS NULL AND (sender_id = ? OR to_node = ?)))',
  );
  parts.args.push(q.roomServerId, q.roomServerId, q.roomServerId);
}

function applyAiHistoryDmQuery(
  q: AiHistoryQuery,
  parts: AiHistoryQueryParts,
  meshcore: boolean,
): void {
  if (q.peerId === undefined || !q.ownNodeIds?.length) throw new Error('Invalid AI DM');
  const marks = q.ownNodeIds.map(() => '?').join(',');
  parts.where.push(
    `((sender_id = ? AND (to_node IN (${marks})${meshcore ? ' OR (channel_idx = -1 AND (to_node IS NULL OR to_node = 0))' : ''})) OR (to_node = ? AND sender_id IN (${marks})))`,
  );
  parts.args.push(q.peerId, ...q.ownNodeIds, q.peerId, ...q.ownNodeIds);
  if (meshcore) parts.where.push('room_server_id IS NULL');
}

function applyAiHistoryChannelQuery(
  q: AiHistoryQuery,
  parts: AiHistoryQueryParts,
  meshcore: boolean,
): void {
  if (q.channel === undefined) throw new Error('Invalid AI channel');
  const channelSql = meshcore ? MESHCORE_MESSAGE_CHANNEL_SQL : 'channel';
  parts.where.push('(to_node IS NULL OR to_node = 0 OR to_node = 4294967295)');
  if (q.channelKey) {
    parts.where.push(
      `(channel_key = ? OR (channel_key IS NULL AND ${channelSql} = ? AND (radio_node_id IS NULL OR radio_node_id = ?)))`,
    );
    parts.args.push(q.channelKey, q.channel, q.radioNodeId ?? -1);
  } else {
    parts.where.push(
      `${channelSql} = ? AND channel_key IS NULL AND (radio_node_id IS NULL OR radio_node_id = ?)`,
    );
    parts.args.push(q.channel, q.radioNodeId ?? -1);
  }
  if (meshcore) parts.where.push('room_server_id IS NULL');
}

function applyAiHistoryLoraQuery(q: AiHistoryQuery, parts: AiHistoryQueryParts, now: number): void {
  const meshcore = q.protocol === 'meshcore';
  parts.table = meshcore ? 'meshcore_messages' : 'messages';
  if (meshcore) {
    parts.sender = "COALESCE(sender_name, 'Unknown')";
    parts.timestamp = 'CASE WHEN timestamp <= 0 OR timestamp > ? THEN ? ELSE timestamp END';
    parts.args.push(now + MESSAGE_TIMESTAMP_MAX_FUTURE_SKEW_SEC * MS_PER_SECOND, now);
  }
  if (q.surface === 'room' && meshcore) {
    applyAiHistoryRoomQuery(q, parts);
  } else if (q.surface === 'dm') {
    applyAiHistoryDmQuery(q, parts, meshcore);
  } else if (q.surface === 'channel') {
    applyAiHistoryChannelQuery(q, parts, meshcore);
  } else {
    throw new Error('Invalid AI conversation');
  }
  parts.where.push('(emoji IS NULL OR emoji = 0)');
  if (q.surface !== 'channel' && q.radioNodeId !== undefined) {
    parts.where.push('(radio_node_id IS NULL OR radio_node_id = ?)');
    parts.args.push(q.radioNodeId);
  }
}

export function querySummaryHistory(
  db: NodeSqliteDB,
  q: AiHistoryQuery,
  now = Date.now(),
): AiHistoryMessage[] {
  const parts: AiHistoryQueryParts = {
    table: '',
    where: [],
    args: [],
    body: 'payload',
    sender: "COALESCE(sender_name, CAST(sender_id AS TEXT), '')",
    timestamp: 'timestamp',
  };
  if (q.protocol === 'reticulum' && q.surface === 'rrc') {
    buildAiRrcRoomQuery(q, parts);
  } else if (q.protocol === 'reticulum' && q.surface === 'dm') {
    buildAiRrcDmQuery(q, parts);
  } else if (q.protocol === 'meshtastic' || q.protocol === 'meshcore') {
    applyAiHistoryLoraQuery(q, parts, now);
  } else {
    throw new Error('Invalid AI conversation');
  }
  const { table, where, args, body, sender, timestamp } = parts;
  // Normalize MeshCore clock skew before both the range predicate and ordering, without
  // changing the insertion-order semantics of existing unbounded chat history APIs.
  const senderId =
    q.protocol === 'meshtastic' || q.protocol === 'meshcore' ? ', sender_id AS senderId' : '';
  // "Since last read" bounds and pages by arrival, the clock its read mark comes from; rows saved
  // before receipt times were kept fall back to their (normalized) stamp, as in the chat list.
  const key = q.byArrival ? 'COALESCE(received_at, at)' : 'at';
  const cursor =
    q.beforeAt !== undefined && q.beforeId !== undefined
      ? ` AND (${key} < ? OR (${key} = ? AND id < ?))`
      : '';
  const page = q.limit ?? AI_MAX_MESSAGES;
  const sql = `SELECT at${q.byArrival ? `, ${key} AS "order"` : ''}, sender, body, id${senderId ? ', senderId' : ''} FROM (SELECT ${timestamp} AS at, received_at, ${sender} AS sender, ${body} AS body, id${senderId} FROM ${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}) WHERE ${key} >= ? AND ${key} <= ?${cursor} ORDER BY ${key} DESC, id DESC LIMIT ?`;
  const bound =
    q.beforeAt !== undefined && q.beforeId !== undefined
      ? [...args, q.sinceMs, q.untilMs, q.beforeAt, q.beforeAt, q.beforeId, page + 1]
      : [...args, q.sinceMs, q.untilMs, page + 1];
  return (db.prepareOnce(sql).all(...bound) as AiHistoryMessage[]).reverse();
}

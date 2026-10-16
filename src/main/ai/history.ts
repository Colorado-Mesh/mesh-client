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
  return q;
}
export function querySummaryHistory(
  db: NodeSqliteDB,
  q: AiHistoryQuery,
  now = Date.now(),
): AiHistoryMessage[] {
  const args: (string | number)[] = [];
  const where: string[] = [];
  let table: string;
  let body = 'payload';
  let sender = "COALESCE(sender_name, CAST(sender_id AS TEXT), '')";
  let timestamp = 'timestamp';
  if (q.protocol === 'reticulum' && q.surface === 'rrc') {
    if (!q.hubHash || !q.room || !/^[a-f0-9]{32}$/i.test(q.hubHash))
      throw new Error('Invalid AI room');
    table = 'rrc_messages';
    where.push('hub_hash = ?', 'room = ?', "kind IN ('msg', 'action')");
    args.push(q.hubHash.toLowerCase(), q.room.trim().toLowerCase().replace(/^#+/, ''));
    body = 'body';
    sender = "COALESCE(nickname, sender_hash, '')";
  } else if (q.protocol === 'reticulum' && q.surface === 'dm') {
    if (!q.identityId || !q.peerHash || !/^[a-f0-9]{32}$/i.test(q.peerHash))
      throw new Error('Invalid AI DM');
    table = 'reticulum_messages';
    where.push('identity_id = ?', '(sender_id = ? OR to_hash = ?)');
    args.push(q.identityId, q.peerHash.toLowerCase(), q.peerHash.toLowerCase());
  } else if (q.protocol === 'meshtastic' || q.protocol === 'meshcore') {
    const meshcore = q.protocol === 'meshcore';
    table = meshcore ? 'meshcore_messages' : 'messages';
    if (meshcore) {
      sender = "COALESCE(sender_name, 'Unknown')";
      timestamp = 'CASE WHEN timestamp <= 0 OR timestamp > ? THEN ? ELSE timestamp END';
      args.push(now + MESSAGE_TIMESTAMP_MAX_FUTURE_SKEW_SEC * MS_PER_SECOND, now);
    }
    if (q.surface === 'room' && meshcore) {
      if (q.roomServerId === undefined) throw new Error('Invalid AI room');
      where.push(
        '(room_server_id = ? OR (room_server_id IS NULL AND (sender_id = ? OR to_node = ?)))',
      );
      args.push(q.roomServerId, q.roomServerId, q.roomServerId);
    } else if (q.surface === 'dm') {
      if (q.peerId === undefined || !q.ownNodeIds?.length) throw new Error('Invalid AI DM');
      const marks = q.ownNodeIds.map(() => '?').join(',');
      where.push(
        `((sender_id = ? AND (to_node IN (${marks})${meshcore ? ' OR (channel_idx = -1 AND (to_node IS NULL OR to_node = 0))' : ''})) OR (to_node = ? AND sender_id IN (${marks})))`,
      );
      args.push(q.peerId, ...q.ownNodeIds, q.peerId, ...q.ownNodeIds);
      if (meshcore) where.push('room_server_id IS NULL');
    } else if (q.surface === 'channel') {
      if (q.channel === undefined) throw new Error('Invalid AI channel');
      const channelSql = meshcore ? MESHCORE_MESSAGE_CHANNEL_SQL : 'channel';
      where.push('(to_node IS NULL OR to_node = 0 OR to_node = 4294967295)');
      if (q.channelKey) {
        where.push(
          `(channel_key = ? OR (channel_key IS NULL AND ${channelSql} = ? AND (radio_node_id IS NULL OR radio_node_id = ?)))`,
        );
        args.push(q.channelKey, q.channel, q.radioNodeId ?? -1);
      } else {
        where.push(
          `${channelSql} = ? AND channel_key IS NULL AND (radio_node_id IS NULL OR radio_node_id = ?)`,
        );
        args.push(q.channel, q.radioNodeId ?? -1);
      }
      if (meshcore) where.push('room_server_id IS NULL');
    } else throw new Error('Invalid AI conversation');
    where.push('(emoji IS NULL OR emoji = 0)');
    if (q.surface !== 'channel' && q.radioNodeId !== undefined) {
      where.push('(radio_node_id IS NULL OR radio_node_id = ?)');
      args.push(q.radioNodeId);
    }
  } else throw new Error('Invalid AI conversation');
  // Normalize MeshCore clock skew before both the range predicate and ordering, without
  // changing the insertion-order semantics of existing unbounded chat history APIs.
  const senderId =
    q.protocol === 'meshtastic' || q.protocol === 'meshcore' ? ', sender_id AS senderId' : '';
  const sql = `SELECT at, sender, body${senderId ? ', senderId' : ''} FROM (SELECT ${timestamp} AS at, ${sender} AS sender, ${body} AS body, id${senderId} FROM ${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}) WHERE at >= ? AND at <= ? ORDER BY at DESC, id DESC LIMIT ?`;
  return (
    db
      .prepareOnce(sql)
      .all(...args, q.sinceMs, q.untilMs, AI_MAX_MESSAGES + 1) as AiHistoryMessage[]
  ).reverse();
}

import type { IpcMain } from 'electron';

import { canonicalizeReticulumDestinationHash } from '../../shared/reticulumDestinationHash';
import type { RrcChatMessageKind } from '../../shared/rrc-types';
import { finishDbIpcHandler, getDbForIpc } from '../db-ipc-lifecycle';
import { assertIpcSender } from '../validate-ipc-sender';

const ALLOWED_KINDS = new Set<RrcChatMessageKind>(['msg', 'notice', 'action', 'error', 'system']);

const MAX_BODY_LEN = 65536;
const MAX_ROOM_LEN = 256;
const MAX_NICK_LEN = 128;
const MAX_MESSAGE_ID_LEN = 128;

function canonicalizeHubHash(raw: unknown): string | null {
  return typeof raw === 'string' ? canonicalizeReticulumDestinationHash(raw) : null;
}

/** Match renderer `rrcRoomMatchKey` for non-synthetic rooms (strip leading #). */
function normalizeRoom(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let room = raw.trim().toLowerCase();
  if (!room || room.length > MAX_ROOM_LEN) return null;
  if (!room.startsWith('[') && !room.startsWith('@')) {
    room = room.replace(/^#+/, '');
  }
  if (!room || room.length > MAX_ROOM_LEN) return null;
  return room;
}

interface ValidatedRrcInsert {
  hub: string;
  room: string;
  messageId: string;
  kind: string;
  body: string;
  timestamp: number;
  senderHash: string | null;
  nickname: string | null;
}

/** Validate and normalize an inbound `db:insertRrcMessage` payload (throws on invalid fields). */
function validateRrcInsertMessage(message: unknown): ValidatedRrcInsert {
  if (!message || typeof message !== 'object') {
    throw new TypeError('db:insertRrcMessage: message must be an object');
  }
  const m = message as Record<string, unknown>;
  const hub = canonicalizeHubHash(m.hub_hash);
  const room = normalizeRoom(m.room);
  const messageId = typeof m.message_id === 'string' ? m.message_id.trim() : '';
  const kind = typeof m.kind === 'string' ? m.kind : '';
  const body = typeof m.body === 'string' ? m.body : '';
  const timestamp = Number(m.timestamp);
  if (!hub) throw new Error('db:insertRrcMessage: hub_hash invalid');
  if (!room) throw new Error('db:insertRrcMessage: room invalid');
  if (!messageId || messageId.length > MAX_MESSAGE_ID_LEN) {
    throw new Error('db:insertRrcMessage: message_id invalid');
  }
  if (!ALLOWED_KINDS.has(kind as RrcChatMessageKind)) {
    throw new Error('db:insertRrcMessage: kind invalid');
  }
  if (!body || body.length > MAX_BODY_LEN) {
    throw new Error('db:insertRrcMessage: body invalid');
  }
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('db:insertRrcMessage: timestamp invalid');
  }
  const senderHash =
    typeof m.sender_hash === 'string' && m.sender_hash.trim()
      ? (canonicalizeReticulumDestinationHash(m.sender_hash) ?? m.sender_hash.slice(0, 64))
      : null;
  const nickname =
    typeof m.nickname === 'string' && m.nickname.trim()
      ? m.nickname.trim().slice(0, MAX_NICK_LEN)
      : null;
  return { hub, room, messageId, kind, body, timestamp, senderHash, nickname };
}

export interface RrcDbIpcDeps {
  ipcMain: IpcMain;
}

export function registerRrcDbIpcHandlers({ ipcMain }: RrcDbIpcDeps): void {
  ipcMain.handle('db:listRrcMessages', (event, hubHash: unknown, room: unknown, limit = 500) => {
    try {
      assertIpcSender(event, 'db:listRrcMessages');
      const hub = canonicalizeHubHash(hubHash);
      const roomKey = normalizeRoom(room);
      if (!hub || !roomKey) return [];
      const safeLimit = Math.min(Math.max(1, Number(limit) || 500), 10_000);
      const db = getDbForIpc('db:listRrcMessages');
      if (!db) return [];
      const rows = db
        .prepareOnce(
          `SELECT message_id, hub_hash, room, sender_hash, nickname, kind, body, timestamp
             FROM rrc_messages
             WHERE hub_hash = ? AND room = ?
             ORDER BY timestamp DESC, id DESC
             LIMIT ?`,
        )
        .all(hub, roomKey, safeLimit) as Record<string, unknown>[];
      rows.reverse();
      return rows;
    } catch (err) {
      finishDbIpcHandler('db:listRrcMessages', err);
    }
  });

  ipcMain.handle('db:insertRrcMessage', (event, message: unknown) => {
    try {
      assertIpcSender(event, 'db:insertRrcMessage');
      const v = validateRrcInsertMessage(message);
      const db = getDbForIpc('db:insertRrcMessage');
      if (!db) return { changes: 0 };
      const result = db
        .prepareOnce(
          `INSERT OR IGNORE INTO rrc_messages
            (message_id, hub_hash, room, sender_hash, nickname, kind, body, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          v.messageId,
          v.hub,
          v.room,
          v.senderHash,
          v.nickname,
          v.kind,
          v.body,
          Math.floor(v.timestamp),
        );
      return { changes: Number(result.changes) };
    } catch (err) {
      finishDbIpcHandler('db:insertRrcMessage', err);
    }
  });

  ipcMain.handle('db:deleteRrcMessagesByRoom', (event, hubHash: unknown, room: unknown) => {
    try {
      assertIpcSender(event, 'db:deleteRrcMessagesByRoom');
      const hub = canonicalizeHubHash(hubHash);
      const roomKey = normalizeRoom(room);
      if (!hub || !roomKey) return { changes: 0 };
      const db = getDbForIpc('db:deleteRrcMessagesByRoom');
      if (!db) return { changes: 0 };
      const result = db
        .prepareOnce('DELETE FROM rrc_messages WHERE hub_hash = ? AND room = ?')
        .run(hub, roomKey);
      return { changes: Number(result.changes) };
    } catch (err) {
      finishDbIpcHandler('db:deleteRrcMessagesByRoom', err);
    }
  });

  ipcMain.handle('db:pruneRrcMessagesByCount', (event, maxCount: number) => {
    try {
      assertIpcSender(event, 'db:pruneRrcMessagesByCount');
      const db = getDbForIpc('db:pruneRrcMessagesByCount');
      if (!db) return { changes: 0 };
      if (typeof maxCount !== 'number' || maxCount < 100 || !Number.isFinite(maxCount)) {
        return { changes: 0 };
      }
      const cap = Math.floor(maxCount);
      const result = db
        .prepareOnce(
          `DELETE FROM rrc_messages
           WHERE id NOT IN (
             SELECT id FROM rrc_messages ORDER BY timestamp DESC, id DESC LIMIT ?
           )`,
        )
        .run(cap);
      if (result.changes > 0) {
        console.debug(
          `[IPC] db:pruneRrcMessagesByCount: pruned ${result.changes} messages, keeping newest ${cap}`,
        );
      }
      return { changes: Number(result.changes) };
    } catch (err) {
      finishDbIpcHandler('db:pruneRrcMessagesByCount', err);
    }
  });

  ipcMain.handle('db:pruneRrcMessagesByAge', (event, maxAgeDays: number) => {
    try {
      assertIpcSender(event, 'db:pruneRrcMessagesByAge');
      const db = getDbForIpc('db:pruneRrcMessagesByAge');
      if (!db) return { changes: 0 };
      if (typeof maxAgeDays !== 'number' || maxAgeDays < 1 || !Number.isFinite(maxAgeDays)) {
        return { changes: 0 };
      }
      const days = Math.min(Math.floor(maxAgeDays), 3650);
      const cutoffMs = Date.now() - days * 86_400_000;
      const result = db.prepareOnce('DELETE FROM rrc_messages WHERE timestamp < ?').run(cutoffMs);
      if (result.changes > 0) {
        console.debug(
          `[IPC] db:pruneRrcMessagesByAge: pruned ${result.changes} messages older than ${days}d`,
        );
      }
      return { changes: Number(result.changes) };
    } catch (err) {
      finishDbIpcHandler('db:pruneRrcMessagesByAge', err);
    }
  });
}

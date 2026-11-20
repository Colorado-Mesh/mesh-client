/**
 * MeshCom SQLite IPC.
 * Production ships this as sibling `meshcom-db-handlers.js` so it stays out of measured index.js.
 */
import type { IpcMain } from 'electron';

import { chatReceivedAtForDb } from '../../shared/chatReceivedAt';
import { clampQueryLimit } from '../../shared/clampQueryLimit';
import { finishDbIpcHandler, getDbForIpc } from '../db-ipc-lifecycle';
import { assertIpcSender, validateIpcSender } from '../validate-ipc-sender';

const MAX_CALLSIGN_LEN = 16;
const MAX_TEXT_LEN = 4096;
const MAX_PATH_LEN = 512;
const MAX_MSG_ID_LEN = 128;
const MAX_IDENTITY_LEN = 128;
const MAX_STATUS_LEN = 32;

const VALID_RECEIVED_VIA = new Set(['rf', 'mqtt', 'both']);

export interface MeshcomMessageInput {
  identity_id?: string | null;
  msg_id?: string | null;
  from_call?: string | null;
  to_call_or_group?: string | null;
  text: string;
  channel_idx?: number | null;
  path?: string | null;
  rssi?: number | null;
  snr?: number | null;
  hw_id?: number | null;
  received_via?: string | null;
  timestamp: number;
  status?: string | null;
  received_at?: number | null;
}

export interface MeshcomContactInput {
  callsign: string;
  identity_id?: string | null;
  node_id: number;
  lat?: number | null;
  lon?: number | null;
  batt?: number | null;
  hw_id?: number | null;
  last_heard?: number | null;
  favorited?: number | boolean | null;
}

function clampStr(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function optionalFinite(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Validate `db:saveMeshcomMessage` payload (throws on invalid fields). */
export function validateSaveMeshcomMessage(msg: unknown): asserts msg is MeshcomMessageInput {
  if (!msg || typeof msg !== 'object') {
    throw new Error('db:saveMeshcomMessage: message must be an object');
  }
  const m = msg as Record<string, unknown>;
  if (typeof m.text !== 'string') throw new Error('db:saveMeshcomMessage: text must be a string');
  if (m.text.length > MAX_TEXT_LEN) throw new Error('db:saveMeshcomMessage: text too long');
  if (typeof m.timestamp !== 'number' || !Number.isFinite(m.timestamp)) {
    throw new Error('db:saveMeshcomMessage: timestamp must be a finite number');
  }
  if (
    m.identity_id != null &&
    typeof m.identity_id === 'string' &&
    m.identity_id.length > MAX_IDENTITY_LEN
  ) {
    throw new Error('db:saveMeshcomMessage: identity_id too long');
  }
  if (m.msg_id != null && typeof m.msg_id === 'string' && m.msg_id.length > MAX_MSG_ID_LEN) {
    throw new Error('db:saveMeshcomMessage: msg_id too long');
  }
  if (
    m.from_call != null &&
    typeof m.from_call === 'string' &&
    m.from_call.length > MAX_CALLSIGN_LEN
  ) {
    throw new Error('db:saveMeshcomMessage: from_call too long');
  }
  if (
    m.to_call_or_group != null &&
    typeof m.to_call_or_group === 'string' &&
    m.to_call_or_group.length > MAX_CALLSIGN_LEN
  ) {
    throw new Error('db:saveMeshcomMessage: to_call_or_group too long');
  }
  if (m.path != null && typeof m.path === 'string' && m.path.length > MAX_PATH_LEN) {
    throw new Error('db:saveMeshcomMessage: path too long');
  }
  if (m.status != null && typeof m.status === 'string' && m.status.length > MAX_STATUS_LEN) {
    throw new Error('db:saveMeshcomMessage: status too long');
  }
  if (m.received_via != null) {
    if (typeof m.received_via !== 'string' || !VALID_RECEIVED_VIA.has(m.received_via)) {
      throw new Error('db:saveMeshcomMessage: received_via must be rf, mqtt, or both');
    }
  }
  if (m.channel_idx != null) {
    const ch = Number(m.channel_idx);
    if (!Number.isInteger(ch) || ch < -1 || ch > 255) {
      throw new Error('db:saveMeshcomMessage: channel_idx must be -1..255');
    }
  }
}

/** Validate `db:saveMeshcomContact` payload (throws on invalid fields). */
export function validateSaveMeshcomContact(
  contact: unknown,
): asserts contact is MeshcomContactInput {
  if (!contact || typeof contact !== 'object') {
    throw new Error('db:saveMeshcomContact: contact must be an object');
  }
  const c = contact as Record<string, unknown>;
  if (typeof c.callsign !== 'string' || !c.callsign.trim()) {
    throw new Error('db:saveMeshcomContact: callsign must be a non-empty string');
  }
  if (c.callsign.length > MAX_CALLSIGN_LEN) {
    throw new Error('db:saveMeshcomContact: callsign too long');
  }
  const nodeId = Number(c.node_id);
  if (!Number.isFinite(nodeId) || nodeId < 0) {
    throw new Error('db:saveMeshcomContact: node_id must be a finite non-negative number');
  }
  if (
    c.identity_id != null &&
    typeof c.identity_id === 'string' &&
    c.identity_id.length > MAX_IDENTITY_LEN
  ) {
    throw new Error('db:saveMeshcomContact: identity_id too long');
  }
  if (c.favorited != null) {
    const f = Number(c.favorited === true ? 1 : c.favorited === false ? 0 : c.favorited);
    if (f !== 0 && f !== 1) throw new Error('db:saveMeshcomContact: favorited must be 0 or 1');
  }
}

export interface MeshcomDbIpcDeps {
  ipcMain: IpcMain;
}

export function registerMeshcomDbIpcHandlers({ ipcMain }: MeshcomDbIpcDeps): void {
  ipcMain.handle(
    'db:getMeshcomMessages',
    (event, identityId?: unknown, channelIdx?: unknown, limit = 200) => {
      try {
        assertIpcSender(event, 'db:getMeshcomMessages');
        const safeLimit = clampQueryLimit(limit, { default: 200, max: 10_000 });
        const db = getDbForIpc('db:getMeshcomMessages');
        if (!db) return [];
        const identity =
          typeof identityId === 'string' && identityId.trim()
            ? identityId.trim().slice(0, MAX_IDENTITY_LEN)
            : null;
        const channel =
          channelIdx == null || channelIdx === ''
            ? null
            : Number.isFinite(Number(channelIdx))
              ? Math.trunc(Number(channelIdx))
              : null;

        if (identity != null && channel != null) {
          const rows = db
            .prepareOnce(
              `SELECT * FROM meshcom_messages
             WHERE identity_id = @identity AND channel_idx = @channel
             ORDER BY timestamp DESC, id DESC LIMIT @limit`,
            )
            .all({ identity, channel, limit: safeLimit }) as Record<string, unknown>[];
          rows.reverse();
          return rows;
        }
        if (identity != null) {
          const rows = db
            .prepareOnce(
              `SELECT * FROM meshcom_messages
             WHERE identity_id = @identity
             ORDER BY timestamp DESC, id DESC LIMIT @limit`,
            )
            .all({ identity, limit: safeLimit }) as Record<string, unknown>[];
          rows.reverse();
          return rows;
        }
        if (channel != null) {
          const rows = db
            .prepareOnce(
              `SELECT * FROM meshcom_messages
             WHERE channel_idx = @channel
             ORDER BY timestamp DESC, id DESC LIMIT @limit`,
            )
            .all({ channel, limit: safeLimit }) as Record<string, unknown>[];
          rows.reverse();
          return rows;
        }
        const rows = db
          .prepareOnce(
            `SELECT * FROM meshcom_messages ORDER BY timestamp DESC, id DESC LIMIT @limit`,
          )
          .all({ limit: safeLimit }) as Record<string, unknown>[];
        rows.reverse();
        return rows;
      } catch (err) {
        finishDbIpcHandler('db:getMeshcomMessages', err);
      }
    },
  );

  ipcMain.handle('db:saveMeshcomMessage', (event, message: unknown) => {
    if (!validateIpcSender(event)) throw new Error('db:saveMeshcomMessage: unauthorized sender');
    try {
      validateSaveMeshcomMessage(message);
      const m = message;
      const db = getDbForIpc('db:saveMeshcomMessage');
      if (!db) return { changes: 0 };
      const receivedVia =
        typeof m.received_via === 'string' && VALID_RECEIVED_VIA.has(m.received_via)
          ? m.received_via
          : null;
      const row = {
        identity_id: clampStr(m.identity_id, MAX_IDENTITY_LEN) ?? '',
        msg_id: clampStr(m.msg_id, MAX_MSG_ID_LEN),
        from_call: clampStr(m.from_call, MAX_CALLSIGN_LEN),
        to_call_or_group: clampStr(m.to_call_or_group, MAX_CALLSIGN_LEN),
        text: m.text.slice(0, MAX_TEXT_LEN),
        channel_idx: m.channel_idx != null ? Math.trunc(m.channel_idx) : 0,
        path: clampStr(m.path, MAX_PATH_LEN),
        rssi: optionalFinite(m.rssi),
        snr: optionalFinite(m.snr),
        hw_id: m.hw_id != null && Number.isFinite(m.hw_id) ? Math.trunc(m.hw_id) : null,
        received_via: receivedVia,
        timestamp: Math.trunc(m.timestamp),
        status: typeof m.status === 'string' ? m.status.slice(0, MAX_STATUS_LEN) : 'acked',
        received_at: chatReceivedAtForDb(m.received_at),
      };
      // Partial unique index on (identity_id, msg_id) is not a reliable ON CONFLICT target —
      // update-then-insert keeps duplicates out when msg_id is present.
      if (row.msg_id) {
        const updated = db
          .prepareOnce(
            `UPDATE meshcom_messages SET
               from_call = @from_call,
               to_call_or_group = @to_call_or_group,
               text = @text,
               channel_idx = @channel_idx,
               path = COALESCE(@path, path),
               rssi = COALESCE(@rssi, rssi),
               snr = COALESCE(@snr, snr),
               hw_id = COALESCE(@hw_id, hw_id),
               received_via = COALESCE(@received_via, received_via),
               timestamp = @timestamp,
               status = @status
             WHERE identity_id = @identity_id AND msg_id = @msg_id`,
          )
          .run(row);
        if (updated.changes > 0) return { changes: updated.changes };
      }
      const result = db
        .prepareOnce(
          `INSERT INTO meshcom_messages (
             identity_id, msg_id, from_call, to_call_or_group, text, channel_idx,
             path, rssi, snr, hw_id, received_via, timestamp, status, received_at
           ) VALUES (
             @identity_id, @msg_id, @from_call, @to_call_or_group, @text, @channel_idx,
             @path, @rssi, @snr, @hw_id, @received_via, @timestamp, @status, @received_at
           )`,
        )
        .run(row);
      return { changes: result.changes };
    } catch (err) {
      finishDbIpcHandler('db:saveMeshcomMessage', err);
    }
  });

  ipcMain.handle('db:getMeshcomContacts', (event, identityId?: unknown) => {
    try {
      assertIpcSender(event, 'db:getMeshcomContacts');
      const db = getDbForIpc('db:getMeshcomContacts');
      if (!db) return [];
      const identity =
        typeof identityId === 'string' && identityId.trim()
          ? identityId.trim().slice(0, MAX_IDENTITY_LEN)
          : null;
      if (identity != null) {
        return db
          .prepareOnce(
            'SELECT * FROM meshcom_contacts WHERE identity_id = ? ORDER BY last_heard DESC',
          )
          .all(identity);
      }
      return db.prepareOnce('SELECT * FROM meshcom_contacts ORDER BY last_heard DESC').all();
    } catch (err) {
      finishDbIpcHandler('db:getMeshcomContacts', err);
    }
  });

  ipcMain.handle('db:saveMeshcomContact', (event, contact: unknown) => {
    if (!validateIpcSender(event)) throw new Error('db:saveMeshcomContact: unauthorized sender');
    try {
      validateSaveMeshcomContact(contact);
      const c = contact;
      const db = getDbForIpc('db:saveMeshcomContact');
      if (!db) return { changes: 0 };
      // Ingest upserts omit `favorited` — preserve an existing star. Explicit 0/1 updates it.
      const favoritedProvided = c.favorited !== undefined && c.favorited !== null;
      const favorited = c.favorited === true || c.favorited === 1 ? 1 : 0;
      const result = db
        .prepareOnce(
          `INSERT INTO meshcom_contacts (
             callsign, identity_id, node_id, lat, lon, batt, hw_id, last_heard, favorited
           ) VALUES (
             @callsign, @identity_id, @node_id, @lat, @lon, @batt, @hw_id, @last_heard, @favorited
           )
           ON CONFLICT(identity_id, callsign) DO UPDATE SET
             node_id = excluded.node_id,
             lat = COALESCE(excluded.lat, meshcom_contacts.lat),
             lon = COALESCE(excluded.lon, meshcom_contacts.lon),
             batt = COALESCE(excluded.batt, meshcom_contacts.batt),
             hw_id = COALESCE(excluded.hw_id, meshcom_contacts.hw_id),
             last_heard = COALESCE(excluded.last_heard, meshcom_contacts.last_heard),
             favorited = CASE
               WHEN @favorited_provided = 1 THEN excluded.favorited
               ELSE meshcom_contacts.favorited
             END`,
        )
        .run({
          callsign: c.callsign.trim().slice(0, MAX_CALLSIGN_LEN).toUpperCase(),
          identity_id: clampStr(c.identity_id, MAX_IDENTITY_LEN) ?? '',
          node_id: c.node_id >>> 0,
          lat: optionalFinite(c.lat),
          lon: optionalFinite(c.lon),
          batt: c.batt != null && Number.isFinite(c.batt) ? Math.trunc(c.batt) : null,
          hw_id: c.hw_id != null && Number.isFinite(c.hw_id) ? Math.trunc(c.hw_id) : null,
          last_heard:
            c.last_heard != null && Number.isFinite(c.last_heard) ? Math.trunc(c.last_heard) : null,
          favorited: favoritedProvided ? favorited : 0,
          favorited_provided: favoritedProvided ? 1 : 0,
        });
      return { changes: result.changes };
    } catch (err) {
      finishDbIpcHandler('db:saveMeshcomContact', err);
    }
  });
}

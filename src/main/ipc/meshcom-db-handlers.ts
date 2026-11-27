/**
 * MeshCom SQLite IPC.
 * Production ships this as sibling `meshcom-db-handlers.js` so it stays out of measured index.js.
 */
import type { IpcMain } from 'electron';

import { chatReceivedAtForDb } from '../../shared/chatReceivedAt';
import { clampQueryLimit } from '../../shared/clampQueryLimit';
import {
  isValidMeshcomDbChannelIdx,
  MESHCOM_CONTACT_CAP_DEFAULT,
  MESHCOM_GRC_ID_MAX,
  MESHCOM_MAX_MSG_ID_LEN,
  MESHCOM_MAX_TEXT_LEN,
} from '../../shared/meshcomConstants';
import type { NodeSqliteDB } from '../db-compat';
import { finishDbIpcHandler, getDbForIpc } from '../db-ipc-lifecycle';
import { assertIpcSender, validateIpcSender } from '../validate-ipc-sender';
import type { MeshcomDbDegradedPayload } from './meshcom-db-status';
import { MESHCOM_DB_DEGRADED_CHANNEL } from './meshcom-db-status';

const MAX_CALLSIGN_LEN = 16;
const MAX_TEXT_LEN = MESHCOM_MAX_TEXT_LEN;
const MAX_PATH_LEN = 512;
const MAX_MSG_ID_LEN = MESHCOM_MAX_MSG_ID_LEN;
const MAX_IDENTITY_LEN = 128;
const MAX_STATUS_LEN = 32;

/** Keep in sync with renderer `messageRetention` defaults (main must not import renderer). */
const MESHCOM_MESSAGE_RETENTION_MIN = 100;
const MESHCOM_MESSAGE_RETENTION_MAX = 100_000;
const MESHCOM_MESSAGE_RETENTION_DEFAULT = 4000;

/** Soft cap applied after each insert (updated when prune IPC runs at startup). */
let meshcomMessageRetentionCap = MESHCOM_MESSAGE_RETENTION_DEFAULT;
let meshcomContactCap = MESHCOM_CONTACT_CAP_DEFAULT;

function clampMeshcomRetentionCap(maxCount: unknown): number | null {
  if (
    typeof maxCount !== 'number' ||
    !Number.isFinite(maxCount) ||
    maxCount < MESHCOM_MESSAGE_RETENTION_MIN
  ) {
    return null;
  }
  return Math.min(MESHCOM_MESSAGE_RETENTION_MAX, Math.floor(maxCount));
}

/** Delete oldest MeshCom rows, keeping the newest `cap` by timestamp/id. */
export function pruneMeshcomMessagesByCountOn(db: NodeSqliteDB, cap: number): number {
  return Number(
    db
      .prepareOnce(
        `DELETE FROM meshcom_messages WHERE id NOT IN (
           SELECT id FROM meshcom_messages ORDER BY timestamp DESC, id DESC LIMIT ?
         )`,
      )
      .run(cap).changes,
  );
}

/**
 * Cap MeshCom contacts: keep favorited rows, then newest `last_heard` until `cap`.
 * Prevents unique-callsign floods from filling SQLite / hydrate.
 */
export function pruneMeshcomContactsByCountOn(db: NodeSqliteDB, cap: number): number {
  const total = (
    db.prepareOnce('SELECT COUNT(*) as cnt FROM meshcom_contacts').get() as { cnt: number }
  ).cnt;
  if (total <= cap) return 0;
  const favorited = (
    db
      .prepareOnce(
        'SELECT COUNT(*) as cnt FROM meshcom_contacts WHERE favorited IS NOT NULL AND favorited = 1',
      )
      .get() as { cnt: number }
  ).cnt;
  const keepNonFavorited = Math.max(0, cap - favorited);
  return Number(
    db
      .prepareOnce(
        `DELETE FROM meshcom_contacts WHERE (favorited IS NULL OR favorited = 0)
         AND rowid NOT IN (
           SELECT rowid FROM meshcom_contacts
           WHERE (favorited IS NULL OR favorited = 0)
           ORDER BY COALESCE(last_heard, 0) DESC, callsign ASC
           LIMIT ?
         )`,
      )
      .run(keepNonFavorited).changes,
  );
}

function clampMeshcomContactCap(maxCount: unknown): number | null {
  if (typeof maxCount !== 'number' || !Number.isFinite(maxCount) || maxCount < 1) {
    return null;
  }
  return Math.min(MESHCOM_MESSAGE_RETENTION_MAX, Math.floor(maxCount));
}

const VALID_RECEIVED_VIA = new Set(['rf', 'mqtt', 'both', 'network']);

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
      throw new Error('db:saveMeshcomMessage: received_via must be rf, mqtt, both, or network');
    }
  }
  if (m.channel_idx != null) {
    const ch = Number(m.channel_idx);
    if (!isValidMeshcomDbChannelIdx(ch)) {
      throw new Error(`db:saveMeshcomMessage: channel_idx must be -1..${MESHCOM_GRC_ID_MAX}`);
    }
  }
}

function blankCall(value: string | null | undefined): string {
  return value ?? '';
}

/** Same logical chat row: text, channel, timestamp, and non-empty sender/recipient. */
function meshcomStoredMessageMatches(
  existing: {
    from_call: string | null;
    to_call_or_group: string | null;
    text: string;
    channel_idx: number;
    timestamp: number;
  },
  row: {
    from_call: string | null;
    to_call_or_group: string | null;
    text: string;
    channel_idx: number;
    timestamp: number;
  },
): boolean {
  if (existing.text !== row.text) return false;
  if (existing.channel_idx !== row.channel_idx) return false;
  if (existing.timestamp !== row.timestamp) return false;
  const fromA = blankCall(existing.from_call);
  const fromB = blankCall(row.from_call);
  if (fromA && fromB && fromA !== fromB) return false;
  const toA = blankCall(existing.to_call_or_group);
  const toB = blankCall(row.to_call_or_group);
  if (toA && toB && toA !== toB) return false;
  return true;
}

function fitMeshcomMsgId(id: string): string {
  return id.length <= MAX_MSG_ID_LEN ? id : id.slice(0, MAX_MSG_ID_LEN);
}

/** New id when `baseId` already stores a different message. */
function mintDistinctMeshcomMsgId(
  db: NodeSqliteDB,
  identityId: string,
  baseId: string,
  timestamp: number,
): string {
  const stamp = `~${timestamp}`;
  const root = fitMeshcomMsgId(`${baseId}${stamp}`);
  for (let n = 0; n < 50; n++) {
    const candidate = fitMeshcomMsgId(n === 0 ? root : `${root}~${n}`);
    const hit = db
      .prepareOnce('SELECT 1 AS ok FROM meshcom_messages WHERE identity_id = ? AND msg_id = ?')
      .get(identityId, candidate) as { ok: number } | undefined;
    if (!hit) return candidate;
  }
  return root;
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

/** Validate `db:deleteMeshcomContact` args (throws on invalid fields). */
export function validateDeleteMeshcomContact(
  identityId: unknown,
  callsign: unknown,
): { identityId: string; callsign: string } {
  if (typeof identityId !== 'string' || !identityId.trim()) {
    throw new Error('db:deleteMeshcomContact: identityId must be a non-empty string');
  }
  if (identityId.length > MAX_IDENTITY_LEN) {
    throw new Error('db:deleteMeshcomContact: identityId too long');
  }
  if (typeof callsign !== 'string' || !callsign.trim()) {
    throw new Error('db:deleteMeshcomContact: callsign must be a non-empty string');
  }
  if (callsign.length > MAX_CALLSIGN_LEN) {
    throw new Error('db:deleteMeshcomContact: callsign too long');
  }
  return {
    identityId: identityId.trim().slice(0, MAX_IDENTITY_LEN),
    callsign: callsign.trim().slice(0, MAX_CALLSIGN_LEN).toUpperCase(),
  };
}

/**
 * Move MeshCom messages/contacts from one identity_id to another.
 * Pass `fromId` `*` to consolidate every non-`toId` bucket into `toId` (orphan recovery).
 *
 * Logical message identity for cross-bucket dedupe is
 * `(msg_id, from_call, to_call_or_group, text, channel_idx, timestamp)`. Same msg_id alone
 * is not enough (MeshCom firmware IDs wrap / collide) — colliding-but-distinct rows keep
 * both by reminting the source msg_id before the move.
 *
 * Contacts dedupe on callsign after merging source favorites / missing coords into dest
 * (same COALESCE / preserve-favorite spirit as saveMeshcomContact upsert).
 */
export function rebindMeshcomIdentityOn(
  db: NodeSqliteDB,
  fromIdRaw: unknown,
  toIdRaw: unknown,
): { changes: number } {
  if (typeof toIdRaw !== 'string' || !toIdRaw.trim()) {
    throw new Error('db:rebindMeshcomIdentity: toId must be a non-empty string');
  }
  if (toIdRaw.length > MAX_IDENTITY_LEN) {
    throw new Error('db:rebindMeshcomIdentity: toId too long');
  }
  if (typeof fromIdRaw !== 'string' || !fromIdRaw.trim()) {
    throw new Error('db:rebindMeshcomIdentity: fromId must be a non-empty string');
  }
  if (fromIdRaw.length > MAX_IDENTITY_LEN) {
    throw new Error('db:rebindMeshcomIdentity: fromId too long');
  }
  const toId = toIdRaw.trim().slice(0, MAX_IDENTITY_LEN);
  const fromId = fromIdRaw.trim().slice(0, MAX_IDENTITY_LEN);
  if (fromId === toId) return { changes: 0 };

  const sourceIds: string[] =
    fromId === '*'
      ? (
          db
            .prepareOnce(
              `SELECT DISTINCT identity_id AS id FROM meshcom_messages WHERE identity_id != ?
               UNION
               SELECT DISTINCT identity_id AS id FROM meshcom_contacts WHERE identity_id != ?`,
            )
            .all(toId, toId) as { id: string | null }[]
        )
          // Keep empty-string identity_id buckets (schema default); drop only non-strings / toId.
          .map((r) => r.id)
          .filter((id): id is string => typeof id === 'string' && id !== toId)
      : [fromId];

  let changes = 0;
  for (const source of sourceIds) {
    if (source === toId) continue;
    // True duplicates only — matching msg_id + sender + recipient + body + channel + timestamp.
    const dropMsg = db
      .prepareOnce(
        `DELETE FROM meshcom_messages
         WHERE identity_id = @fromId
           AND msg_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM meshcom_messages AS dest
             WHERE dest.identity_id = @toId
               AND dest.msg_id = meshcom_messages.msg_id
               AND IFNULL(dest.from_call, '') = IFNULL(meshcom_messages.from_call, '')
               AND IFNULL(dest.to_call_or_group, '') = IFNULL(meshcom_messages.to_call_or_group, '')
               AND dest.text = meshcom_messages.text
               AND dest.channel_idx = meshcom_messages.channel_idx
               AND dest.timestamp = meshcom_messages.timestamp
           )`,
      )
      .run({ fromId: source, toId });
    changes += Number(dropMsg.changes);
    // msg_id-only collisions are distinct logical messages — remint before move.
    const remint = db
      .prepareOnce(
        `UPDATE meshcom_messages
         SET msg_id = msg_id || '-rb' || CAST(id AS TEXT)
         WHERE identity_id = @fromId
           AND msg_id IS NOT NULL
           AND msg_id IN (
             SELECT msg_id FROM meshcom_messages
             WHERE identity_id = @toId AND msg_id IS NOT NULL
           )`,
      )
      .run({ fromId: source, toId });
    changes += Number(remint.changes);
    const moveMsg = db
      .prepareOnce(`UPDATE meshcom_messages SET identity_id = @toId WHERE identity_id = @fromId`)
      .run({ fromId: source, toId });
    changes += Number(moveMsg.changes);

    // Fold source prefs into dest before dropping the source row (favorite wins; fill gaps).
    const mergeContact = db
      .prepareOnce(
        `UPDATE meshcom_contacts
         SET
           favorited = CASE
             WHEN favorited = 1 THEN 1
             WHEN (
               SELECT s.favorited FROM meshcom_contacts AS s
               WHERE s.identity_id = @fromId AND s.callsign = meshcom_contacts.callsign
             ) = 1 THEN 1
             ELSE favorited
           END,
           lat = COALESCE(
             lat,
             (SELECT s.lat FROM meshcom_contacts AS s
              WHERE s.identity_id = @fromId AND s.callsign = meshcom_contacts.callsign)
           ),
           lon = COALESCE(
             lon,
             (SELECT s.lon FROM meshcom_contacts AS s
              WHERE s.identity_id = @fromId AND s.callsign = meshcom_contacts.callsign)
           ),
           batt = COALESCE(
             batt,
             (SELECT s.batt FROM meshcom_contacts AS s
              WHERE s.identity_id = @fromId AND s.callsign = meshcom_contacts.callsign)
           ),
           hw_id = COALESCE(
             hw_id,
             (SELECT s.hw_id FROM meshcom_contacts AS s
              WHERE s.identity_id = @fromId AND s.callsign = meshcom_contacts.callsign)
           ),
           last_heard = CASE
             WHEN (
               SELECT s.last_heard FROM meshcom_contacts AS s
               WHERE s.identity_id = @fromId AND s.callsign = meshcom_contacts.callsign
             ) IS NOT NULL
             AND (
               last_heard IS NULL
               OR (
                 SELECT s.last_heard FROM meshcom_contacts AS s
                 WHERE s.identity_id = @fromId AND s.callsign = meshcom_contacts.callsign
               ) > last_heard
             )
             THEN (
               SELECT s.last_heard FROM meshcom_contacts AS s
               WHERE s.identity_id = @fromId AND s.callsign = meshcom_contacts.callsign
             )
             ELSE last_heard
           END,
           node_id = CASE
             WHEN node_id = 0 THEN COALESCE(
               NULLIF((
                 SELECT s.node_id FROM meshcom_contacts AS s
                 WHERE s.identity_id = @fromId AND s.callsign = meshcom_contacts.callsign
               ), 0),
               node_id
             )
             ELSE node_id
           END
         WHERE identity_id = @toId
           AND callsign IN (
             SELECT callsign FROM meshcom_contacts WHERE identity_id = @fromId
           )`,
      )
      .run({ fromId: source, toId });
    changes += Number(mergeContact.changes);

    const dropContact = db
      .prepareOnce(
        `DELETE FROM meshcom_contacts
         WHERE identity_id = @fromId
           AND callsign IN (
             SELECT callsign FROM meshcom_contacts WHERE identity_id = @toId
           )`,
      )
      .run({ fromId: source, toId });
    changes += Number(dropContact.changes);
    const moveContact = db
      .prepareOnce(`UPDATE meshcom_contacts SET identity_id = @toId WHERE identity_id = @fromId`)
      .run({ fromId: source, toId });
    changes += Number(moveContact.changes);
  }
  return { changes };
}

export interface MeshcomDbIpcDeps {
  ipcMain: IpcMain;
}

/** Insert or update one MeshCom message. A colliding wire id with different content is reminted. */
export function persistMeshcomMessage(
  db: NodeSqliteDB,
  m: MeshcomMessageInput,
): { changes: number } {
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
  // Same msg_id is an update only when sender/text/channel/timestamp match.
  // Wrapped firmware ids and EXTUDP "1" vs outbound "1" insert under a new id.
  if (row.msg_id) {
    const existing = db
      .prepareOnce(
        `SELECT from_call, to_call_or_group, text, channel_idx, timestamp
         FROM meshcom_messages
         WHERE identity_id = ? AND msg_id = ?`,
      )
      .get(row.identity_id, row.msg_id) as
      | {
          from_call: string | null;
          to_call_or_group: string | null;
          text: string;
          channel_idx: number;
          timestamp: number;
        }
      | undefined;
    if (existing && meshcomStoredMessageMatches(existing, row)) {
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
      if (updated.changes > 0) return { changes: Number(updated.changes) };
    } else if (existing) {
      row.msg_id = mintDistinctMeshcomMsgId(db, row.identity_id, row.msg_id, row.timestamp);
    }
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
  pruneMeshcomMessagesByCountOn(db, meshcomMessageRetentionCap);
  return { changes: Number(result.changes) };
}

export function registerMeshcomDbIpcHandlers({ ipcMain }: MeshcomDbIpcDeps): void {
  ipcMain.handle('meshcom:db-degraded', (event) => {
    assertIpcSender(event, MESHCOM_DB_DEGRADED_CHANNEL);
    const payload: MeshcomDbDegradedPayload = { degraded: false };
    return payload;
  });
  ipcMain.handle(
    'db:getMeshcomMessages',
    (event, identityId?: unknown, channelIdx?: unknown, limit = 200) => {
      try {
        assertIpcSender(event, 'db:getMeshcomMessages');
        const safeLimit = clampQueryLimit(limit, { default: 200, max: 10_000 });
        const db = getDbForIpc('db:getMeshcomMessages');
        if (!db) return [];
        if (typeof identityId !== 'string' || !identityId.trim()) {
          throw new Error('db:getMeshcomMessages: identityId required');
        }
        const identity = identityId.trim().slice(0, MAX_IDENTITY_LEN);
        const channel =
          channelIdx == null || channelIdx === ''
            ? null
            : Number.isFinite(Number(channelIdx))
              ? Math.trunc(Number(channelIdx))
              : null;

        if (channel != null) {
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
        const rows = db
          .prepareOnce(
            `SELECT * FROM meshcom_messages
             WHERE identity_id = @identity
             ORDER BY timestamp DESC, id DESC LIMIT @limit`,
          )
          .all({ identity, limit: safeLimit }) as Record<string, unknown>[];
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
      const db = getDbForIpc('db:saveMeshcomMessage');
      if (!db) return { changes: 0 };
      return persistMeshcomMessage(db, message);
    } catch (err) {
      finishDbIpcHandler('db:saveMeshcomMessage', err);
    }
  });

  ipcMain.handle('db:updateMeshcomMessageStatus', (event, args: unknown) => {
    if (!validateIpcSender(event)) {
      throw new Error('db:updateMeshcomMessageStatus: unauthorized sender');
    }
    try {
      if (!args || typeof args !== 'object') {
        throw new Error('db:updateMeshcomMessageStatus: args must be an object');
      }
      const a = args as Record<string, unknown>;
      const identityId = clampStr(a.identity_id, MAX_IDENTITY_LEN);
      const msgId = clampStr(a.msg_id, MAX_MSG_ID_LEN);
      const status = clampStr(a.status, MAX_STATUS_LEN);
      if (!identityId || !msgId || !status) {
        throw new Error('db:updateMeshcomMessageStatus: identity_id, msg_id, and status required');
      }
      const db = getDbForIpc('db:updateMeshcomMessageStatus');
      if (!db) return { changes: 0 };
      const result = db
        .prepareOnce(
          `UPDATE meshcom_messages SET status = @status
             WHERE identity_id = @identity_id AND msg_id = @msg_id`,
        )
        .run({ identity_id: identityId, msg_id: msgId, status });
      return { changes: result.changes };
    } catch (err) {
      finishDbIpcHandler('db:updateMeshcomMessageStatus', err);
    }
  });

  ipcMain.handle('db:pruneMeshcomMessagesByCount', (event, maxCount: unknown) => {
    try {
      assertIpcSender(event, 'db:pruneMeshcomMessagesByCount');
      const db = getDbForIpc('db:pruneMeshcomMessagesByCount');
      if (!db) return { changes: 0 };
      const cap = clampMeshcomRetentionCap(maxCount);
      if (cap == null) return { changes: 0 };
      meshcomMessageRetentionCap = cap;
      const changes = pruneMeshcomMessagesByCountOn(db, cap);
      if (changes > 0) {
        console.debug(
          `[IPC] db:pruneMeshcomMessagesByCount: pruned ${changes} messages, keeping newest ${cap}`,
        );
      }
      return { changes };
    } catch (err) {
      finishDbIpcHandler('db:pruneMeshcomMessagesByCount', err);
    }
  });

  ipcMain.handle('db:getMeshcomContacts', (event, identityId?: unknown) => {
    try {
      assertIpcSender(event, 'db:getMeshcomContacts');
      const db = getDbForIpc('db:getMeshcomContacts');
      if (!db) return [];
      if (typeof identityId !== 'string' || !identityId.trim()) {
        throw new Error('db:getMeshcomContacts: identityId required');
      }
      const identity = identityId.trim().slice(0, MAX_IDENTITY_LEN);
      return db
        .prepareOnce(
          'SELECT * FROM meshcom_contacts WHERE identity_id = ? ORDER BY last_heard DESC',
        )
        .all(identity);
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
      pruneMeshcomContactsByCountOn(db, meshcomContactCap);
      return { changes: result.changes };
    } catch (err) {
      finishDbIpcHandler('db:saveMeshcomContact', err);
    }
  });

  ipcMain.handle('db:pruneMeshcomContactsByCount', (event, maxCount: unknown) => {
    try {
      assertIpcSender(event, 'db:pruneMeshcomContactsByCount');
      const db = getDbForIpc('db:pruneMeshcomContactsByCount');
      if (!db) return { changes: 0 };
      const cap = clampMeshcomContactCap(maxCount);
      if (cap == null) return { changes: 0 };
      meshcomContactCap = cap;
      const changes = pruneMeshcomContactsByCountOn(db, cap);
      if (changes > 0) {
        console.debug(
          `[IPC] db:pruneMeshcomContactsByCount: pruned ${changes} contacts, keeping ${cap}`,
        );
      }
      return { changes };
    } catch (err) {
      finishDbIpcHandler('db:pruneMeshcomContactsByCount', err);
    }
  });

  ipcMain.handle('db:deleteMeshcomContact', (event, identityId: unknown, callsign: unknown) => {
    if (!validateIpcSender(event)) throw new Error('db:deleteMeshcomContact: unauthorized sender');
    try {
      const args = validateDeleteMeshcomContact(identityId, callsign);
      const db = getDbForIpc('db:deleteMeshcomContact');
      if (!db) return { changes: 0 };
      const result = db
        .prepareOnce('DELETE FROM meshcom_contacts WHERE identity_id = ? AND callsign = ?')
        .run(args.identityId, args.callsign);
      return { changes: Number(result.changes) };
    } catch (err) {
      finishDbIpcHandler('db:deleteMeshcomContact', err);
    }
  });

  ipcMain.handle('db:rebindMeshcomIdentity', (event, fromId: unknown, toId: unknown) => {
    if (!validateIpcSender(event)) throw new Error('db:rebindMeshcomIdentity: unauthorized sender');
    try {
      const db = getDbForIpc('db:rebindMeshcomIdentity');
      if (!db) return { changes: 0 };
      return rebindMeshcomIdentityOn(db, fromId, toId);
    } catch (err) {
      finishDbIpcHandler('db:rebindMeshcomIdentity', err);
    }
  });
}

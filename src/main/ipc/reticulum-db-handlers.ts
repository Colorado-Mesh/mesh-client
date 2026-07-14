import type { IpcMain } from 'electron';

import { isMeshProtocol } from '../../shared/meshProtocol';
import { sanitizeReticulumDisplayNameForDb } from '../../shared/reticulumDisplayName';
import { finishDbIpcHandler, getDbForIpc } from '../db-ipc-lifecycle';
import { buildFtsMatchQuery, isMessageFtsReady } from '../messageFts';
import { sanitizeReticulumAttachmentPathForDb } from '../reticulum-attachment-path';
import { assertIpcSender } from '../validate-ipc-sender';

const ALLOWED_DELIVERY_STATUS = new Set([
  'sending',
  'pending',
  'delivered',
  'failed',
  'received',
  'queued',
]);

const RETICULUM_VIA_ATOMS = new Set(['rf', 'ble', 'tcp', 'network', 'mqtt', 'both']);
const RETICULUM_MULTI_VIA_ATOMS = new Set(['ble', 'rf', 'tcp', 'network']);

/** Single atom or explicit `+`-joined multi-egress (e.g. `rf+tcp`). */
export function isAllowedReticulumReceivedVia(value: string): boolean {
  if (RETICULUM_VIA_ATOMS.has(value)) return true;
  const parts = value.split('+');
  if (parts.length < 2 || parts.length > 4) return false;
  return parts.every((p) => RETICULUM_MULTI_VIA_ATOMS.has(p));
}

export interface ReticulumDbIpcDeps {
  ipcMain: IpcMain;
}

export function registerReticulumDbIpcHandlers({ ipcMain }: ReticulumDbIpcDeps): void {
  ipcMain.handle('db:getReticulumMessages', (event, identityId: string, limit = 500) => {
    try {
      assertIpcSender(event, 'db:getReticulumMessages');
      if (typeof identityId !== 'string' || identityId.length > 128) return [];
      const safeLimit = Math.min(Math.max(1, Number(limit) || 500), 10000);
      const db = getDbForIpc('db:getReticulumMessages');
      if (!db) return [];
      const rows = db
        .prepareOnce(
          'SELECT * FROM reticulum_messages WHERE identity_id = ? ORDER BY timestamp DESC LIMIT ?',
        )
        .all(identityId, safeLimit) as Record<string, unknown>[];
      rows.reverse();
      return rows;
    } catch (err) {
      finishDbIpcHandler('db:getReticulumMessages', err);
    }
  });

  ipcMain.handle('db:saveReticulumMessage', (event, message: unknown) => {
    try {
      assertIpcSender(event, 'db:saveReticulumMessage');
      if (!message || typeof message !== 'object') {
        throw new Error('db:saveReticulumMessage: message must be an object');
      }
      const m = message as Record<string, unknown>;
      const identityId = m.identity_id;
      const senderId = m.sender_id;
      const payload = m.payload;
      if (typeof identityId !== 'string' || identityId.length > 128) {
        throw new Error('db:saveReticulumMessage: identity_id invalid');
      }
      if (typeof senderId !== 'string' || senderId.length > 128) {
        throw new Error('db:saveReticulumMessage: sender_id invalid');
      }
      if (typeof payload !== 'string' || payload.length > 65536) {
        throw new Error('db:saveReticulumMessage: payload invalid');
      }
      const timestamp = Number(m.timestamp);
      if (!Number.isFinite(timestamp)) {
        throw new Error('db:saveReticulumMessage: timestamp invalid');
      }
      const receivedVia =
        typeof m.received_via === 'string' && isAllowedReticulumReceivedVia(m.received_via)
          ? m.received_via.slice(0, 64)
          : null;
      const db = getDbForIpc('db:saveReticulumMessage');
      if (!db) return { changes: 0 };
      const messageHash = typeof m.message_hash === 'string' ? m.message_hash.slice(0, 128) : null;
      const deliveryStatus =
        typeof m.delivery_status === 'string' && ALLOWED_DELIVERY_STATUS.has(m.delivery_status)
          ? m.delivery_status.slice(0, 32)
          : null;
      const truncatedTimestamp = Math.trunc(timestamp);
      const senderName = typeof m.sender_name === 'string' ? m.sender_name.slice(0, 128) : null;
      const toHash = typeof m.to_hash === 'string' ? m.to_hash.slice(0, 128) : null;
      const replyToHash =
        typeof m.reply_to_hash === 'string' ? m.reply_to_hash.slice(0, 128) : null;
      const attachmentPath = sanitizeReticulumAttachmentPathForDb(
        typeof m.attachment_path === 'string' ? m.attachment_path : null,
      );
      const deliveryAttempts =
        m.delivery_attempts != null && Number.isFinite(Number(m.delivery_attempts))
          ? Math.trunc(Number(m.delivery_attempts))
          : 0;
      const nextDeliveryAttemptAt =
        m.next_delivery_attempt_at != null && Number.isFinite(Number(m.next_delivery_attempt_at))
          ? Math.trunc(Number(m.next_delivery_attempt_at))
          : null;

      if (
        messageHash &&
        !messageHash.startsWith('reticulum-pending-') &&
        deliveryStatus &&
        deliveryStatus !== 'sending'
      ) {
        db.prepareOnce(
          `DELETE FROM reticulum_messages
           WHERE identity_id = ? AND sender_id = ? AND payload = ?
             AND message_hash LIKE 'reticulum-pending-%'
             AND ABS(timestamp - ?) <= 60000`,
        ).run(identityId, senderId, payload, truncatedTimestamp);
      }

      if (messageHash) {
        const existing = db
          .prepareOnce(
            'SELECT id FROM reticulum_messages WHERE identity_id = ? AND message_hash = ? LIMIT 1',
          )
          .get(identityId, messageHash) as { id?: number } | undefined;
        if (existing?.id != null) {
          db.prepareOnce(
            `UPDATE reticulum_messages
             SET delivery_status = COALESCE(?, delivery_status),
                 received_via = COALESCE(?, received_via),
                 sender_name = COALESCE(?, sender_name)
             WHERE id = ?`,
          ).run(deliveryStatus, receivedVia, senderName, existing.id);
          return { changes: 1 };
        }
      }

      db.prepareOnce(
        `INSERT INTO reticulum_messages (identity_id, sender_id, sender_name, payload, timestamp, to_hash, reply_to_hash, message_hash, received_via, delivery_status, delivery_attempts, next_delivery_attempt_at, attachment_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        identityId,
        senderId,
        senderName,
        payload,
        truncatedTimestamp,
        toHash,
        replyToHash,
        messageHash,
        receivedVia,
        deliveryStatus,
        deliveryAttempts,
        nextDeliveryAttemptAt,
        attachmentPath,
      );
      return { changes: 1 };
    } catch (err) {
      finishDbIpcHandler('db:saveReticulumMessage', err);
    }
  });

  ipcMain.handle('db:getReticulumDestinations', (event) => {
    try {
      assertIpcSender(event, 'db:getReticulumDestinations');
      const db = getDbForIpc('db:getReticulumDestinations');
      if (!db) return [];
      return db
        .prepareOnce('SELECT * FROM reticulum_destinations ORDER BY last_heard DESC')
        .all() as Record<string, unknown>[];
    } catch (err) {
      finishDbIpcHandler('db:getReticulumDestinations', err);
    }
  });

  ipcMain.handle('db:deleteReticulumDestination', (event, destinationHash: string) => {
    try {
      assertIpcSender(event, 'db:deleteReticulumDestination');
      if (typeof destinationHash !== 'string' || destinationHash.length > 128) {
        return { changes: 0 };
      }
      const db = getDbForIpc('db:deleteReticulumDestination');
      if (!db) return { changes: 0 };
      const result = db
        .prepareOnce('DELETE FROM reticulum_destinations WHERE destination_hash = ?')
        .run(destinationHash);
      return { changes: result.changes ?? 0 };
    } catch (err) {
      finishDbIpcHandler('db:deleteReticulumDestination', err);
    }
  });

  ipcMain.handle(
    'db:searchReticulumMessages',
    (event, identityId: string, query: string, limit = 200) => {
      try {
        assertIpcSender(event, 'db:searchReticulumMessages');
        if (typeof identityId !== 'string' || identityId.length > 128) return [];
        if (typeof query !== 'string' || query.length > 256) return [];
        const safeLimit = Math.min(Math.max(1, Number(limit) || 200), 5000);
        const db = getDbForIpc('db:searchReticulumMessages');
        if (!db) return [];
        const ftsQuery = buildFtsMatchQuery(query);
        if (ftsQuery && isMessageFtsReady(db)) {
          return db
            .prepareOnce(
              `SELECT r.* FROM reticulum_messages r
             INNER JOIN reticulum_messages_fts ON reticulum_messages_fts.rowid = r.id
             WHERE r.identity_id = ? AND reticulum_messages_fts MATCH ?
             ORDER BY r.timestamp DESC LIMIT ?`,
            )
            .all(identityId, ftsQuery, safeLimit) as Record<string, unknown>[];
        }
        const pattern = `%${query.replace(/[%_]/g, '')}%`;
        return db
          .prepareOnce(
            `SELECT * FROM reticulum_messages
           WHERE identity_id = ? AND payload LIKE ? COLLATE NOCASE
           ORDER BY timestamp DESC LIMIT ?`,
          )
          .all(identityId, pattern, safeLimit) as Record<string, unknown>[];
      } catch (err) {
        finishDbIpcHandler('db:searchReticulumMessages', err);
      }
    },
  );

  ipcMain.handle('db:deleteReticulumMessage', (event, identityId: string, messageHash: string) => {
    try {
      assertIpcSender(event, 'db:deleteReticulumMessage');
      if (typeof identityId !== 'string' || identityId.length > 128) return { changes: 0 };
      if (typeof messageHash !== 'string' || messageHash.length > 128) return { changes: 0 };
      const db = getDbForIpc('db:deleteReticulumMessage');
      if (!db) return { changes: 0 };
      const result = db
        .prepareOnce('DELETE FROM reticulum_messages WHERE identity_id = ? AND message_hash = ?')
        .run(identityId, messageHash);
      return { changes: result.changes ?? 0 };
    } catch (err) {
      finishDbIpcHandler('db:deleteReticulumMessage', err);
    }
  });

  ipcMain.handle('db:upsertReticulumDestination', (event, row: unknown) => {
    try {
      assertIpcSender(event, 'db:upsertReticulumDestination');
      if (!row || typeof row !== 'object') {
        throw new Error('db:upsertReticulumDestination: row must be an object');
      }
      const r = row as Record<string, unknown>;
      const hash = r.destination_hash;
      if (typeof hash !== 'string' || hash.length > 128) {
        throw new Error('db:upsertReticulumDestination: destination_hash invalid');
      }
      const db = getDbForIpc('db:upsertReticulumDestination');
      if (!db) return { changes: 0 };
      db.prepareOnce(
        `INSERT INTO reticulum_destinations (destination_hash, display_name, last_heard, favorited, icon_name, icon_color)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(destination_hash) DO UPDATE SET
           display_name = CASE
             WHEN excluded.display_name IS NOT NULL
               AND excluded.display_name != ''
               AND LOWER(excluded.display_name) != LOWER(substr(reticulum_destinations.destination_hash, 1, 12))
             THEN excluded.display_name
             ELSE reticulum_destinations.display_name
           END,
           last_heard = COALESCE(excluded.last_heard, reticulum_destinations.last_heard),
           favorited = excluded.favorited,
           icon_name = COALESCE(excluded.icon_name, reticulum_destinations.icon_name),
           icon_color = COALESCE(excluded.icon_color, reticulum_destinations.icon_color)`,
      ).run(
        hash,
        typeof r.display_name === 'string'
          ? (sanitizeReticulumDisplayNameForDb(
              r.display_name.replace(/[\r\n]+/g, ' ').trim(),
            )?.slice(0, 128) ?? null)
          : null,
        r.last_heard != null && Number.isFinite(Number(r.last_heard))
          ? Math.trunc(Number(r.last_heard))
          : null,
        r.favorited === true || r.favorited === 1 ? 1 : 0,
        typeof r.icon_name === 'string' ? r.icon_name.slice(0, 64) : null,
        typeof r.icon_color === 'string' ? r.icon_color.slice(0, 32) : null,
      );
      return { changes: 1 };
    } catch (err) {
      finishDbIpcHandler('db:upsertReticulumDestination', err);
    }
  });

  ipcMain.handle(
    'db:markStaleReticulumOutbound',
    (event, identityId: string, staleAfterMs: number) => {
      try {
        assertIpcSender(event, 'db:markStaleReticulumOutbound');
        if (typeof identityId !== 'string' || identityId.length > 128) return { changes: 0 };
        const rawStale =
          typeof staleAfterMs === 'number' && Number.isFinite(staleAfterMs)
            ? staleAfterMs
            : 86_400_000;
        const staleMs = Math.min(Math.max(60_000, rawStale), 30 * 86_400_000);
        const cutoff = Date.now() - staleMs;
        const db = getDbForIpc('db:markStaleReticulumOutbound');
        if (!db) return { changes: 0 };
        const result = db
          .prepareOnce(
            `UPDATE reticulum_messages
           SET delivery_status = 'failed'
           WHERE identity_id = ?
             AND delivery_status IN ('sending', 'pending', 'queued')
             AND timestamp < ?`,
          )
          .run(identityId, cutoff);
        return { changes: result.changes ?? 0 };
      } catch (err) {
        finishDbIpcHandler('db:markStaleReticulumOutbound', err);
      }
    },
  );

  ipcMain.handle('db:clearReticulumMessages', (event, identityId: string) => {
    try {
      assertIpcSender(event, 'db:clearReticulumMessages');
      if (typeof identityId !== 'string' || identityId.length > 128) return { changes: 0 };
      const db = getDbForIpc('db:clearReticulumMessages');
      if (!db) return { changes: 0 };
      const result = db
        .prepareOnce('DELETE FROM reticulum_messages WHERE identity_id = ?')
        .run(identityId);
      return { changes: result.changes ?? 0 };
    } catch (err) {
      finishDbIpcHandler('db:clearReticulumMessages', err);
    }
  });

  /** Clear LXMF contact marker (last_heard); keeps display_name / favorite / icon peer meta. */
  ipcMain.handle('db:clearReticulumContactDestinations', (event) => {
    try {
      assertIpcSender(event, 'db:clearReticulumContactDestinations');
      const db = getDbForIpc('db:clearReticulumContactDestinations');
      if (!db) return { changes: 0 };
      const result = db
        .prepareOnce(
          'UPDATE reticulum_destinations SET last_heard = NULL WHERE last_heard IS NOT NULL',
        )
        .run();
      return { changes: result.changes ?? 0 };
    } catch (err) {
      finishDbIpcHandler('db:clearReticulumContactDestinations', err);
    }
  });

  ipcMain.handle('db:pruneReticulumMessagesByCount', (event, maxCount: number) => {
    try {
      assertIpcSender(event, 'db:pruneReticulumMessagesByCount');
      const db = getDbForIpc('db:pruneReticulumMessagesByCount');
      if (!db) return { changes: 0 };
      if (typeof maxCount !== 'number' || maxCount < 100 || !Number.isFinite(maxCount)) {
        return { changes: 0 };
      }
      const cap = Math.floor(maxCount);
      const result = db
        .prepareOnce(
          'DELETE FROM reticulum_messages WHERE id NOT IN (SELECT id FROM reticulum_messages ORDER BY timestamp DESC, id DESC LIMIT ?)',
        )
        .run(cap);
      if (result.changes > 0) {
        console.debug(
          `[IPC] db:pruneReticulumMessagesByCount: pruned ${result.changes} messages, keeping newest ${cap}`,
        );
      }
      return { changes: Number(result.changes) };
    } catch (err) {
      finishDbIpcHandler('db:pruneReticulumMessagesByCount', err);
    }
  });

  ipcMain.handle('db:pruneReticulumDestinationsByCount', (event, maxCount: number) => {
    try {
      assertIpcSender(event, 'db:pruneReticulumDestinationsByCount');
      const db = getDbForIpc('db:pruneReticulumDestinationsByCount');
      if (!db) return { changes: 0 };
      const safeMax = typeof maxCount === 'number' && maxCount > 0 ? Math.floor(maxCount) : 10_000;
      const total = (
        db.prepareOnce('SELECT COUNT(*) as cnt FROM reticulum_destinations').get() as {
          cnt: number;
        }
      ).cnt;
      if (total <= safeMax) return { changes: 0 };
      const deletable = (
        db
          .prepareOnce(
            'SELECT COUNT(*) as cnt FROM reticulum_destinations WHERE (favorited IS NULL OR favorited = 0) AND last_heard IS NOT NULL',
          )
          .get() as { cnt: number }
      ).cnt;
      const toDelete = Math.min(total - safeMax, deletable);
      if (toDelete <= 0) return { changes: 0 };
      const result = db
        .prepareOnce(
          `DELETE FROM reticulum_destinations WHERE destination_hash IN (
            SELECT destination_hash FROM reticulum_destinations
            WHERE (favorited IS NULL OR favorited = 0) AND last_heard IS NOT NULL
            ORDER BY last_heard ASC LIMIT ?
          )`,
        )
        .run(toDelete);
      if (result.changes > 0) {
        console.debug(
          `[IPC] db:pruneReticulumDestinationsByCount: removed ${result.changes} excess destinations`,
        );
      }
      return { changes: Number(result.changes) };
    } catch (err) {
      finishDbIpcHandler('db:pruneReticulumDestinationsByCount', err);
    }
  });

  ipcMain.handle('db:deleteReticulumDestinationsByAge', (event, days: number) => {
    try {
      assertIpcSender(event, 'db:deleteReticulumDestinationsByAge');
      const db = getDbForIpc('db:deleteReticulumDestinationsByAge');
      if (!db) return { changes: 0 };
      const safeDays = typeof days === 'number' && days > 0 ? Math.floor(days) : 30;
      // reticulum_destinations.last_heard is Unix seconds (see persistReticulumContactFromPayload).
      const cutoff = Math.floor(Date.now() / 1000) - safeDays * 86_400;
      const result = db
        .prepareOnce(
          `DELETE FROM reticulum_destinations
           WHERE last_heard IS NOT NULL AND last_heard < ?
             AND (favorited IS NULL OR favorited = 0)`,
        )
        .run(cutoff);
      if (result.changes > 0) {
        console.debug(
          `[IPC] db:deleteReticulumDestinationsByAge: removed ${result.changes} destinations older than ${safeDays}d`,
        );
      }
      return { changes: Number(result.changes) };
    } catch (err) {
      finishDbIpcHandler('db:deleteReticulumDestinationsByAge', err);
    }
  });

  ipcMain.handle('db:pruneReticulumIdentityActivityByAge', (event, days: number) => {
    try {
      assertIpcSender(event, 'db:pruneReticulumIdentityActivityByAge');
      const db = getDbForIpc('db:pruneReticulumIdentityActivityByAge');
      if (!db) return { changes: 0 };
      const safeDays = typeof days === 'number' && days > 0 ? Math.floor(days) : 30;
      // Identity activity last_seen is epoch milliseconds (Date.now() / WS timestamps).
      const cutoff = Date.now() - safeDays * 86_400_000;
      const result = db
        .prepareOnce('DELETE FROM reticulum_identity_activity WHERE last_seen < ?')
        .run(cutoff);
      if (result.changes > 0) {
        console.debug(
          `[IPC] db:pruneReticulumIdentityActivityByAge: removed ${result.changes} activity rows older than ${safeDays}d`,
        );
      }
      return { changes: Number(result.changes) };
    } catch (err) {
      finishDbIpcHandler('db:pruneReticulumIdentityActivityByAge', err);
    }
  });

  ipcMain.handle('db:vacuumReticulumTables', (event) => {
    try {
      assertIpcSender(event, 'db:vacuumReticulumTables');
      const db = getDbForIpc('db:vacuumReticulumTables');
      if (!db) return { ok: false };
      db.execScript('VACUUM');
      return { ok: true };
    } catch (err) {
      finishDbIpcHandler('db:vacuumReticulumTables', err);
    }
  });

  ipcMain.handle('db:getBlockedContacts', (event, protocol: string, identityId: string) => {
    try {
      assertIpcSender(event, 'db:getBlockedContacts');
      if (!isMeshProtocol(protocol)) return [];
      if (typeof identityId !== 'string' || identityId.length > 128) return [];
      const db = getDbForIpc('db:getBlockedContacts');
      if (!db) return [];
      return db
        .prepareOnce(
          'SELECT blocked_hash, created_at FROM blocked_contacts WHERE protocol = ? AND identity_id = ? ORDER BY created_at DESC',
        )
        .all(protocol, identityId) as { blocked_hash: string; created_at: number }[];
    } catch (err) {
      finishDbIpcHandler('db:getBlockedContacts', err);
    }
  });

  ipcMain.handle(
    'db:blockContact',
    (event, protocol: string, identityId: string, blockedHash: string) => {
      try {
        assertIpcSender(event, 'db:blockContact');
        if (!isMeshProtocol(protocol)) return { changes: 0 };
        if (typeof identityId !== 'string' || identityId.length > 128) return { changes: 0 };
        if (typeof blockedHash !== 'string' || blockedHash.length > 128) return { changes: 0 };
        const db = getDbForIpc('db:blockContact');
        if (!db) return { changes: 0 };
        db.prepareOnce(
          `INSERT INTO blocked_contacts (protocol, identity_id, blocked_hash, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(protocol, identity_id, blocked_hash) DO NOTHING`,
        ).run(protocol, identityId, blockedHash.toLowerCase(), Date.now());
        return { changes: 1 };
      } catch (err) {
        finishDbIpcHandler('db:blockContact', err);
      }
    },
  );

  ipcMain.handle(
    'db:unblockContact',
    (event, protocol: string, identityId: string, blockedHash: string) => {
      try {
        assertIpcSender(event, 'db:unblockContact');
        if (!isMeshProtocol(protocol)) return { changes: 0 };
        if (typeof identityId !== 'string' || identityId.length > 128) return { changes: 0 };
        if (typeof blockedHash !== 'string' || blockedHash.length > 128) return { changes: 0 };
        const db = getDbForIpc('db:unblockContact');
        if (!db) return { changes: 0 };
        const result = db
          .prepareOnce(
            'DELETE FROM blocked_contacts WHERE protocol = ? AND identity_id = ? AND blocked_hash = ?',
          )
          .run(protocol, identityId, blockedHash.toLowerCase());
        return { changes: result.changes ?? 0 };
      } catch (err) {
        finishDbIpcHandler('db:unblockContact', err);
      }
    },
  );

  ipcMain.handle('db:getReticulumIdentityActivity', (event, destinationHash: string) => {
    try {
      assertIpcSender(event, 'db:getReticulumIdentityActivity');
      if (typeof destinationHash !== 'string' || destinationHash.length > 128) return [];
      const db = getDbForIpc('db:getReticulumIdentityActivity');
      if (!db) return [];
      return db
        .prepareOnce(
          'SELECT * FROM reticulum_identity_activity WHERE destination_hash = ? ORDER BY last_seen DESC',
        )
        .all(destinationHash.toLowerCase()) as Record<string, unknown>[];
    } catch (err) {
      finishDbIpcHandler('db:getReticulumIdentityActivity', err);
    }
  });

  const IDENTITY_ACTIVITY_UPSERT_SQL = `INSERT INTO reticulum_identity_activity (destination_hash, aspect, identity_hash, last_seen, hops)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(destination_hash, aspect) DO UPDATE SET
           identity_hash = COALESCE(excluded.identity_hash, reticulum_identity_activity.identity_hash),
           last_seen = excluded.last_seen,
           hops = COALESCE(excluded.hops, reticulum_identity_activity.hops)`;

  function parseIdentityActivityRow(row: unknown): {
    destinationHash: string;
    aspect: string;
    identityHash: string | null;
    lastSeen: number;
    hops: number | null;
  } | null {
    if (!row || typeof row !== 'object') return null;
    const r = row as Record<string, unknown>;
    const destinationHash = r.destination_hash;
    const aspect = r.aspect;
    if (typeof destinationHash !== 'string' || destinationHash.length > 128) return null;
    if (typeof aspect !== 'string' || aspect.length > 128) return null;
    const lastSeen = Number(r.last_seen);
    if (!Number.isFinite(lastSeen)) return null;
    const identityHash = typeof r.identity_hash === 'string' ? r.identity_hash.slice(0, 128) : null;
    const hops =
      r.hops != null && Number.isFinite(Number(r.hops)) ? Math.trunc(Number(r.hops)) : null;
    return {
      destinationHash: destinationHash.toLowerCase(),
      aspect: aspect.slice(0, 128),
      identityHash,
      lastSeen: Math.trunc(lastSeen),
      hops,
    };
  }

  ipcMain.handle('db:upsertReticulumIdentityActivity', (event, row: unknown) => {
    try {
      assertIpcSender(event, 'db:upsertReticulumIdentityActivity');
      const parsed = parseIdentityActivityRow(row);
      if (!parsed) return { changes: 0 };
      const db = getDbForIpc('db:upsertReticulumIdentityActivity');
      if (!db) return { changes: 0 };
      db.prepareOnce(IDENTITY_ACTIVITY_UPSERT_SQL).run(
        parsed.destinationHash,
        parsed.aspect,
        parsed.identityHash,
        parsed.lastSeen,
        parsed.hops,
      );
      return { changes: 1 };
    } catch (err) {
      finishDbIpcHandler('db:upsertReticulumIdentityActivity', err);
    }
  });

  ipcMain.handle('db:upsertReticulumIdentityActivityBatch', (event, rows: unknown) => {
    try {
      assertIpcSender(event, 'db:upsertReticulumIdentityActivityBatch');
      if (!Array.isArray(rows) || rows.length === 0) return { changes: 0 };
      const db = getDbForIpc('db:upsertReticulumIdentityActivityBatch');
      if (!db) return { changes: 0 };
      const parsed: NonNullable<ReturnType<typeof parseIdentityActivityRow>>[] = [];
      for (const row of rows.slice(0, 500)) {
        const p = parseIdentityActivityRow(row);
        if (p) parsed.push(p);
      }
      if (parsed.length === 0) return { changes: 0 };
      const stmt = db.prepareOnce(IDENTITY_ACTIVITY_UPSERT_SQL);
      const run = db.transaction(() => {
        for (const p of parsed) {
          stmt.run(p.destinationHash, p.aspect, p.identityHash, p.lastSeen, p.hops);
        }
      });
      run();
      return { changes: parsed.length };
    } catch (err) {
      finishDbIpcHandler('db:upsertReticulumIdentityActivityBatch', err);
    }
  });
}

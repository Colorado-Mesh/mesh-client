import type { IpcMain } from 'electron';

import { isMeshProtocol } from '../../shared/meshProtocol';
import { finishDbIpcHandler, getDbForIpc } from '../db-ipc-lifecycle';
import { buildFtsMatchQuery, isMessageFtsReady } from '../messageFts';

export interface ReticulumDbIpcDeps {
  ipcMain: IpcMain;
}

export function registerReticulumDbIpcHandlers({ ipcMain }: ReticulumDbIpcDeps): void {
  ipcMain.handle('db:getReticulumMessages', (_event, identityId: string, limit = 500) => {
    try {
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

  ipcMain.handle('db:saveReticulumMessage', (_event, message: unknown) => {
    try {
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
        typeof m.received_via === 'string' &&
        ['rf', 'tcp', 'network', 'mqtt', 'both'].includes(m.received_via)
          ? m.received_via
          : null;
      const db = getDbForIpc('db:saveReticulumMessage');
      if (!db) return { changes: 0 };
      const messageHash = typeof m.message_hash === 'string' ? m.message_hash.slice(0, 128) : null;
      const deliveryStatus =
        typeof m.delivery_status === 'string' ? m.delivery_status.slice(0, 32) : null;
      const truncatedTimestamp = Math.trunc(timestamp);
      const senderName = typeof m.sender_name === 'string' ? m.sender_name.slice(0, 128) : null;
      const toHash = typeof m.to_hash === 'string' ? m.to_hash.slice(0, 128) : null;
      const replyToHash =
        typeof m.reply_to_hash === 'string' ? m.reply_to_hash.slice(0, 128) : null;
      const attachmentPath =
        typeof m.attachment_path === 'string' ? m.attachment_path.slice(0, 512) : null;
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

  ipcMain.handle('db:getReticulumDestinations', () => {
    try {
      const db = getDbForIpc('db:getReticulumDestinations');
      if (!db) return [];
      return db
        .prepareOnce('SELECT * FROM reticulum_destinations ORDER BY last_heard DESC')
        .all() as Record<string, unknown>[];
    } catch (err) {
      finishDbIpcHandler('db:getReticulumDestinations', err);
    }
  });

  ipcMain.handle('db:deleteReticulumDestination', (_event, destinationHash: string) => {
    try {
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
    (_event, identityId: string, query: string, limit = 200) => {
      try {
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

  ipcMain.handle('db:deleteReticulumMessage', (_event, identityId: string, messageHash: string) => {
    try {
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

  ipcMain.handle('db:upsertReticulumDestination', (_event, row: unknown) => {
    try {
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
           display_name = COALESCE(excluded.display_name, reticulum_destinations.display_name),
           last_heard = COALESCE(excluded.last_heard, reticulum_destinations.last_heard),
           favorited = excluded.favorited,
           icon_name = COALESCE(excluded.icon_name, reticulum_destinations.icon_name),
           icon_color = COALESCE(excluded.icon_color, reticulum_destinations.icon_color)`,
      ).run(
        hash,
        typeof r.display_name === 'string' ? r.display_name.slice(0, 128) : null,
        r.last_heard != null && Number.isFinite(Number(r.last_heard))
          ? Math.trunc(Number(r.last_heard))
          : null,
        r.favorited ? 1 : 0,
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
    (_event, identityId: string, staleAfterMs: number) => {
      try {
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
             AND delivery_status IN ('sending', 'pending')
             AND timestamp < ?`,
          )
          .run(identityId, cutoff);
        return { changes: result.changes ?? 0 };
      } catch (err) {
        finishDbIpcHandler('db:markStaleReticulumOutbound', err);
      }
    },
  );

  ipcMain.handle('db:clearReticulumMessages', (_event, identityId: string) => {
    try {
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

  ipcMain.handle('db:vacuumReticulumTables', () => {
    try {
      const db = getDbForIpc('db:vacuumReticulumTables');
      if (!db) return { ok: false };
      db.execScript('VACUUM');
      return { ok: true };
    } catch (err) {
      finishDbIpcHandler('db:vacuumReticulumTables', err);
    }
  });

  ipcMain.handle('db:getBlockedContacts', (_event, protocol: string, identityId: string) => {
    try {
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
    (_event, protocol: string, identityId: string, blockedHash: string) => {
      try {
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
    (_event, protocol: string, identityId: string, blockedHash: string) => {
      try {
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

  ipcMain.handle('db:getReticulumIdentityActivity', (_event, destinationHash: string) => {
    try {
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

  ipcMain.handle('db:upsertReticulumIdentityActivity', (_event, row: unknown) => {
    try {
      if (!row || typeof row !== 'object') return { changes: 0 };
      const r = row as Record<string, unknown>;
      const destinationHash = r.destination_hash;
      const aspect = r.aspect;
      if (typeof destinationHash !== 'string' || destinationHash.length > 128)
        return { changes: 0 };
      if (typeof aspect !== 'string' || aspect.length > 128) return { changes: 0 };
      const lastSeen = Number(r.last_seen);
      if (!Number.isFinite(lastSeen)) return { changes: 0 };
      const identityHash =
        typeof r.identity_hash === 'string' ? r.identity_hash.slice(0, 128) : null;
      const hops =
        r.hops != null && Number.isFinite(Number(r.hops)) ? Math.trunc(Number(r.hops)) : null;
      const db = getDbForIpc('db:upsertReticulumIdentityActivity');
      if (!db) return { changes: 0 };
      db.prepareOnce(
        `INSERT INTO reticulum_identity_activity (destination_hash, aspect, identity_hash, last_seen, hops)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(destination_hash, aspect) DO UPDATE SET
           identity_hash = COALESCE(excluded.identity_hash, reticulum_identity_activity.identity_hash),
           last_seen = excluded.last_seen,
           hops = COALESCE(excluded.hops, reticulum_identity_activity.hops)`,
      ).run(
        destinationHash.toLowerCase(),
        aspect.slice(0, 128),
        identityHash,
        Math.trunc(lastSeen),
        hops,
      );
      return { changes: 1 };
    } catch (err) {
      finishDbIpcHandler('db:upsertReticulumIdentityActivity', err);
    }
  });
}

import type { IpcMain } from 'electron';

import { finishDbIpcHandler, getDbForIpc } from '../db-ipc-lifecycle';

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
      const db = getDbForIpc('db:saveReticulumMessage');
      if (!db) return { changes: 0 };
      db.prepareOnce(
        `INSERT INTO reticulum_messages (identity_id, sender_id, sender_name, payload, timestamp, to_hash, reply_to_hash, message_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        identityId,
        senderId,
        typeof m.sender_name === 'string' ? m.sender_name.slice(0, 128) : null,
        payload,
        Math.trunc(timestamp),
        typeof m.to_hash === 'string' ? m.to_hash.slice(0, 128) : null,
        typeof m.reply_to_hash === 'string' ? m.reply_to_hash.slice(0, 128) : null,
        typeof m.message_hash === 'string' ? m.message_hash.slice(0, 128) : null,
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

  ipcMain.handle(
    'db:searchReticulumMessages',
    (_event, identityId: string, query: string, limit = 200) => {
      try {
        if (typeof identityId !== 'string' || identityId.length > 128) return [];
        if (typeof query !== 'string' || query.length > 256) return [];
        const safeLimit = Math.min(Math.max(1, Number(limit) || 200), 5000);
        const db = getDbForIpc('db:searchReticulumMessages');
        if (!db) return [];
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
        `INSERT INTO reticulum_destinations (destination_hash, display_name, last_heard, favorited)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(destination_hash) DO UPDATE SET
           display_name = COALESCE(excluded.display_name, reticulum_destinations.display_name),
           last_heard = COALESCE(excluded.last_heard, reticulum_destinations.last_heard),
           favorited = excluded.favorited`,
      ).run(
        hash,
        typeof r.display_name === 'string' ? r.display_name.slice(0, 128) : null,
        r.last_heard != null && Number.isFinite(Number(r.last_heard))
          ? Math.trunc(Number(r.last_heard))
          : null,
        r.favorited ? 1 : 0,
      );
      return { changes: 1 };
    } catch (err) {
      finishDbIpcHandler('db:upsertReticulumDestination', err);
    }
  });
}

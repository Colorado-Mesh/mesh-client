import type { IpcMain } from 'electron';

import { isValidBlockedContactHash, normalizeBlockedHash } from '../../shared/blockedContactHash';
import { isMeshProtocol } from '../../shared/meshProtocol';
import { finishDbIpcHandler, getDbForIpc } from '../db-ipc-lifecycle';
import { assertIpcSender } from '../validate-ipc-sender';

/** Upper bound on a single blocklist import so a huge file cannot stall the DB. */
export const BLOCKED_CONTACTS_IMPORT_MAX = 10_000;

export interface BlockedContactsIpcDeps {
  ipcMain: IpcMain;
}

/** Per-identity blocked-contact list (`blocked_contacts` table) for Meshtastic and MeshCore. */
export function registerBlockedContactsIpcHandlers({ ipcMain }: BlockedContactsIpcDeps): void {
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

  ipcMain.handle('db:exportBlockedContacts', (event, protocol: string, identityId: string) => {
    try {
      assertIpcSender(event, 'db:exportBlockedContacts');
      if (!isMeshProtocol(protocol)) return [];
      if (typeof identityId !== 'string' || identityId.length > 128) return [];
      const db = getDbForIpc('db:exportBlockedContacts');
      if (!db) return [];
      const rows = db
        .prepareOnce(
          'SELECT blocked_hash FROM blocked_contacts WHERE protocol = ? AND identity_id = ? ORDER BY created_at DESC',
        )
        .all(protocol, identityId) as { blocked_hash: string }[];
      return rows.map((r) => r.blocked_hash);
    } catch (err) {
      finishDbIpcHandler('db:exportBlockedContacts', err);
    }
  });

  ipcMain.handle(
    'db:importBlockedContacts',
    (event, protocol: string, identityId: string, hashes: unknown) => {
      try {
        assertIpcSender(event, 'db:importBlockedContacts');
        if (!isMeshProtocol(protocol)) return { imported: 0, skipped: 0 };
        if (typeof identityId !== 'string' || identityId.length > 128) {
          return { imported: 0, skipped: 0 };
        }
        if (!Array.isArray(hashes)) return { imported: 0, skipped: 0 };
        if (hashes.length > BLOCKED_CONTACTS_IMPORT_MAX) {
          throw new Error(
            `db:importBlockedContacts: too many entries (max ${BLOCKED_CONTACTS_IMPORT_MAX})`,
          );
        }
        const db = getDbForIpc('db:importBlockedContacts');
        if (!db) return { imported: 0, skipped: 0 };

        // Strict validation: the lenient normalizer would otherwise persist junk.
        const valid: string[] = [];
        let skipped = 0;
        const seen = new Set<string>();
        for (const entry of hashes) {
          if (!isValidBlockedContactHash(entry)) {
            skipped += 1;
            continue;
          }
          const normalized = normalizeBlockedHash(entry as string);
          if (seen.has(normalized)) {
            skipped += 1;
            continue;
          }
          seen.add(normalized);
          valid.push(normalized);
        }

        // Real per-row `changes` gives accurate imported-vs-skipped counts, which
        // db:blockContact cannot report (it always returns 1).
        let imported = 0;
        db.transaction(() => {
          const stmt = db.prepareOnce(
            `INSERT INTO blocked_contacts (protocol, identity_id, blocked_hash, created_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(protocol, identity_id, blocked_hash) DO NOTHING`,
          );
          const now = Date.now();
          for (const hash of valid) {
            const result = stmt.run(protocol, identityId, hash, now);
            if ((result.changes ?? 0) > 0) imported += 1;
            else skipped += 1;
          }
        })();
        return { imported, skipped };
      } catch (err) {
        finishDbIpcHandler('db:importBlockedContacts', err);
      }
    },
  );
}

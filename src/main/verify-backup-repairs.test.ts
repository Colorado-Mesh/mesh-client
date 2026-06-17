// @vitest-environment node
import { copyFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { MESHCORE_CONTACT_HW_LABELS } from '../shared/meshcoreContactHwLabels';
import { NodeSqliteDB } from './db-compat';
import { runSchemaUpgrade } from './db-schema-sync';

const BACKUP_DIR = '/Users/joey/Downloads';
const BACKUPS = ['sanitized', 'neal', 'jjs'] as const;

describe('user backup repairs (local dumps)', () => {
  for (const name of BACKUPS) {
    it(`repairs ${name} backup in place on copy`, () => {
      const src = join(BACKUP_DIR, `mesh-client-backup-2026-06-17-${name}.db`);
      if (!existsSync(src)) {
        return;
      }
      const dst = join(tmpdir(), `mesh-verify-${name}-${Date.now()}.db`);
      copyFileSync(src, dst);

      const db = new NodeSqliteDB(dst);
      runSchemaUpgrade(db);

      const sending = (
        db
          .prepare("SELECT COUNT(*) as c FROM meshcore_messages WHERE status = 'sending'")
          .get() as { c: number }
      ).c;
      expect(sending).toBe(0);

      const placeholders = MESHCORE_CONTACT_HW_LABELS.map(() => '?').join(', ');
      const mcNodes = (
        db
          .prepare(`SELECT COUNT(*) as c FROM nodes WHERE hw_model IN (${placeholders})`)
          .get(...MESHCORE_CONTACT_HW_LABELS) as { c: number }
      ).c;
      expect(mcNodes).toBe(0);

      const nullStatus = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM messages
             WHERE status IS NULL AND received_via IS NOT NULL`,
          )
          .get() as { c: number }
      ).c;
      expect(nullStatus).toBe(0);

      db.close();
    });
  }
});

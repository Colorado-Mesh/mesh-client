// @vitest-environment node
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { meshcoreContactsAgeCutoffSec } from '../shared/meshcoreContactAgeCutoff';
import { NodeSqliteDB } from './db-compat';
import { runSchemaUpgrade } from './db-schema-sync';

const RECENT_PUBKEY = 'aa'.repeat(32);
const STALE_PUBKEY = 'bb'.repeat(32);

describe('meshcore_contacts age prune SQL cutoff', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('deletes only non-favorited contacts older than the cutoff (Unix seconds)', () => {
    const nowMs = 1_750_000_000_000;
    const cutoffSec = meshcoreContactsAgeCutoffSec(30, nowMs);
    expect(cutoffSec).not.toBeNull();
    if (cutoffSec === null) return;
    const recentSec = Math.floor(nowMs / 1000) - 86400;
    const staleSec = cutoffSec - 86_400;

    dir = mkdtempSync(join(tmpdir(), 'mesh-mc-age-prune-'));
    const db = new NodeSqliteDB(join(dir, 'test.db'));
    db.pragma('journal_mode = WAL');
    runSchemaUpgrade(db);

    const insert = db.prepareOnce(
      `INSERT INTO meshcore_contacts (node_id, public_key, last_advert, favorited, on_radio)
       VALUES (?, ?, ?, 0, 0)`,
    );
    insert.run(0x1111, RECENT_PUBKEY, recentSec);
    insert.run(0x2222, STALE_PUBKEY, staleSec);
    insert.run(0x3333, 'cc'.repeat(32), staleSec);
    db.prepareOnce('UPDATE meshcore_contacts SET favorited = 1 WHERE node_id = ?').run(0x3333);

    const deleted = db
      .prepareOnce(
        `DELETE FROM meshcore_contacts
         WHERE last_advert IS NOT NULL AND last_advert >= ? AND last_advert < ?
           AND (favorited IS NULL OR favorited = 0)`,
      )
      .run(1_000_000_000, cutoffSec).changes;

    expect(deleted).toBe(1);
    const remaining = db
      .prepareOnce('SELECT node_id FROM meshcore_contacts ORDER BY node_id')
      .all() as { node_id: number }[];
    expect(remaining.map((r) => r.node_id)).toEqual([0x1111, 0x3333]);
    db.close();
  });
});

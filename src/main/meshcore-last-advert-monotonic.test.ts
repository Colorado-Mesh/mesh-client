// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeSqliteDB } from './db-compat';
import { runSchemaUpgrade } from './db-schema-sync';

/**
 * database.ts / index.ts depend on Electron, so the real SQL strings are extracted from source and
 * executed against an in-memory schema to prove behavior (not just text shape).
 */
const DB_SOURCE = readFileSync(join(__dirname, 'database.ts'), 'utf-8');
const INDEX_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8');

function joinStringLiterals(expr: string): string {
  const parts: string[] = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) parts.push(m[1] ?? m[2]);
  return parts.join('');
}

function extractUpsertSql(): string {
  const m = /const MESHCORE_CONTACT_UPSERT_SQL =([\s\S]*?);\n/.exec(DB_SOURCE);
  if (!m) throw new Error('MESHCORE_CONTACT_UPSERT_SQL not found');
  return joinStringLiterals(m[1]);
}

function extractAdvertLastAdvertSql(): string {
  const m = /const lastAdvertSql =([\s\S]*?);\n/.exec(INDEX_SOURCE);
  if (!m) throw new Error('lastAdvertSql not found in db:updateMeshcoreContactAdvert');
  return joinStringLiterals(m[1]);
}

const NODE_ID = 4220452084;
const NOW_SEC = 1_791_501_107;
/** Rebooted repeater RTC reset to its firmware default (~220 days earlier). */
const REBOOTED_RTC_SEC = NOW_SEC - 220 * 86_400;

function contactRow(lastAdvert: number | null) {
  return {
    node_id: NODE_ID,
    public_key: 'bc'.repeat(32),
    adv_name: 'JC MINI RPTR 1',
    contact_type: 2,
    last_advert: lastAdvert,
    adv_lat: null,
    adv_lon: null,
    last_snr: null,
    last_rssi: null,
    nickname: null,
    contact_flags: 0,
    hops_away: 0,
    on_radio: 1,
    last_synced_from_radio: null,
  };
}

describe('meshcore_contacts.last_advert is monotonic', () => {
  let db: NodeSqliteDB;

  beforeEach(() => {
    db = new NodeSqliteDB(':memory:');
    runSchemaUpgrade(db);
  });

  afterEach(() => {
    db.close();
  });

  const readLastAdvert = () =>
    (
      db
        .prepareOnce('SELECT last_advert FROM meshcore_contacts WHERE node_id = ?')
        .get(NODE_ID) as {
        last_advert: number | null;
      }
    ).last_advert;

  it('contact upsert keeps the newer last_advert when the radio reports an older sender clock', () => {
    const upsert = db.prepareOnce(extractUpsertSql());
    upsert.run(contactRow(NOW_SEC));
    upsert.run(contactRow(REBOOTED_RTC_SEC));
    expect(readLastAdvert()).toBe(NOW_SEC);
  });

  it('contact upsert still advances last_advert and ignores null', () => {
    const upsert = db.prepareOnce(extractUpsertSql());
    upsert.run(contactRow(REBOOTED_RTC_SEC));
    upsert.run(contactRow(NOW_SEC));
    expect(readLastAdvert()).toBe(NOW_SEC);
    upsert.run(contactRow(null));
    expect(readLastAdvert()).toBe(NOW_SEC);
  });

  it('updateMeshcoreContactAdvert does not move last_advert backwards', () => {
    db.prepareOnce(extractUpsertSql()).run(contactRow(NOW_SEC));
    const update = db.prepareOnce(
      `UPDATE meshcore_contacts SET ${extractAdvertLastAdvertSql()} WHERE node_id = ?`,
    );
    update.run(REBOOTED_RTC_SEC, REBOOTED_RTC_SEC, REBOOTED_RTC_SEC, NODE_ID);
    expect(readLastAdvert()).toBe(NOW_SEC);
    update.run(NOW_SEC + 60, NOW_SEC + 60, NOW_SEC + 60, NODE_ID);
    expect(readLastAdvert()).toBe(NOW_SEC + 60);
    update.run(null, null, null, NODE_ID);
    expect(readLastAdvert()).toBe(NOW_SEC + 60);
  });
});

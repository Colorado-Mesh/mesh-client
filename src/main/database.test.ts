// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { escapeSqlLikePattern } from '../shared/sqlLikeEscape';

/**
 * Tests for deleteNodesWithoutLongname.
 *
 * database.ts depends on Electron (app.getPath) and a native better-sqlite3
 * build compiled for Electron's ABI, so we cannot call the function directly
 * in a plain Node test environment.
 *
 * Instead:
 *  1. We verify the SQL source contains the required placeholder condition.
 *  2. We verify the JS equivalent of SQLite's printf('!%08x', node_id) to
 *     confirm the pattern matches what emptyNode() generates.
 */

const DB_SOURCE = readFileSync(join(__dirname, 'database.ts'), 'utf-8');

describe('deleteNodesWithoutLongname SQL', () => {
  it('deletes NULL long_name', () => {
    expect(DB_SOURCE).toMatch(/DELETE FROM nodes.*long_name IS NULL/s);
  });

  it("deletes empty-string long_name via TRIM(long_name) = ''", () => {
    expect(DB_SOURCE).toMatch(/TRIM\(long_name\) = ''/);
  });

  it("deletes placeholder names via printf('!%08x', node_id)", () => {
    expect(DB_SOURCE).toContain("printf('!%08x', node_id)");
  });

  it('all three conditions appear in the same DELETE statement', () => {
    const match = /DELETE FROM nodes[^;]*long_name[^;]*/s.exec(DB_SOURCE);
    expect(match).not.toBeNull();
    const stmt = match![0];
    expect(stmt).toContain('long_name IS NULL');
    expect(stmt).toContain("TRIM(long_name) = ''");
    expect(stmt).toContain("printf('!%08x', node_id)");
  });

  it('does not delete favorited nodes', () => {
    expect(DB_SOURCE).toMatch(/favorited IS NULL OR favorited = 0/);
  });
});

/**
 * Tests for migrateRfStubNodes — verifies the one-time migration that renames
 * legacy "RF !xxxxxxxx" stub nodes to the standard "!xxxxxxxx" format.
 */
describe('migrateRfStubNodes SQL', () => {
  it('targets only nodes matching the legacy RF !xxxxxxxx pattern', () => {
    expect(DB_SOURCE).toMatch(/UPDATE nodes[^;]*LIKE 'RF !________'/s);
  });

  it('strips the 3-char "RF " prefix via substr(long_name, 4)', () => {
    const match = /UPDATE nodes[^;]*RF[^;]*/s.exec(DB_SOURCE);
    expect(match).not.toBeNull();
    expect(match![0]).toContain('substr(long_name, 4)');
  });

  it('clears short_name on migrated stub nodes', () => {
    const match = /UPDATE nodes[^;]*RF[^;]*/s.exec(DB_SOURCE);
    expect(match).not.toBeNull();
    expect(match![0]).toContain("short_name = ''");
  });

  it('JS substr equivalent strips "RF " correctly', () => {
    // Verifies the 3-char prefix arithmetic: SQLite substr(str, 4) = JS slice(3)
    const legacy = 'RF !be1f4697';
    expect(legacy.slice(3)).toBe('!be1f4697');
  });
});

/**
 * Verify the placeholder format that SQLite's printf('!%08x', node_id) produces.
 * This matches what emptyNode() generates in useDevice.ts.
 */
describe('placeholder name format', () => {
  function placeholder(nodeId: number): string {
    return '!' + (nodeId >>> 0).toString(16).padStart(8, '0');
  }

  it('produces !abcd1234 for node 0xabcd1234', () => {
    expect(placeholder(0xabcd1234)).toBe('!abcd1234');
  });

  it('produces !00000001 for node 0x1', () => {
    expect(placeholder(0x00000001)).toBe('!00000001');
  });

  it('produces !deadbeef for node 0xdeadbeef', () => {
    expect(placeholder(0xdeadbeef)).toBe('!deadbeef');
  });

  it('placeholder for node A does not equal placeholder for node B', () => {
    expect(placeholder(0xabcd1234)).not.toBe(placeholder(0x00000001));
  });

  it('a real name is never equal to its own placeholder', () => {
    // Ensures the condition only matches auto-generated names
    expect('Alice').not.toMatch(/^![0-9a-f]{8}$/);
    expect('MyNode').not.toMatch(/^![0-9a-f]{8}$/);
  });
});

/**
 * MeshCore message dedup + fresh-install stamp — INSERT OR IGNORE must not drop
 * distinct lines that share sender + second-resolution timestamp + channel only.
 * Fresh installs skip runMigrations(), so base DDL + user_version must match latest stamp.
 */
describe('meshcore_messages dedup index and fresh DB version', () => {
  it('createBaseTables defines idx_mc_msg_dedup including payload', () => {
    expect(DB_SOURCE).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_mc_msg_dedup\s+ON meshcore_messages\(sender_id, timestamp, channel_idx, payload\)/s,
    );
  });

  it('createBaseTables defines meshcore_contacts.contact_flags', () => {
    expect(DB_SOURCE).toMatch(/meshcore_contacts.*contact_flags INTEGER DEFAULT 0/s);
  });

  it('fresh DB init stamps user_version 20 inside isFreshDb', () => {
    expect(DB_SOURCE).toMatch(/if \(isFreshDb\) \{[\s\S]*?pragma\('user_version = 20'\)/);
  });

  it('createBaseTables defines protocol-neutral contact_groups tables', () => {
    expect(DB_SOURCE).toMatch(/CREATE TABLE IF NOT EXISTS contact_groups/s);
    expect(DB_SOURCE).toMatch(/CREATE TABLE IF NOT EXISTS contact_group_members/s);
  });
});

/**
 * Tests for saveNode UPSERT — ensures partial node updates preserve existing data
 * instead of overwriting with null/empty values.
 */
describe('saveNode UPSERT COALESCE preservation', () => {
  const INDEX_SOURCE = readFileSync(join(__dirname, '../main/index.ts'), 'utf-8');

  it('uses COALESCE for long_name to preserve existing values', () => {
    expect(INDEX_SOURCE).toMatch(
      /long_name = COALESCE\(NULLIF\(excluded\.long_name, ''\), nodes\.long_name\)/,
    );
  });

  it('uses COALESCE for short_name to preserve existing values', () => {
    expect(INDEX_SOURCE).toMatch(
      /short_name = COALESCE\(NULLIF\(excluded\.short_name, ''\), nodes\.short_name\)/,
    );
  });

  it('uses COALESCE for hw_model to preserve existing values', () => {
    expect(INDEX_SOURCE).toMatch(
      /hw_model = COALESCE\(NULLIF\(excluded\.hw_model, ''\), nodes\.hw_model\)/,
    );
  });

  it('uses COALESCE for snr to preserve existing values', () => {
    expect(INDEX_SOURCE).toMatch(/snr = COALESCE\(excluded\.snr, nodes\.snr\)/);
  });

  it('uses COALESCE for rssi to preserve existing values', () => {
    expect(INDEX_SOURCE).toMatch(/rssi = COALESCE\(excluded\.rssi, nodes\.rssi\)/);
  });

  it('uses COALESCE for battery to preserve existing values', () => {
    expect(INDEX_SOURCE).toMatch(/battery = COALESCE\(excluded\.battery, nodes\.battery\)/);
  });

  it('uses CASE for last_heard to only update when positive', () => {
    expect(INDEX_SOURCE).toMatch(
      /last_heard = CASE WHEN excluded\.last_heard IS NOT NULL AND excluded\.last_heard > 0/,
    );
  });

  it('uses CASE for latitude to only update when non-zero', () => {
    expect(INDEX_SOURCE).toMatch(
      /latitude = CASE WHEN excluded\.latitude IS NOT NULL AND excluded\.latitude != 0/,
    );
  });

  it('uses CASE for longitude to only update when non-zero', () => {
    expect(INDEX_SOURCE).toMatch(
      /longitude = CASE WHEN excluded\.longitude IS NOT NULL AND excluded\.longitude != 0/,
    );
  });

  it('uses COALESCE for voltage to preserve existing values', () => {
    expect(INDEX_SOURCE).toMatch(/voltage = COALESCE\(excluded\.voltage, nodes\.voltage\)/);
  });

  it('uses COALESCE for altitude to preserve existing values', () => {
    expect(INDEX_SOURCE).toMatch(/altitude = COALESCE\(excluded\.altitude, nodes\.altitude\)/);
  });
});

/**
 * Tests for saveMeshcoreContact UPSERT — ensures partial contact updates preserve existing data.
 */
describe('saveMeshcoreContact UPSERT COALESCE preservation', () => {
  const INDEX_SOURCE = readFileSync(join(__dirname, '../main/index.ts'), 'utf-8');

  it('uses COALESCE for adv_name to preserve existing values', () => {
    expect(INDEX_SOURCE).toMatch(
      /adv_name = COALESCE\(NULLIF\(excluded\.adv_name, ''\), meshcore_contacts\.adv_name\)/,
    );
  });

  it('uses COALESCE for last_advert to only update when positive', () => {
    expect(INDEX_SOURCE).toMatch(
      /last_advert = CASE WHEN excluded\.last_advert IS NOT NULL AND excluded\.last_advert > 0/,
    );
  });

  it('uses COALESCE for adv_lat to preserve existing values', () => {
    expect(INDEX_SOURCE).toMatch(
      /adv_lat = CASE WHEN excluded\.adv_lat IS NOT NULL AND excluded\.adv_lat != 0/,
    );
  });

  it('uses COALESCE for adv_lon to preserve existing values', () => {
    expect(INDEX_SOURCE).toMatch(
      /adv_lon = CASE WHEN excluded\.adv_lon IS NOT NULL AND excluded\.adv_lon != 0/,
    );
  });

  it('uses COALESCE for last_snr to preserve existing values', () => {
    expect(INDEX_SOURCE).toMatch(
      /last_snr = COALESCE\(excluded\.last_snr, meshcore_contacts\.last_snr\)/,
    );
  });

  it('uses COALESCE for last_rssi to preserve existing values', () => {
    expect(INDEX_SOURCE).toMatch(
      /last_rssi = COALESCE\(excluded\.last_rssi, meshcore_contacts\.last_rssi\)/,
    );
  });
});

describe('escapeSqlLikePattern', () => {
  it('escapes percent for LIKE wildcards', () => {
    expect(escapeSqlLikePattern('foo%bar')).toBe('foo\\%bar');
  });

  it('escapes underscore for LIKE wildcards', () => {
    expect(escapeSqlLikePattern('a_b')).toBe('a\\_b');
  });

  it('escapes backslashes first so later escapes are literal', () => {
    expect(escapeSqlLikePattern('x\\y%z')).toBe('x\\\\y\\%z');
  });

  it('leaves normal text unchanged', () => {
    expect(escapeSqlLikePattern('hello world')).toBe('hello world');
  });

  it('returns empty string for empty input', () => {
    expect(escapeSqlLikePattern('')).toBe('');
  });
});

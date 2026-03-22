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
    const match = DB_SOURCE.match(/DELETE FROM nodes[^;]*long_name[^;]*/s);
    expect(match).not.toBeNull();
    const stmt = match![0];
    expect(stmt).toContain('long_name IS NULL');
    expect(stmt).toContain("TRIM(long_name) = ''");
    expect(stmt).toContain("printf('!%08x', node_id)");
  });

  it('preserves nodes with a non-empty source (stub nodes heard via rf/mqtt)', () => {
    expect(DB_SOURCE).toMatch(/source IS NULL/);
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
    const match = DB_SOURCE.match(/UPDATE nodes[^;]*RF[^;]*/s);
    expect(match).not.toBeNull();
    expect(match![0]).toContain('substr(long_name, 4)');
  });

  it('clears short_name on migrated stub nodes', () => {
    const match = DB_SOURCE.match(/UPDATE nodes[^;]*RF[^;]*/s);
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
 * Fresh installs skip runMigrations(), so base DDL + user_version must match v17.
 */
describe('meshcore_messages dedup index and fresh DB version', () => {
  it('createBaseTables defines idx_mc_msg_dedup including payload', () => {
    expect(DB_SOURCE).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_mc_msg_dedup\s+ON meshcore_messages\(sender_id, timestamp, channel_idx, payload\)/s,
    );
  });

  it('fresh DB init stamps user_version 17 inside isFreshDb', () => {
    expect(DB_SOURCE).toMatch(/if \(isFreshDb\) \{[\s\S]*?pragma\('user_version = 17'\)/);
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

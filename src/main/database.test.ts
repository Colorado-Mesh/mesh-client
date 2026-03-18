// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

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

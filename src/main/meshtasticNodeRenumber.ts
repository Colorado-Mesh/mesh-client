import type { MigrateMeshtasticNodeNumResult } from '../shared/electron-api.types';
import { meshtasticNodeNumFromPublicKeyHex } from '../shared/meshtasticNodeNumFromPublicKey';
import { MESHTASTIC_BROADCAST_NODE_NUM } from '../shared/nodeNameUtils';
import type { NodeSqliteDB } from './db-compat';
import { sanitizeLogMessage } from './log-service';

const PUBLIC_KEY_HEX_RE = /^[0-9a-f]{64}$/;
const ZERO_KEY_HEX = '0'.repeat(64);

/** Normalized 64-hex Meshtastic public key, or null when absent, malformed, or all zeros. */
export function meshtasticNodePublicKeyHexOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const hex = raw.trim().toLowerCase();
  if (!PUBLIC_KEY_HEX_RE.test(hex) || hex === ZERO_KEY_HEX) return null;
  return hex;
}

function validNodeNum(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  const n = raw >>> 0;
  if (n !== raw || n === 0 || n === MESHTASTIC_BROADCAST_NODE_NUM >>> 0) return null;
  return n;
}

const NOT_MIGRATED: MigrateMeshtasticNodeNumResult = { migrated: false, messagesUpdated: 0 };

/**
 * Firmware 2.8 derives the node number from the public key, so a firmware upgrade (or
 * re-key) can move a known node to a new number. Move that node's history onto the new
 * number only when `newNum` is crc32 of the key and the stored row for `oldNum` carries
 * the same public key.
 *
 * Runs in one transaction: any failure rolls back and leaves both rows untouched.
 * Unique-index collisions (same packet already stored under the new number) keep the
 * new-number copy and drop the duplicate.
 */
export function migrateMeshtasticNodeNumInDb(
  db: NodeSqliteDB,
  oldNumRaw: unknown,
  newNumRaw: unknown,
  publicKeyHexRaw: unknown,
): MigrateMeshtasticNodeNumResult {
  const oldNum = validNodeNum(oldNumRaw);
  const newNum = validNodeNum(newNumRaw);
  const publicKeyHex = meshtasticNodePublicKeyHexOrNull(publicKeyHexRaw);
  if (oldNum === null || newNum === null || publicKeyHex === null || oldNum === newNum) {
    return NOT_MIGRATED;
  }
  if (meshtasticNodeNumFromPublicKeyHex(publicKeyHex) !== newNum) return NOT_MIGRATED;

  const oldRow = db
    .prepare('SELECT public_key, favorited FROM nodes WHERE node_id = ?')
    .get(oldNum) as { public_key: string | null; favorited: number | null } | undefined;
  if (oldRow?.public_key?.toLowerCase() !== publicKeyHex) return NOT_MIGRATED;
  const newRow = db.prepare('SELECT public_key FROM nodes WHERE node_id = ?').get(newNum) as
    { public_key: string | null } | undefined;
  const newRowKey = meshtasticNodePublicKeyHexOrNull(newRow?.public_key);
  if (newRowKey !== null && newRowKey !== publicKeyHex) return NOT_MIGRATED;

  try {
    return db.transaction(() => {
      const moved = db
        .prepare('UPDATE OR IGNORE messages SET sender_id = ? WHERE sender_id = ?')
        .run(newNum, oldNum).changes;
      db.prepare('DELETE FROM messages WHERE sender_id = ?').run(oldNum);
      const toMoved = db
        .prepare('UPDATE messages SET to_node = ? WHERE to_node = ?')
        .run(newNum, oldNum).changes;

      if (newRow) {
        db.prepare(
          `UPDATE nodes SET
             favorited = MAX(COALESCE(favorited, 0), ?),
             public_key = COALESCE(public_key, ?)
           WHERE node_id = ?`,
        ).run(oldRow.favorited ?? 0, publicKeyHex, newNum);
        db.prepare('DELETE FROM nodes WHERE node_id = ?').run(oldNum);
      } else {
        db.prepare('UPDATE nodes SET node_id = ? WHERE node_id = ?').run(newNum, oldNum);
      }

      db.prepare('UPDATE OR IGNORE node_notes SET node_id = ? WHERE node_id = ?').run(
        newNum,
        oldNum,
      );
      db.prepare('DELETE FROM node_notes WHERE node_id = ?').run(oldNum);
      db.prepare('UPDATE position_history SET node_id = ? WHERE node_id = ?').run(newNum, oldNum);
      db.prepare(
        "UPDATE node_environment_telemetry SET node_id = ? WHERE node_id = ? AND protocol = 'meshtastic'",
      ).run(newNum, oldNum);
      db.prepare(
        'UPDATE OR IGNORE contact_group_members SET contact_node_id = ? WHERE contact_node_id = ?',
      ).run(newNum, oldNum);
      db.prepare('DELETE FROM contact_group_members WHERE contact_node_id = ?').run(oldNum);
      db.prepare('UPDATE contact_groups SET self_node_id = ? WHERE self_node_id = ?').run(
        newNum,
        oldNum,
      );

      return { migrated: true, messagesUpdated: Number(moved) + Number(toMoved) };
    })();
  } catch (err) {
    console.warn(
      '[db] migrateMeshtasticNodeNum rolled back',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  }
}

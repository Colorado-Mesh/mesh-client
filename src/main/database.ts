import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import {
  MESHCORE_PATH_HISTORY_GLOBAL_ROW_LIMIT,
  MESHCORE_PATH_HISTORY_PER_NODE_ROW_LIMIT,
} from '../shared/meshcorePathHistoryLimits';
import { escapeSqlLikePattern } from '../shared/sqlLikeEscape';
import { NodeSqliteDB } from './db-compat';
import {
  CANONICAL_CREATE_ALL_DDL,
  CURRENT_SCHEMA_VERSION,
  runSchemaUpgrade,
} from './db-schema-sync';
import { sanitizeLogMessage } from './log-service';

/** Re-export for callers/tests that track the on-disk `user_version`. */
export { CURRENT_SCHEMA_VERSION };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

let db: NodeSqliteDB | null = null;

export function getDatabasePath(): string {
  return path.join(app.getPath('userData'), 'mesh-client.db');
}

export function initDatabase(): void {
  if (db) return;
  const dbPath = getDatabasePath();

  const dbDir = path.dirname(dbPath);
  try {
    fs.accessSync(dbDir, fs.constants.W_OK);
  } catch {
    throw new Error(
      `Database directory is not writable: ${dbDir}\n` +
        `Check folder permissions for your OS user account.`,
    );
  }

  try {
    db = new NodeSqliteDB(dbPath);
    // Restrict DB file to owner-only access (no-op on Windows)
    try {
      fs.chmodSync(dbPath, 0o600);
    } catch (e) {
      console.debug(
        '[db] chmod failed (non-fatal, expected on Windows):',
        e instanceof Error ? e.message : e,
      ); // log-injection-ok OS-level error from fs.chmodSync, not user input
    }
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');

    const setup = db.transaction(() => {
      const userVersion = db!.pragma('user_version', { simple: true }) as number;
      if (userVersion === 0) {
        createBaseTables();
        db!.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
      }
      runSchemaUpgrade(db!);
    });
    setup();

    const version = db.pragma('user_version', { simple: true });
    console.debug(
      `[db] Database initialized at ${sanitizeLogMessage(dbPath)} (user_version = ${version})`,
    );
  } catch (error) {
    console.error(
      '[db] Database init failed:',
      sanitizeLogMessage(error instanceof Error ? error.message : String(error)),
    );
    throw error;
  }
}

export function getDatabase(): NodeSqliteDB {
  if (!db) initDatabase();
  if (!db) throw new Error('[db] Database failed to initialize');
  return db;
}

export function prunePositionHistory(days: number): number {
  const d = getDatabase();
  const cutoff = Date.now() - days * MS_PER_DAY;
  const result = d.prepareOnce('DELETE FROM position_history WHERE recorded_at < ?').run(cutoff);
  return Number(result.changes);
}

export function deleteMeshcoreContactsNeverAdvertised(): number {
  const d = getDatabase();
  const result = d
    .prepareOnce(
      'DELETE FROM meshcore_contacts WHERE last_advert IS NULL AND (favorited IS NULL OR favorited = 0)',
    )
    .run();
  return Number(result.changes);
}

export function deleteMeshcoreContactsByAge(days: number): number {
  const d = getDatabase();
  const cutoff = Date.now() - days * MS_PER_DAY;
  const result = d
    .prepareOnce(
      'DELETE FROM meshcore_contacts WHERE last_advert IS NOT NULL AND last_advert < ? AND (favorited IS NULL OR favorited = 0)',
    )
    .run(cutoff);
  return Number(result.changes);
}

export function pruneMeshcoreContactsByCount(maxCount: number): number {
  const d = getDatabase();
  const total = (
    d.prepareOnce('SELECT COUNT(*) as cnt FROM meshcore_contacts').get() as { cnt: number }
  ).cnt;
  if (total <= maxCount) return 0;
  const result = d
    .prepareOnce(
      'DELETE FROM meshcore_contacts WHERE node_id IN (' +
        'SELECT node_id FROM meshcore_contacts WHERE (favorited IS NULL OR favorited = 0) ' +
        'ORDER BY COALESCE(last_advert, 0) ASC LIMIT ?' +
        ')',
    )
    .run(total - maxCount);
  return Number(result.changes);
}

function createBaseTables(): void {
  try {
    db!.execScript(CANONICAL_CREATE_ALL_DDL);
  } catch (error) {
    console.error(
      '[db] createBaseTables failed',
      sanitizeLogMessage(error instanceof Error ? error.message : String(error)),
    );
    throw new Error(
      `Failed to create base tables: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Export DB to a file. Best-effort for very large databases; may take a long time with no progress callback. */
export function exportDatabase(destPath: string): void {
  getDatabase(); // Ensure singleton initialized before snapshot connection opens same path.
  const snapshot = new NodeSqliteDB(getDatabasePath(), { readonly: true });
  try {
    snapshot.backup(destPath);
  } finally {
    snapshot.close();
  }
}

const MAX_MERGE_FILE_BYTES = 500 * 1024 * 1024; // 500 MB

export function mergeDatabase(sourcePath: string) {
  try {
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile() || stat.size > MAX_MERGE_FILE_BYTES) {
      throw new Error('Merge source must be a file under 500 MB');
    }
  } catch (err) {
    console.error(
      '[db] mergeDatabase failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    if (err instanceof Error && err.message === 'Merge source must be a file under 500 MB')
      throw err;
    throw new Error(
      `Cannot read merge source: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const targetDb = getDatabase();
  let sourceDb: NodeSqliteDB | undefined;

  try {
    sourceDb = new NodeSqliteDB(sourcePath, { readonly: true });

    return targetDb.transaction(() => {
      let nodesAdded = 0;
      let messagesAdded = 0;

      const insertNode = targetDb.prepare(`
        INSERT OR IGNORE INTO nodes (
          node_id, long_name, short_name, hw_model, snr, rssi, battery,
          last_heard, latitude, longitude, role, hops_away, via_mqtt,
          voltage, channel_utilization, air_util_tx, altitude
        ) VALUES (
          @node_id, @long_name, @short_name, @hw_model, @snr, @rssi, @battery,
          @last_heard, @latitude, @longitude, @role, @hops_away, @via_mqtt,
          @voltage, @channel_utilization, @air_util_tx, @altitude
        )
      `);

      const checkMessage = targetDb.prepare(
        'SELECT 1 FROM messages WHERE sender_id = ? AND timestamp = ? AND payload = ? LIMIT 1',
      );
      const insertMessage = targetDb.prepare(`
        INSERT INTO messages (
          sender_id, sender_name, payload, channel, timestamp,
          packet_id, status, error, emoji, reply_id, to_node
        ) VALUES (
          @sender_id, @sender_name, @payload, @channel, @timestamp,
          @packet_id, @status, @error, @emoji, @reply_id, @to_node
        )
      `);

      for (const node of sourceDb!.prepare('SELECT * FROM nodes').iterate()) {
        try {
          // Basic shape validation: must have a finite node_id; ignore obviously malformed rows.
          const nodeId = Number((node as { node_id?: unknown }).node_id);
          if (!Number.isFinite(nodeId)) {
            console.warn(
              '[db] mergeDatabase: skipping node row with invalid node_id:',
              sanitizeLogMessage(String((node as { node_id?: unknown }).node_id)),
            );
            continue;
          }
          if (insertNode.run(node).changes > 0) nodesAdded++;
        } catch (e) {
          console.warn(
            '[db] mergeDatabase: skipping node row due to error:',
            sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
          );
        }
      }

      for (const msg of sourceDb!.prepare('SELECT * FROM messages').iterate()) {
        try {
          const senderId = (msg as { sender_id?: unknown }).sender_id;
          const timestamp = (msg as { timestamp?: unknown }).timestamp;
          const payload = (msg as { payload?: unknown }).payload;
          if (!Number.isFinite(Number(timestamp)) || typeof payload !== 'string') {
            console.warn(
              '[db] mergeDatabase: skipping message row with invalid timestamp/payload:',
              sanitizeLogMessage(JSON.stringify({ senderId, timestamp })),
            );
            continue;
          }
          if (!checkMessage.get(senderId, timestamp, payload)) {
            insertMessage.run(msg);
            messagesAdded++;
          }
        } catch (e) {
          console.warn(
            '[db] mergeDatabase: skipping message row due to error:',
            sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
          );
        }
      }

      return { nodesAdded, messagesAdded };
    })();
  } catch (err) {
    console.error(
      '[db] Merge failed:',
      sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
    );
    throw err;
  } finally {
    if (sourceDb) sourceDb.close();
  }
}

export function searchMessages(query: string, limit = 50): unknown[] {
  const db = getDatabase();
  const like = `%${escapeSqlLikePattern(query)}%`;
  return db
    .prepare(
      `SELECT id, sender_id, sender_name, payload, channel, timestamp, to_node
       FROM messages WHERE payload LIKE ? ESCAPE '\\' ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(like, limit);
}

export function searchMeshcoreMessages(query: string, limit = 50): unknown[] {
  const db = getDatabase();
  const like = `%${escapeSqlLikePattern(query)}%`;
  return db
    .prepare(
      `SELECT id, sender_id, sender_name, payload, channel_idx, timestamp, to_node
       FROM meshcore_messages WHERE payload LIKE ? ESCAPE '\\' ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(like, limit);
}

export function deleteNodesBySource(source: string): number {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM nodes WHERE source = ?').run(source);
  return Number(result.changes);
}

export function migrateRfStubNodes(): number {
  const db = getDatabase();
  const result = db
    .prepare(
      "UPDATE nodes SET long_name = substr(long_name, 4), short_name = '' WHERE long_name LIKE 'RF !________'",
    )
    .run();
  return Number(result.changes);
}

export function deleteNodesWithoutLongname(): number {
  const db = getDatabase();
  const result = db
    .prepare(
      "DELETE FROM nodes WHERE (long_name IS NULL OR TRIM(long_name) = '' OR long_name = printf('!%08x', node_id) OR long_name = 'Node-' || printf('%X', node_id) OR (long_name LIKE '!%' AND (role IS NULL OR TRIM(role) = ''))) AND (favorited IS NULL OR favorited = 0)",
    )
    .run();
  return Number(result.changes);
}

export function getContactGroups(
  selfNodeId: number,
): { group_id: number; name: string; member_count: number }[] {
  return getDatabase()
    .prepare(
      `SELECT g.group_id, g.name, COUNT(m.contact_node_id) AS member_count
         FROM contact_groups g
         LEFT JOIN contact_group_members m ON m.group_id = g.group_id
        WHERE g.self_node_id = ?
        GROUP BY g.group_id
        ORDER BY g.name ASC`,
    )
    .all(selfNodeId) as { group_id: number; name: string; member_count: number }[];
}

export function createContactGroup(selfNodeId: number, name: string): number {
  const result = getDatabase()
    .prepare(`INSERT INTO contact_groups (self_node_id, name) VALUES (?, ?)`)
    .run(selfNodeId, name);
  return Number(result.lastInsertRowid);
}

export function updateContactGroup(groupId: number, name: string): void {
  getDatabase().prepare(`UPDATE contact_groups SET name = ? WHERE group_id = ?`).run(name, groupId);
}

export function deleteContactGroup(groupId: number): void {
  getDatabase().prepare(`DELETE FROM contact_groups WHERE group_id = ?`).run(groupId);
}

export function addContactToGroup(groupId: number, contactNodeId: number): void {
  getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO contact_group_members (group_id, contact_node_id)
       VALUES (?, ?)`,
    )
    .run(groupId, contactNodeId);
}

export function removeContactFromGroup(groupId: number, contactNodeId: number): void {
  getDatabase()
    .prepare(`DELETE FROM contact_group_members WHERE group_id = ? AND contact_node_id = ?`)
    .run(groupId, contactNodeId);
}

export function getContactGroupMembers(groupId: number): number[] {
  const rows = getDatabase()
    .prepare(`SELECT contact_node_id FROM contact_group_members WHERE group_id = ?`)
    .all(groupId) as { contact_node_id: number }[];
  return rows.map((r) => r.contact_node_id);
}

export function closeDatabase(): void {
  if (db) {
    try {
      db.close();
    } catch (err) {
      console.error(
        '[db] Error closing database:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
    } finally {
      db = null;
    }
  }
}

export function upsertNodePath(
  nodeId: number,
  lastHeard: number,
  hops: number,
  path: number[],
): void {
  const d = getDatabase();
  const pathJson = JSON.stringify(path);

  d.prepareOnce(
    `
    INSERT INTO nodes (node_id, last_heard, hops, path)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(node_id) DO UPDATE SET
        hops = excluded.hops,
        path = excluded.path,
        last_heard = excluded.last_heard
    WHERE excluded.hops < nodes.hops 
       OR excluded.last_heard > (nodes.last_heard + 300)
       OR nodes.hops IS NULL
  `,
  ).run(nodeId, lastHeard, hops, pathJson);
}

export interface MeshCoreHopHistoryRow {
  node_id: number;
  timestamp: number;
  hops: number | null;
  snr: number | null;
  rssi: number | null;
}

export interface MeshCoreTraceHistoryRow {
  id: number;
  node_id: number;
  timestamp: number;
  path_len: number | null;
  path_snrs: string | null;
  last_snr: number | null;
  tag: number | null;
}

export function getMeshcoreTraceHistory(nodeId: number): MeshCoreTraceHistoryRow[] {
  const d = getDatabase();
  const rows = d
    .prepare(
      `SELECT rowid AS id, node_id, timestamp, path_len, path_snrs, last_snr, tag
       FROM meshcore_trace_history WHERE node_id = ? ORDER BY timestamp DESC`,
    )
    .all(nodeId) as MeshCoreTraceHistoryRow[];
  return rows;
}

export function saveMeshcoreHopHistory(
  nodeId: number,
  timestamp: number,
  hops: number | null,
  snr: number | null,
  rssi: number | null,
): void {
  const d = getDatabase();
  d.prepareOnce(
    `
    INSERT INTO meshcore_hop_history (node_id, timestamp, hops, snr, rssi)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(node_id) DO UPDATE SET
        timestamp = excluded.timestamp,
        hops = excluded.hops,
        snr = excluded.snr,
        rssi = excluded.rssi
    WHERE excluded.timestamp > meshcore_hop_history.timestamp
  `,
  ).run(nodeId, timestamp, hops, snr, rssi);
}

export function getMeshcoreHopHistory(nodeId: number): MeshCoreHopHistoryRow | null {
  const d = getDatabase();
  const row = d.prepare('SELECT * FROM meshcore_hop_history WHERE node_id = ?').get(nodeId) as
    | MeshCoreHopHistoryRow
    | undefined;
  return row ?? null;
}

export function saveMeshcoreTraceHistory(
  nodeId: number,
  timestamp: number,
  pathLen: number | null,
  pathSnrs: number[],
  lastSnr: number | null,
  tag: number | null,
): void {
  const d = getDatabase();
  const pathSnrsJson = JSON.stringify(pathSnrs);
  d.prepareOnce(
    `INSERT INTO meshcore_trace_history (node_id, timestamp, path_len, path_snrs, last_snr, tag)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(nodeId, timestamp, pathLen, pathSnrsJson, lastSnr, tag);

  const MAX_TRACES_PER_NODE = 5;
  d.prepareOnce(
    `DELETE FROM meshcore_trace_history
     WHERE node_id = ? AND rowid NOT IN (
       SELECT rowid FROM meshcore_trace_history
       WHERE node_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
      )`,
  ).run(nodeId, nodeId, MAX_TRACES_PER_NODE);
}

export function pruneMeshcorePathHistory(nodeId: number): void {
  const d = getDatabase();
  d.prepare('DELETE FROM meshcore_hop_history WHERE node_id = ?').run(nodeId);
  d.prepare('DELETE FROM meshcore_trace_history WHERE node_id = ?').run(nodeId);
}

export interface MeshcorePathHistoryRow {
  id: number;
  node_id: number;
  path_hash: string;
  hop_count: number;
  path_bytes: string; // JSON array
  was_flood_discovery: number; // 0 | 1
  success_count: number;
  failure_count: number;
  trip_time_ms: number;
  route_weight: number;
  last_success_ts: number | null;
  created_at: number;
  updated_at: number;
}

export function upsertMeshcorePathHistory(
  nodeId: number,
  pathHash: string,
  hopCount: number,
  pathBytes: number[],
  wasFloodDiscovery: boolean,
  routeWeight: number,
): void {
  const d = getDatabase();
  const now = Date.now();
  d.prepareOnce(
    `INSERT INTO meshcore_path_history
       (node_id, path_hash, hop_count, path_bytes, was_flood_discovery, route_weight, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(node_id, path_hash) DO UPDATE SET
       hop_count           = excluded.hop_count,
       was_flood_discovery = excluded.was_flood_discovery,
       route_weight        = excluded.route_weight,
       updated_at          = excluded.updated_at`,
  ).run(
    nodeId,
    pathHash,
    hopCount,
    JSON.stringify(pathBytes),
    wasFloodDiscovery ? 1 : 0,
    routeWeight,
    now,
    now,
  );
}

export function recordMeshcorePathOutcome(
  nodeId: number,
  pathHash: string,
  success: boolean,
  tripTimeMs?: number,
): void {
  const d = getDatabase();
  const now = Date.now();
  if (success) {
    d.prepareOnce(
      `UPDATE meshcore_path_history
       SET success_count   = success_count + 1,
           trip_time_ms    = CASE WHEN ? > 0 AND (trip_time_ms = 0 OR ? < trip_time_ms) THEN ? ELSE trip_time_ms END,
           last_success_ts = ?,
           updated_at      = ?
       WHERE node_id = ? AND path_hash = ?`,
    ).run(tripTimeMs ?? 0, tripTimeMs ?? 0, tripTimeMs ?? 0, now, now, nodeId, pathHash);
  } else {
    d.prepareOnce(
      `UPDATE meshcore_path_history
       SET failure_count = failure_count + 1,
           updated_at    = ?
       WHERE node_id = ? AND path_hash = ?`,
    ).run(now, nodeId, pathHash);
  }
}

export function getMeshcorePathHistory(nodeId: number): MeshcorePathHistoryRow[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM meshcore_path_history WHERE node_id = ? ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(nodeId, MESHCORE_PATH_HISTORY_PER_NODE_ROW_LIMIT) as MeshcorePathHistoryRow[];
  if (rows.length >= MESHCORE_PATH_HISTORY_PER_NODE_ROW_LIMIT) {
    console.warn(
      '[database] getMeshcorePathHistory: row limit reached (results may be truncated)',
      { nodeId, limit: MESHCORE_PATH_HISTORY_PER_NODE_ROW_LIMIT },
    );
  }
  return rows;
}

/** All stored path variants for all nodes (for hydrating path history at app start). */
export function getAllMeshcorePathHistory(): MeshcorePathHistoryRow[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM meshcore_path_history ORDER BY node_id, updated_at DESC LIMIT ?`)
    .all(MESHCORE_PATH_HISTORY_GLOBAL_ROW_LIMIT) as MeshcorePathHistoryRow[];
  if (rows.length >= MESHCORE_PATH_HISTORY_GLOBAL_ROW_LIMIT) {
    console.warn(
      '[database] getAllMeshcorePathHistory: row limit reached; path history is truncated',
      { limit: MESHCORE_PATH_HISTORY_GLOBAL_ROW_LIMIT },
    );
  }
  return rows;
}

export function deleteMeshcorePathHistoryForNode(nodeId: number): void {
  getDatabase().prepare(`DELETE FROM meshcore_path_history WHERE node_id = ?`).run(nodeId);
}

export function deleteAllMeshcorePathHistory(): void {
  getDatabase().prepare(`DELETE FROM meshcore_path_history`).run();
}

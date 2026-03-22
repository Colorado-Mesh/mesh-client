import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { escapeSqlLikePattern } from '../shared/sqlLikeEscape';
import { NodeSqliteDB } from './db-compat';
import { sanitizeLogMessage } from './log-service';

/** Drop position_history rows older than this window on DB open. */
const POSITION_HISTORY_PRUNE_MS = 30 * 24 * 60 * 60 * 1000;

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

    // Detect fresh DB before running setup (user_version = 0, no tables yet)
    const isFreshDb =
      (db.pragma('user_version', { simple: true }) as number) === 0 &&
      !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'").get();

    const setup = db.transaction(() => {
      createBaseTables();
      if (isFreshDb) {
        // Base DDL already includes all columns; create constraint indexes that
        // migrations would otherwise add, then stamp current schema version.
        // idx_msg_packet_dedup is omitted from createBaseTables so that existing
        // databases can be migrated safely (v12 deduplicates first).
        db!
          .prepare(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_packet_dedup
           ON messages(sender_id, packet_id)
           WHERE packet_id IS NOT NULL`,
          )
          .run();
        db!.pragma('user_version = 17');
      } else {
        runMigrations();
      }
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

/** Run after first paint so startup does not block on large DELETE scans. */
export function runDeferredPositionHistoryPrune(): void {
  try {
    const d = getDatabase();
    const cutoff = Date.now() - POSITION_HISTORY_PRUNE_MS;
    const pruned = d.prepareOnce('DELETE FROM position_history WHERE recorded_at < ?').run(cutoff);
    if (pruned.changes > 0) {
      console.debug(`[db] Pruned ${pruned.changes} old position_history rows`);
    }
  } catch (e) {
    console.warn(
      '[db] position_history prune failed (non-fatal):',
      sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );
  }
}

function createBaseTables(): void {
  try {
    db!.execScript(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER,
        sender_name TEXT,
        payload TEXT NOT NULL,
        channel INTEGER DEFAULT 0,
        timestamp INTEGER NOT NULL,
        packet_id INTEGER,
        status TEXT DEFAULT 'acked',
        error TEXT,
        emoji INTEGER,
        reply_id INTEGER,
        to_node INTEGER,
        mqtt_status TEXT,
        received_via TEXT
      );

      CREATE TABLE IF NOT EXISTS nodes (
        node_id INTEGER PRIMARY KEY,
        long_name TEXT,
        short_name TEXT,
        hw_model TEXT,
        snr REAL,
        rssi REAL,
        battery INTEGER,
        last_heard INTEGER,
        latitude REAL,
        longitude REAL,
        role TEXT,
        hops_away INTEGER,
        via_mqtt INTEGER,
        voltage REAL,
        channel_utilization REAL,
        air_util_tx REAL,
        altitude INTEGER,
        favorited INTEGER DEFAULT 0,
        source TEXT DEFAULT 'rf',
        num_packets_rx_bad INTEGER,
        num_rx_dupe INTEGER,
        num_packets_rx INTEGER,
        num_packets_tx INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_channel_ts ON messages(channel, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_packet_id ON messages(packet_id);
      CREATE INDEX IF NOT EXISTS idx_nodes_last_heard ON nodes(last_heard);

      CREATE TABLE IF NOT EXISTS meshcore_contacts (
        node_id      INTEGER PRIMARY KEY,
        public_key   TEXT NOT NULL,
        adv_name     TEXT,
        contact_type INTEGER DEFAULT 0,
        last_advert  INTEGER,
        adv_lat      REAL,
        adv_lon      REAL,
        last_snr     REAL,
        last_rssi    REAL,
        favorited    INTEGER DEFAULT 0,
        nickname     TEXT
      );

      CREATE TABLE IF NOT EXISTS meshcore_messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id   INTEGER,
        sender_name TEXT,
        payload     TEXT NOT NULL,
        channel_idx INTEGER DEFAULT 0,
        timestamp   INTEGER NOT NULL,
        status      TEXT DEFAULT 'acked',
        packet_id   INTEGER,
        emoji       INTEGER,
        reply_id    INTEGER,
        to_node     INTEGER,
        received_via TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_mc_msgs_ts ON meshcore_messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_mc_msgs_channel_id ON meshcore_messages(channel_idx, id DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mc_msg_dedup
        ON meshcore_messages(sender_id, timestamp, channel_idx, payload)
        WHERE sender_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS position_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id     INTEGER NOT NULL,
        latitude    REAL    NOT NULL,
        longitude   REAL    NOT NULL,
        recorded_at INTEGER NOT NULL,
        source      TEXT    DEFAULT 'rf'
      );
      CREATE INDEX IF NOT EXISTS idx_position_history_node_time
        ON position_history(node_id, recorded_at);
      CREATE INDEX IF NOT EXISTS idx_position_history_time ON position_history(recorded_at);
    `);
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

function runMigrations(): void {
  let userVersion = db!.pragma('user_version', { simple: true }) as number;

  if (userVersion < 1) {
    try {
      db!.execScript('ALTER TABLE messages ADD COLUMN packet_id INTEGER');
      db!.execScript("ALTER TABLE messages ADD COLUMN status TEXT DEFAULT 'acked'");
      db!.execScript('ALTER TABLE messages ADD COLUMN error TEXT');
      db!.pragma('user_version = 1');
      userVersion = 1;
    } catch (e) {
      console.error(
        '[db] migration v1 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v1 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 2) {
    try {
      db!.execScript('ALTER TABLE messages ADD COLUMN emoji INTEGER');
      db!.execScript('ALTER TABLE messages ADD COLUMN reply_id INTEGER');
      db!.pragma('user_version = 2');
      userVersion = 2;
    } catch (e) {
      console.error(
        '[db] migration v2 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v2 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 3) {
    try {
      db!.execScript('ALTER TABLE messages ADD COLUMN to_node INTEGER');
      db!.pragma('user_version = 3');
      userVersion = 3;
    } catch (e) {
      console.error(
        '[db] migration v3 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v3 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 4) {
    try {
      db!.execScript(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_reaction_dedup ' +
          'ON messages(sender_id, reply_id, emoji) ' +
          'WHERE emoji IS NOT NULL AND reply_id IS NOT NULL',
      );
      db!.pragma('user_version = 4');
      userVersion = 4;
    } catch (e) {
      console.error(
        '[db] migration v4 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v4 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 5) {
    try {
      db!.prepare('ALTER TABLE nodes ADD COLUMN favorited INTEGER DEFAULT 0').run();
      db!.pragma('user_version = 5');
      userVersion = 5;
    } catch (e) {
      console.error(
        '[db] migration v5 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v5 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 6) {
    try {
      db!
        .prepare(
          'CREATE INDEX IF NOT EXISTS idx_messages_channel_ts ON messages(channel, timestamp DESC)',
        )
        .run();
      db!.pragma('user_version = 6');
      userVersion = 6;
    } catch (e) {
      console.error(
        '[db] migration v6 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v6 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 7) {
    try {
      db!.prepare("ALTER TABLE nodes ADD COLUMN source TEXT DEFAULT 'rf'").run();
      db!.pragma('user_version = 7');
      userVersion = 7;
    } catch (e) {
      console.error(
        '[db] migration v7 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v7 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 8) {
    try {
      db!.prepare('ALTER TABLE messages ADD COLUMN mqtt_status TEXT').run();
      db!.pragma('user_version = 8');
      userVersion = 8;
    } catch (e) {
      console.error(
        '[db] migration v8 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v8 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 9) {
    try {
      db!.prepare('ALTER TABLE nodes ADD COLUMN num_packets_rx_bad INTEGER').run();
      db!.prepare('ALTER TABLE nodes ADD COLUMN num_rx_dupe INTEGER').run();
      db!.prepare('ALTER TABLE nodes ADD COLUMN num_packets_rx INTEGER').run();
      db!.prepare('ALTER TABLE nodes ADD COLUMN num_packets_tx INTEGER').run();
      db!.pragma('user_version = 9');
      userVersion = 9;
    } catch (e) {
      console.error(
        '[db] migration v9 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v9 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 10) {
    try {
      db!.prepare('ALTER TABLE messages ADD COLUMN received_via TEXT').run();
      db!.pragma('user_version = 10');
      userVersion = 10;
    } catch (e) {
      console.error(
        '[db] migration v10 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v10 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 11) {
    try {
      db!.execScript(
        'CREATE TABLE IF NOT EXISTS meshcore_contacts (' +
          'node_id INTEGER PRIMARY KEY, public_key TEXT NOT NULL, adv_name TEXT, ' +
          'contact_type INTEGER DEFAULT 0, last_advert INTEGER, ' +
          'adv_lat REAL, adv_lon REAL, last_snr REAL, last_rssi REAL, favorited INTEGER DEFAULT 0)',
      );
      db!.execScript(
        'CREATE TABLE IF NOT EXISTS meshcore_messages (' +
          'id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER, sender_name TEXT, ' +
          'payload TEXT NOT NULL, channel_idx INTEGER DEFAULT 0, timestamp INTEGER NOT NULL, ' +
          "status TEXT DEFAULT 'acked', packet_id INTEGER, emoji INTEGER, reply_id INTEGER, to_node INTEGER)",
      );
      db!.execScript('CREATE INDEX IF NOT EXISTS idx_mc_msgs_ts ON meshcore_messages(timestamp)');
      db!.execScript(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_mc_msg_dedup ' +
          'ON meshcore_messages(sender_id, timestamp, channel_idx) ' +
          'WHERE sender_id IS NOT NULL',
      );
      db!.pragma('user_version = 11');
    } catch (e) {
      console.error(
        '[db] migration v11 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v11 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 12) {
    try {
      // Remove duplicate rows before adding constraint (keep earliest id per sender+packet pair)
      db!
        .prepare(
          `DELETE FROM messages
         WHERE id NOT IN (
           SELECT MIN(id) FROM messages
           GROUP BY sender_id, packet_id
           HAVING packet_id IS NOT NULL
         )
         AND packet_id IS NOT NULL`,
        )
        .run();
      db!
        .prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_packet_dedup
           ON messages(sender_id, packet_id)
           WHERE packet_id IS NOT NULL`,
        )
        .run();
      db!.pragma('user_version = 12');
      userVersion = 12;
    } catch (e) {
      console.error(
        '[db] migration v12 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v12 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 13) {
    try {
      const columns = db!.prepare('PRAGMA table_info(meshcore_contacts)').all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === 'nickname')) {
        db!.prepare('ALTER TABLE meshcore_contacts ADD COLUMN nickname TEXT').run();
      }
      db!.pragma('user_version = 13');
      userVersion = 13;
    } catch (e) {
      console.error(
        '[db] migration v13 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v13 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 14) {
    try {
      db!
        .prepare(
          'CREATE TABLE IF NOT EXISTS position_history (' +
            'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
            'node_id INTEGER NOT NULL, ' +
            'latitude REAL NOT NULL, ' +
            'longitude REAL NOT NULL, ' +
            "recorded_at INTEGER NOT NULL, source TEXT DEFAULT 'rf')",
        )
        .run();
      db!
        .prepare(
          'CREATE INDEX IF NOT EXISTS idx_position_history_node_time ' +
            'ON position_history(node_id, recorded_at)',
        )
        .run();
      db!.pragma('user_version = 14');
    } catch (e) {
      console.error(
        '[db] migration v14 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v14 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 15) {
    try {
      const columns = db!.prepare('PRAGMA table_info(meshcore_messages)').all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === 'emoji')) {
        db!.prepare('ALTER TABLE meshcore_messages ADD COLUMN emoji INTEGER').run();
      }
      if (!columns.some((c) => c.name === 'reply_id')) {
        db!.prepare('ALTER TABLE meshcore_messages ADD COLUMN reply_id INTEGER').run();
      }
      db!.pragma('user_version = 15');
    } catch (e) {
      console.error(
        '[db] migration v15 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v15 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 16) {
    try {
      const columns = db!.prepare('PRAGMA table_info(meshcore_messages)').all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === 'received_via')) {
        db!.prepare('ALTER TABLE meshcore_messages ADD COLUMN received_via TEXT').run();
      }
      db!.pragma('user_version = 16');
    } catch (e) {
      console.error(
        '[db] migration v16 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v16 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 17) {
    try {
      // Previous index (sender_id, timestamp, channel_idx) dropped distinct lines that shared
      // those three fields — common for RF channel chat (second-resolution timestamps + stub ids).
      db!.execScript('DROP INDEX IF EXISTS idx_mc_msg_dedup');
      db!.execScript(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_mc_msg_dedup ' +
          'ON meshcore_messages(sender_id, timestamp, channel_idx, payload) ' +
          'WHERE sender_id IS NOT NULL',
      );
      db!.pragma('user_version = 17');
    } catch (e) {
      console.error(
        '[db] migration v17 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v17 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** Export DB to a file. Best-effort for very large databases; may take a long time with no progress callback. */
export async function exportDatabase(destPath: string): Promise<void> {
  await getDatabase().backup(destPath);
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

    const sourceNodes = sourceDb.prepare('SELECT * FROM nodes').all() as any[];
    const sourceMessages = sourceDb.prepare('SELECT * FROM messages').all() as any[];

    const result = targetDb.transaction(() => {
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

      for (const node of sourceNodes) {
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

      for (const msg of sourceMessages) {
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
          if (!checkMessage.get(senderId as number, timestamp as number, payload as string)) {
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

    return result;
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
      "DELETE FROM nodes WHERE (long_name IS NULL OR TRIM(long_name) = '' OR long_name = printf('!%08x', node_id)) AND (source IS NULL OR TRIM(source) = '' OR source = 'mqtt') AND (favorited IS NULL OR favorited = 0)",
    )
    .run();
  return Number(result.changes);
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

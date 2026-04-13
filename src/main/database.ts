import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { escapeSqlLikePattern } from '../shared/sqlLikeEscape';
import { NodeSqliteDB } from './db-compat';
import { sanitizeLogMessage } from './log-service';

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
        db!.pragma('user_version = 26');
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
        num_packets_tx INTEGER,
        hops INTEGER,
        path TEXT
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
        nickname     TEXT,
        contact_flags INTEGER DEFAULT 0,
        last_rf_transport_scope  INTEGER,
        last_rf_transport_return   INTEGER
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
        received_via TEXT,
        rx_packet_fingerprint TEXT
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

      CREATE TABLE IF NOT EXISTS contact_groups (
        group_id      INTEGER PRIMARY KEY AUTOINCREMENT,
        self_node_id  INTEGER NOT NULL,
        name          TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_contact_groups_self ON contact_groups(self_node_id);

      CREATE TABLE IF NOT EXISTS contact_group_members (
        group_id         INTEGER NOT NULL
          REFERENCES contact_groups(group_id) ON DELETE CASCADE,
        contact_node_id  INTEGER NOT NULL,
        PRIMARY KEY (group_id, contact_node_id)
      );

      -- MeshCore hop history (MeshCore only, upsert on newer timestamp)
      CREATE TABLE IF NOT EXISTS meshcore_hop_history (
        node_id     INTEGER PRIMARY KEY,
        timestamp   INTEGER NOT NULL,
        hops        INTEGER,
        snr         REAL,
        rssi        REAL
      );

      -- MeshCore trace history (MeshCore only, keep up to 5 most recent per node)
      CREATE TABLE IF NOT EXISTS meshcore_trace_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id    INTEGER NOT NULL,
        timestamp  INTEGER NOT NULL,
        path_len   INTEGER,
        path_snrs  TEXT,
        last_snr   REAL,
        tag        INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_meshcore_trace_history_node_id ON meshcore_trace_history(node_id);

      -- MeshCore path history: per-path delivery outcome tracking for weighted route scoring
      CREATE TABLE IF NOT EXISTS meshcore_path_history (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id           INTEGER NOT NULL,
        path_hash         TEXT    NOT NULL,
        hop_count         INTEGER NOT NULL,
        path_bytes        TEXT    NOT NULL,
        was_flood_discovery INTEGER DEFAULT 0,
        success_count     INTEGER DEFAULT 0,
        failure_count     INTEGER DEFAULT 0,
        trip_time_ms      INTEGER DEFAULT 0,
        route_weight      REAL    DEFAULT 1.0,
        last_success_ts   INTEGER,
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL,
        UNIQUE(node_id, path_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_meshcore_path_history_node ON meshcore_path_history(node_id);
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

  if (userVersion < 18) {
    try {
      db!
        .prepare(
          `CREATE TABLE IF NOT EXISTS meshcore_contact_groups (
             group_id      INTEGER PRIMARY KEY AUTOINCREMENT,
             self_node_id  INTEGER NOT NULL,
             name          TEXT    NOT NULL
           )`,
        )
        .run();
      db!
        .prepare(`CREATE INDEX IF NOT EXISTS idx_mcg_self ON meshcore_contact_groups(self_node_id)`)
        .run();
      db!
        .prepare(
          `CREATE TABLE IF NOT EXISTS meshcore_contact_group_members (
             group_id         INTEGER NOT NULL
               REFERENCES meshcore_contact_groups(group_id) ON DELETE CASCADE,
             contact_node_id  INTEGER NOT NULL,
             PRIMARY KEY (group_id, contact_node_id)
           )`,
        )
        .run();
      db!.pragma('user_version = 18');
    } catch (e) {
      console.error(
        '[db] migration v18 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v18 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 19) {
    try {
      const columns = db!.prepare('PRAGMA table_info(meshcore_contacts)').all() as {
        name: string;
      }[];
      if (!columns.some((c) => c.name === 'contact_flags')) {
        db!
          .prepare('ALTER TABLE meshcore_contacts ADD COLUMN contact_flags INTEGER DEFAULT 0')
          .run();
      }
      db!.pragma('user_version = 19');
    } catch (e) {
      console.error(
        '[db] migration v19 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v19 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 20) {
    try {
      const hasLegacy = db!
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='meshcore_contact_groups' LIMIT 1",
        )
        .get();
      const hasNew = db!
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='contact_groups' LIMIT 1")
        .get();

      if (hasLegacy) {
        if (!hasNew) {
          db!
            .prepare(
              `CREATE TABLE contact_groups (
                 group_id      INTEGER PRIMARY KEY AUTOINCREMENT,
                 self_node_id  INTEGER NOT NULL,
                 name          TEXT    NOT NULL
               )`,
            )
            .run();
          db!
            .prepare(
              `CREATE TABLE contact_group_members (
                 group_id         INTEGER NOT NULL
                   REFERENCES contact_groups(group_id) ON DELETE CASCADE,
                 contact_node_id  INTEGER NOT NULL,
                 PRIMARY KEY (group_id, contact_node_id)
               )`,
            )
            .run();
        } else {
          db!.prepare('DELETE FROM contact_group_members').run();
          db!.prepare('DELETE FROM contact_groups').run();
        }
        db!.prepare('INSERT INTO contact_groups SELECT * FROM meshcore_contact_groups').run();
        db!
          .prepare('INSERT INTO contact_group_members SELECT * FROM meshcore_contact_group_members')
          .run();
        db!.prepare('DROP TABLE IF EXISTS meshcore_contact_group_members').run();
        db!.prepare('DROP TABLE IF EXISTS meshcore_contact_groups').run();
        db!
          .prepare(
            'CREATE INDEX IF NOT EXISTS idx_contact_groups_self ON contact_groups(self_node_id)',
          )
          .run();
      } else if (!hasNew) {
        db!
          .prepare(
            `CREATE TABLE IF NOT EXISTS contact_groups (
               group_id      INTEGER PRIMARY KEY AUTOINCREMENT,
               self_node_id  INTEGER NOT NULL,
               name          TEXT    NOT NULL
             )`,
          )
          .run();
        db!
          .prepare(
            `CREATE TABLE IF NOT EXISTS contact_group_members (
               group_id         INTEGER NOT NULL
                 REFERENCES contact_groups(group_id) ON DELETE CASCADE,
               contact_node_id  INTEGER NOT NULL,
               PRIMARY KEY (group_id, contact_node_id)
             )`,
          )
          .run();
        db!
          .prepare(
            'CREATE INDEX IF NOT EXISTS idx_contact_groups_self ON contact_groups(self_node_id)',
          )
          .run();
      }
      db!.pragma('user_version = 20');
    } catch (e) {
      console.error(
        '[db] migration v20 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v20 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 21) {
    try {
      const cols = db!.prepare('PRAGMA table_info(meshcore_contacts)').all() as {
        name: string;
      }[];
      if (!cols.some((c) => c.name === 'hops_away')) {
        db!.prepare('ALTER TABLE meshcore_contacts ADD COLUMN hops_away INTEGER').run();
      }
      db!.pragma('user_version = 21');
    } catch (e) {
      console.error(
        '[db] migration v21 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v21 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 22) {
    try {
      const cols = db!.prepare('PRAGMA table_info(meshcore_contacts)').all() as {
        name: string;
      }[];
      if (!cols.some((c) => c.name === 'on_radio')) {
        db!.prepare('ALTER TABLE meshcore_contacts ADD COLUMN on_radio INTEGER DEFAULT 0').run();
      }
      if (!cols.some((c) => c.name === 'last_synced_from_radio')) {
        db!.prepare('ALTER TABLE meshcore_contacts ADD COLUMN last_synced_from_radio TEXT').run();
      }
      db!.pragma('user_version = 22');
    } catch (e) {
      console.error(
        '[db] migration v22 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v22 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 23) {
    try {
      const cols = db!.prepare('PRAGMA table_info(nodes)').all() as {
        name: string;
      }[];
      if (!cols.some((c) => c.name === 'hops')) {
        db!.prepare('ALTER TABLE nodes ADD COLUMN hops INTEGER').run();
      }
      if (!cols.some((c) => c.name === 'path')) {
        db!.prepare('ALTER TABLE nodes ADD COLUMN path TEXT').run();
      }
      db!.pragma('user_version = 23');
    } catch (e) {
      console.error(
        '[db] migration v23 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v23 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 24) {
    try {
      const tableExists = db!
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='meshcore_trace_history'")
        .get();
      if (tableExists) {
        const cols = db!.prepare('PRAGMA table_info(meshcore_trace_history)').all() as {
          name: string;
        }[];
        if (!cols.some((c) => c.name === 'id')) {
          db!.execScript(`
            CREATE TABLE meshcore_trace_history_new (
              id         INTEGER PRIMARY KEY AUTOINCREMENT,
              node_id    INTEGER NOT NULL,
              timestamp  INTEGER NOT NULL,
              path_len   INTEGER,
              path_snrs  TEXT,
              last_snr   REAL,
              tag        INTEGER
            );
            INSERT INTO meshcore_trace_history_new (node_id, timestamp, path_len, path_snrs, last_snr, tag)
              SELECT node_id, timestamp, path_len, path_snrs, last_snr, tag FROM meshcore_trace_history;
            DROP TABLE meshcore_trace_history;
            ALTER TABLE meshcore_trace_history_new RENAME TO meshcore_trace_history;
            CREATE INDEX IF NOT EXISTS idx_meshcore_trace_history_node_id ON meshcore_trace_history(node_id);
          `);
        }
      }
      db!.pragma('user_version = 24');
    } catch (e) {
      console.error(
        '[db] migration v24 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v24 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 25) {
    try {
      const tableExists = db!
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='meshcore_path_history'")
        .get();
      if (!tableExists) {
        db!.execScript(`
          CREATE TABLE IF NOT EXISTS meshcore_path_history (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            node_id           INTEGER NOT NULL,
            path_hash         TEXT    NOT NULL,
            hop_count         INTEGER NOT NULL,
            path_bytes        TEXT    NOT NULL,
            was_flood_discovery INTEGER DEFAULT 0,
            success_count     INTEGER DEFAULT 0,
            failure_count     INTEGER DEFAULT 0,
            trip_time_ms      INTEGER DEFAULT 0,
            route_weight      REAL    DEFAULT 1.0,
            last_success_ts   INTEGER,
            created_at        INTEGER NOT NULL,
            updated_at        INTEGER NOT NULL,
            UNIQUE(node_id, path_hash)
          );
          CREATE INDEX IF NOT EXISTS idx_meshcore_path_history_node ON meshcore_path_history(node_id);
        `);
      }
      db!.pragma('user_version = 25');
    } catch (e) {
      console.error(
        '[db] migration v25 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v25 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 26) {
    try {
      const mc1 = db!.prepare('PRAGMA table_info(meshcore_contacts)').all() as { name: string }[];
      if (!mc1.some((c) => c.name === 'last_rf_transport_scope')) {
        db!
          .prepare('ALTER TABLE meshcore_contacts ADD COLUMN last_rf_transport_scope INTEGER')
          .run();
      }
      const mc2 = db!.prepare('PRAGMA table_info(meshcore_contacts)').all() as { name: string }[];
      if (!mc2.some((c) => c.name === 'last_rf_transport_return')) {
        db!
          .prepare('ALTER TABLE meshcore_contacts ADD COLUMN last_rf_transport_return INTEGER')
          .run();
      }
      const mm1 = db!.prepare('PRAGMA table_info(meshcore_messages)').all() as { name: string }[];
      if (!mm1.some((c) => c.name === 'rx_packet_fingerprint')) {
        db!.prepare('ALTER TABLE meshcore_messages ADD COLUMN rx_packet_fingerprint TEXT').run();
      }
      db!.pragma('user_version = 26');
    } catch (e) {
      console.error(
        '[db] migration v26 failed',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      throw new Error(`Migration v26 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** Export DB to a file. Best-effort for very large databases; may take a long time with no progress callback. */
export function exportDatabase(destPath: string): void {
  getDatabase().backup(destPath);
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
          if (!checkMessage.get(senderId as number, timestamp as number, payload)) {
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
      "DELETE FROM nodes WHERE (long_name IS NULL OR TRIM(long_name) = '' OR long_name = printf('!%08x', node_id) OR (long_name LIKE '!%' AND (role IS NULL OR TRIM(role) = ''))) AND (favorited IS NULL OR favorited = 0)",
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
  return getDatabase()
    .prepare(`SELECT * FROM meshcore_path_history WHERE node_id = ? ORDER BY updated_at DESC`)
    .all(nodeId) as MeshcorePathHistoryRow[];
}

export function deleteMeshcorePathHistoryForNode(nodeId: number): void {
  getDatabase().prepare(`DELETE FROM meshcore_path_history WHERE node_id = ?`).run(nodeId);
}

export function deleteAllMeshcorePathHistory(): void {
  getDatabase().prepare(`DELETE FROM meshcore_path_history`).run();
}

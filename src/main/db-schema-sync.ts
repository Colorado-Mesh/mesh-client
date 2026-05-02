/**
 * Declarative SQLite schema sync + idempotent structural upgrades for mesh-client.
 * Replaces the historical linear user_version migration ladder (#388).
 *
 * Failure point: any ALTER/CREATE/DATA step can throw; caller transaction rolls back.
 * Logging: errors use sanitizeLogMessage before console.error.
 */
import type { NodeSqliteDB } from './db-compat';
import { sanitizeLogMessage } from './log-service';

/** Bumped when ensureSchema behavior changes in a non-idempotent way (rare). */
export const CURRENT_SCHEMA_VERSION = 29;

/**
 * Tables only — used during upgrades so we do not CREATE UNIQUE indexes before
 * data fixes (e.g. duplicate message cleanup for idx_msg_packet_dedup).
 */
export const CANONICAL_TABLES_DDL = `
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
        received_via TEXT,
        reply_preview_text TEXT,
        reply_preview_sender TEXT
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
        last_rf_transport_return   INTEGER,
        hops_away    INTEGER,
        on_radio     INTEGER DEFAULT 0,
        last_synced_from_radio TEXT
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
        rx_packet_fingerprint TEXT,
        reply_preview_text TEXT,
        reply_preview_sender TEXT
      );

      CREATE TABLE IF NOT EXISTS position_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id     INTEGER NOT NULL,
        latitude    REAL    NOT NULL,
        longitude   REAL    NOT NULL,
        recorded_at INTEGER NOT NULL,
        source      TEXT    DEFAULT 'rf'
      );

      CREATE TABLE IF NOT EXISTS contact_groups (
        group_id      INTEGER PRIMARY KEY AUTOINCREMENT,
        self_node_id  INTEGER NOT NULL,
        name          TEXT    NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contact_group_members (
        group_id         INTEGER NOT NULL
          REFERENCES contact_groups(group_id) ON DELETE CASCADE,
        contact_node_id  INTEGER NOT NULL,
        PRIMARY KEY (group_id, contact_node_id)
      );

      CREATE TABLE IF NOT EXISTS meshcore_hop_history (
        node_id     INTEGER PRIMARY KEY,
        timestamp   INTEGER NOT NULL,
        hops        INTEGER,
        snr         REAL,
        rssi        REAL
      );

      CREATE TABLE IF NOT EXISTS meshcore_trace_history (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        node_id    INTEGER NOT NULL,
        timestamp  INTEGER NOT NULL,
        path_len   INTEGER,
        path_snrs  TEXT,
        last_snr   REAL,
        tag        INTEGER
      );

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

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `;

const INDEX_DDLS: readonly string[] = [
  'CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)',
  'CREATE INDEX IF NOT EXISTS idx_messages_channel_ts ON messages(channel, timestamp DESC)',
  'CREATE INDEX IF NOT EXISTS idx_messages_packet_id ON messages(packet_id)',
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_reaction_dedup
        ON messages(sender_id, reply_id, emoji)
        WHERE emoji IS NOT NULL AND reply_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_packet_dedup
        ON messages(sender_id, packet_id)
        WHERE packet_id IS NOT NULL`,
  'CREATE INDEX IF NOT EXISTS idx_nodes_last_heard ON nodes(last_heard)',
  'CREATE INDEX IF NOT EXISTS idx_mc_msgs_ts ON meshcore_messages(timestamp)',
  'CREATE INDEX IF NOT EXISTS idx_mc_msgs_channel_id ON meshcore_messages(channel_idx, id DESC)',
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mc_msg_dedup
        ON meshcore_messages(sender_id, timestamp, channel_idx, payload)
        WHERE sender_id IS NOT NULL`,
  'CREATE INDEX IF NOT EXISTS idx_position_history_node_time ON position_history(node_id, recorded_at)',
  'CREATE INDEX IF NOT EXISTS idx_position_history_time ON position_history(recorded_at)',
  'CREATE INDEX IF NOT EXISTS idx_contact_groups_self ON contact_groups(self_node_id)',
  'CREATE INDEX IF NOT EXISTS idx_meshcore_trace_history_node_id ON meshcore_trace_history(node_id)',
  'CREATE INDEX IF NOT EXISTS idx_meshcore_path_history_node ON meshcore_path_history(node_id)',
];

/** Tables + indexes for empty new databases (createBaseTables). */
export const CANONICAL_CREATE_ALL_DDL = `${CANONICAL_TABLES_DDL}\n${INDEX_DDLS.map((s) => `${s};`).join('\n')}\n`;

/**
 * Columns to ensure via ALTER TABLE ADD COLUMN (SQLite additive upgrades).
 * Values are the fragment after the column name (type, defaults, NOT NULL as applicable).
 */
export const DESIRED_COLUMNS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  messages: {
    sender_id: 'INTEGER',
    sender_name: 'TEXT',
    payload: 'TEXT NOT NULL',
    channel: 'INTEGER DEFAULT 0',
    timestamp: 'INTEGER NOT NULL',
    packet_id: 'INTEGER',
    status: "TEXT DEFAULT 'acked'",
    error: 'TEXT',
    emoji: 'INTEGER',
    reply_id: 'INTEGER',
    to_node: 'INTEGER',
    mqtt_status: 'TEXT',
    received_via: 'TEXT',
    reply_preview_text: 'TEXT',
    reply_preview_sender: 'TEXT',
  },
  nodes: {
    long_name: 'TEXT',
    short_name: 'TEXT',
    hw_model: 'TEXT',
    snr: 'REAL',
    rssi: 'REAL',
    battery: 'INTEGER',
    last_heard: 'INTEGER',
    latitude: 'REAL',
    longitude: 'REAL',
    role: 'TEXT',
    hops_away: 'INTEGER',
    via_mqtt: 'INTEGER',
    voltage: 'REAL',
    channel_utilization: 'REAL',
    air_util_tx: 'REAL',
    altitude: 'INTEGER',
    favorited: 'INTEGER DEFAULT 0',
    source: "TEXT DEFAULT 'rf'",
    num_packets_rx_bad: 'INTEGER',
    num_rx_dupe: 'INTEGER',
    num_packets_rx: 'INTEGER',
    num_packets_tx: 'INTEGER',
    hops: 'INTEGER',
    path: 'TEXT',
  },
  meshcore_contacts: {
    public_key: 'TEXT NOT NULL',
    adv_name: 'TEXT',
    contact_type: 'INTEGER DEFAULT 0',
    last_advert: 'INTEGER',
    adv_lat: 'REAL',
    adv_lon: 'REAL',
    last_snr: 'REAL',
    last_rssi: 'REAL',
    favorited: 'INTEGER DEFAULT 0',
    nickname: 'TEXT',
    contact_flags: 'INTEGER DEFAULT 0',
    last_rf_transport_scope: 'INTEGER',
    last_rf_transport_return: 'INTEGER',
    hops_away: 'INTEGER',
    on_radio: 'INTEGER DEFAULT 0',
    last_synced_from_radio: 'TEXT',
  },
  meshcore_messages: {
    sender_id: 'INTEGER',
    sender_name: 'TEXT',
    payload: 'TEXT NOT NULL',
    channel_idx: 'INTEGER DEFAULT 0',
    timestamp: 'INTEGER NOT NULL',
    status: "TEXT DEFAULT 'acked'",
    packet_id: 'INTEGER',
    emoji: 'INTEGER',
    reply_id: 'INTEGER',
    to_node: 'INTEGER',
    received_via: 'TEXT',
    rx_packet_fingerprint: 'TEXT',
    reply_preview_text: 'TEXT',
    reply_preview_sender: 'TEXT',
  },
  position_history: {
    node_id: 'INTEGER NOT NULL',
    latitude: 'REAL NOT NULL',
    longitude: 'REAL NOT NULL',
    recorded_at: 'INTEGER NOT NULL',
    source: "TEXT DEFAULT 'rf'",
  },
  contact_groups: {
    self_node_id: 'INTEGER NOT NULL',
    name: 'TEXT NOT NULL',
  },
  contact_group_members: {
    group_id: 'INTEGER NOT NULL',
    contact_node_id: 'INTEGER NOT NULL',
  },
  meshcore_hop_history: {
    timestamp: 'INTEGER NOT NULL',
    hops: 'INTEGER',
    snr: 'REAL',
    rssi: 'REAL',
  },
  meshcore_trace_history: {
    node_id: 'INTEGER NOT NULL',
    timestamp: 'INTEGER NOT NULL',
    path_len: 'INTEGER',
    path_snrs: 'TEXT',
    last_snr: 'REAL',
    tag: 'INTEGER',
  },
  meshcore_path_history: {
    node_id: 'INTEGER NOT NULL',
    path_hash: 'TEXT NOT NULL',
    hop_count: 'INTEGER NOT NULL',
    path_bytes: 'TEXT NOT NULL',
    was_flood_discovery: 'INTEGER DEFAULT 0',
    success_count: 'INTEGER DEFAULT 0',
    failure_count: 'INTEGER DEFAULT 0',
    trip_time_ms: 'INTEGER DEFAULT 0',
    route_weight: 'REAL DEFAULT 1.0',
    last_success_ts: 'INTEGER',
    created_at: 'INTEGER NOT NULL',
    updated_at: 'INTEGER NOT NULL',
  },
};

function tableExists(db: NodeSqliteDB, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`)
    .get(name);
  return row !== undefined;
}

function getColumnNames(db: NodeSqliteDB, table: string): Set<string> {
  if (!tableExists(db, table)) return new Set();
  const rows = db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all() as {
    name: string;
  }[];
  return new Set(rows.map((r) => r.name));
}

function ensureTablesOnly(db: NodeSqliteDB): void {
  db.execScript(CANONICAL_TABLES_DDL);
}

function ensureColumns(db: NodeSqliteDB): void {
  for (const [table, cols] of Object.entries(DESIRED_COLUMNS)) {
    if (!tableExists(db, table)) continue;
    const existing = getColumnNames(db, table);
    for (const [colName, frag] of Object.entries(cols)) {
      if (existing.has(colName)) continue;
      const qTable = `"${table.replace(/"/g, '""')}"`;
      const qCol = `"${colName.replace(/"/g, '""')}"`;
      db.prepare(`ALTER TABLE ${qTable} ADD COLUMN ${qCol} ${frag}`).run();
      existing.add(colName);
    }
  }
}

/** Legacy meshcore_messages dedup index lacked payload; drop and recreate current definition. */
function ensureMeshcoreMessagesDedupIndex(db: NodeSqliteDB): void {
  db.execScript('DROP INDEX IF EXISTS idx_mc_msg_dedup');
  db.execScript(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_mc_msg_dedup ' +
      'ON meshcore_messages(sender_id, timestamp, channel_idx, payload) ' +
      'WHERE sender_id IS NOT NULL',
  );
}

/**
 * Remove duplicate messages before packet-level dedup index (historical migration v12).
 * Idempotent when idx_msg_packet_dedup already exists.
 */
function ensureMessagesPacketDedup(db: NodeSqliteDB): void {
  const idx = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_msg_packet_dedup' LIMIT 1`,
    )
    .get();
  if (idx !== undefined) return;
  if (!tableExists(db, 'messages')) return;

  db.prepare(
    `DELETE FROM messages
         WHERE id NOT IN (
           SELECT MIN(id) FROM messages
           GROUP BY sender_id, packet_id
           HAVING packet_id IS NOT NULL
         )
         AND packet_id IS NOT NULL`,
  ).run();

  db.execScript(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_packet_dedup
           ON messages(sender_id, packet_id)
           WHERE packet_id IS NOT NULL`,
  );
}

/** Rename meshcore_contact_groups → contact_groups and copy rows (historical migration v20). */
function migrateLegacyContactGroups(db: NodeSqliteDB): void {
  const hasLegacy = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name='meshcore_contact_groups' LIMIT 1`,
    )
    .get();
  const hasNew = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='contact_groups' LIMIT 1`)
    .get();

  if (hasLegacy) {
    if (!hasNew) {
      db.prepare(
        `CREATE TABLE contact_groups (
                 group_id      INTEGER PRIMARY KEY AUTOINCREMENT,
                 self_node_id  INTEGER NOT NULL,
                 name          TEXT    NOT NULL
               )`,
      ).run();
      db.prepare(
        `CREATE TABLE contact_group_members (
                 group_id         INTEGER NOT NULL
                   REFERENCES contact_groups(group_id) ON DELETE CASCADE,
                 contact_node_id  INTEGER NOT NULL,
                 PRIMARY KEY (group_id, contact_node_id)
               )`,
      ).run();
    } else {
      db.prepare('DELETE FROM contact_group_members').run();
      db.prepare('DELETE FROM contact_groups').run();
    }
    db.prepare('INSERT INTO contact_groups SELECT * FROM meshcore_contact_groups').run();
    db.prepare(
      'INSERT INTO contact_group_members SELECT * FROM meshcore_contact_group_members',
    ).run();
    db.prepare('DROP TABLE IF EXISTS meshcore_contact_group_members').run();
    db.prepare('DROP TABLE IF EXISTS meshcore_contact_groups').run();
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_contact_groups_self ON contact_groups(self_node_id)',
    ).run();
  } else if (!hasNew) {
    db.prepare(
      `CREATE TABLE IF NOT EXISTS contact_groups (
               group_id      INTEGER PRIMARY KEY AUTOINCREMENT,
               self_node_id  INTEGER NOT NULL,
               name          TEXT    NOT NULL
             )`,
    ).run();
    db.prepare(
      `CREATE TABLE IF NOT EXISTS contact_group_members (
               group_id         INTEGER NOT NULL
                 REFERENCES contact_groups(group_id) ON DELETE CASCADE,
               contact_node_id  INTEGER NOT NULL,
               PRIMARY KEY (group_id, contact_node_id)
             )`,
    ).run();
    db.prepare(
      'CREATE INDEX IF NOT EXISTS idx_contact_groups_self ON contact_groups(self_node_id)',
    ).run();
  }
}

/** Add autoincrement id to meshcore_trace_history when legacy table lacked it (historical migration v24). */
function rebuildMeshcoreTraceHistoryIfNeeded(db: NodeSqliteDB): void {
  if (!tableExists(db, 'meshcore_trace_history')) return;
  const cols = getColumnNames(db, 'meshcore_trace_history');
  if (cols.has('id')) return;

  db.execScript(`
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

function ensureIndexes(db: NodeSqliteDB): void {
  for (const ddl of INDEX_DDLS) {
    db.execScript(ddl);
  }
}

function seedAppSettings(db: NodeSqliteDB): void {
  const seed = db.prepare('INSERT OR IGNORE INTO app_settings(key, value) VALUES (?, ?)');
  seed.run('meshtasticMessageRetentionEnabled', '1');
  seed.run('meshtasticMessageRetentionCount', '4000');
  seed.run('meshcoreMessageRetentionEnabled', '1');
  seed.run('meshcoreMessageRetentionCount', '4000');
}

function structuralUpgrades(db: NodeSqliteDB): void {
  ensureMessagesPacketDedup(db);
  ensureMeshcoreMessagesDedupIndex(db);
  migrateLegacyContactGroups(db);
  rebuildMeshcoreTraceHistoryIfNeeded(db);
}

/**
 * Apply declarative schema sync + structural upgrades, then bump user_version when behind.
 * Safe to call on every startup (idempotent).
 */
export function runSchemaUpgrade(db: NodeSqliteDB): void {
  try {
    ensureTablesOnly(db);
    ensureColumns(db);
    structuralUpgrades(db);
    ensureIndexes(db);
    seedAppSettings(db);

    const cur = db.pragma('user_version', { simple: true }) as number;
    if (cur < CURRENT_SCHEMA_VERSION) {
      db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
    }
  } catch (e) {
    console.error(
      '[db] runSchemaUpgrade failed',
      sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );
    throw new Error(`runSchemaUpgrade failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

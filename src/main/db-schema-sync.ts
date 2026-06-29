/**
 * Declarative SQLite schema sync + idempotent structural upgrades for mesh-client.
 * Replaces the historical linear user_version migration ladder (#388).
 *
 * Failure point: any ALTER/CREATE/DATA step can throw; caller transaction rolls back.
 * Logging: errors use sanitizeLogMessage before console.error.
 */
import { LAST_HEARD_MS_THRESHOLD } from '../shared/lastHeardUnits';
import {
  MESHCORE_CONTACT_HW_LABELS,
  MESHCORE_ROOM_MESSAGE_CHANNEL,
  MESHCORE_ROOM_STALE_SENDING_MS,
} from '../shared/meshcoreContactHwLabels';
import { MESHCORE_LAST_ADVERT_MAX_FUTURE_SKEW_SEC } from '../shared/meshcoreLastAdvertPlausible';
import { meshProtocolSqlInList } from '../shared/meshProtocol';
import type { NodeSqliteDB } from './db-compat';
import { sanitizeLogMessage } from './log-service';

/** Bumped when ensureSchema behavior changes in a non-idempotent way (rare). */
export const CURRENT_SCHEMA_VERSION = 37;

/** Thrown when on-disk `user_version` exceeds this build's {@link CURRENT_SCHEMA_VERSION}. */
export class DatabaseSchemaTooNewError extends Error {
  readonly code = 'DB_SCHEMA_TOO_NEW' as const;
  readonly dbVersion: number;
  readonly appVersion: number;

  constructor(dbVersion: number, appVersion: number) {
    super(`[db] Database schema v${dbVersion} is newer than this app supports (v${appVersion})`);
    this.name = 'DatabaseSchemaTooNewError';
    this.dbVersion = dbVersion;
    this.appVersion = appVersion;
  }
}

export function isDatabaseSchemaTooNewError(err: unknown): err is DatabaseSchemaTooNewError {
  return err instanceof DatabaseSchemaTooNewError;
}

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
        reply_preview_sender TEXT,
        rx_hops INTEGER,
        via_store_forward INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS nodes (
        node_id INTEGER PRIMARY KEY,
        long_name TEXT,
        short_name TEXT,
        hw_model TEXT,
        snr REAL,
        rssi REAL,
        battery INTEGER,
        last_heard INTEGER, -- Unix epoch seconds (legacy DBs may have ms until v36 repair)
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
        reply_preview_sender TEXT,
        rx_hops INTEGER,
        room_server_id INTEGER
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

      CREATE TABLE IF NOT EXISTS reticulum_destinations (
        destination_hash TEXT PRIMARY KEY,
        display_name     TEXT,
        last_heard       INTEGER,
        favorited        INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS reticulum_messages (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        identity_id  TEXT NOT NULL,
        sender_id    TEXT NOT NULL,
        sender_name  TEXT,
        payload      TEXT NOT NULL,
        timestamp    INTEGER NOT NULL,
        to_hash      TEXT
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS node_notes (
        node_id INTEGER PRIMARY KEY,
        notes TEXT NOT NULL DEFAULT '',
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS chat_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        protocol TEXT NOT NULL CHECK(protocol IN (${meshProtocolSqlInList()})),
        view_key TEXT NOT NULL,
        channel INTEGER NOT NULL,
        to_node INTEGER,
        payload TEXT NOT NULL,
        reply_id INTEGER,
        status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','blocked','failed')),
        error TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        group_id TEXT,
        group_index INTEGER,
        group_total INTEGER
      );
    `;

/**
 * All `CREATE UNIQUE INDEX` entries need a matching dedupe path in `structuralUpgrades`
 * (or a proof the table is empty) before the index can be built on legacy data.
 * @see src/main/db-schema-sync.unique-indexes.test.ts (contract + duplicate-key regressions)
 */
export const INDEX_DDLS: readonly string[] = [
  'CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)',
  'CREATE INDEX IF NOT EXISTS idx_messages_channel_ts ON messages(channel, timestamp DESC)',
  'CREATE INDEX IF NOT EXISTS idx_messages_packet_id ON messages(packet_id)',
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_reaction_dedup
        ON messages(sender_id, reply_id, emoji)
        WHERE emoji IS NOT NULL AND reply_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_packet_dedup
        ON messages(sender_id, packet_id)
        WHERE packet_id IS NOT NULL`,
  'CREATE INDEX IF NOT EXISTS idx_reticulum_msgs_ts ON reticulum_messages(timestamp)',
  'CREATE INDEX IF NOT EXISTS idx_reticulum_msgs_identity ON reticulum_messages(identity_id, timestamp DESC)',
  'CREATE INDEX IF NOT EXISTS idx_mc_msgs_ts ON meshcore_messages(timestamp)',
  'CREATE INDEX IF NOT EXISTS idx_mc_msgs_channel_id ON meshcore_messages(channel_idx, id DESC)',
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mc_msg_dedup
        ON meshcore_messages(sender_id, timestamp, channel_idx, payload)
        WHERE sender_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_mc_msg_dedup_null_sender
        ON meshcore_messages(timestamp, channel_idx, payload)
        WHERE sender_id IS NULL`,
  'CREATE INDEX IF NOT EXISTS idx_position_history_node_time ON position_history(node_id, recorded_at)',
  'CREATE INDEX IF NOT EXISTS idx_position_history_time ON position_history(recorded_at)',
  'CREATE INDEX IF NOT EXISTS idx_contact_groups_self ON contact_groups(self_node_id)',
  'CREATE INDEX IF NOT EXISTS idx_meshcore_trace_history_node_id ON meshcore_trace_history(node_id)',
  'CREATE INDEX IF NOT EXISTS idx_meshcore_path_history_node ON meshcore_path_history(node_id)',
  'CREATE INDEX IF NOT EXISTS idx_chat_outbox_drain ON chat_outbox(protocol, status, next_retry_at)',
  'CREATE INDEX IF NOT EXISTS idx_chat_outbox_view ON chat_outbox(protocol, view_key, created_at)',
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
    rx_hops: 'INTEGER',
    via_store_forward: 'INTEGER DEFAULT 0',
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
    rx_hops: 'INTEGER',
    room_server_id: 'INTEGER',
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
  node_notes: {
    notes: "TEXT NOT NULL DEFAULT ''",
    updated_at: 'INTEGER',
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

/** Legacy meshcore_messages dedup index lacked payload; drop, dedupe, then recreate (historical v17). */
function ensureMeshcoreMessagesDedupIndex(db: NodeSqliteDB): void {
  db.execScript('DROP INDEX IF EXISTS idx_mc_msg_dedup');
  db.execScript('DROP INDEX IF EXISTS idx_mc_msg_dedup_null_sender');
  if (tableExists(db, 'meshcore_messages')) {
    db.prepare(
      `DELETE FROM meshcore_messages
         WHERE id NOT IN (
           SELECT MIN(id) FROM meshcore_messages
           WHERE sender_id IS NOT NULL
           GROUP BY sender_id, timestamp, channel_idx, payload
         )
         AND sender_id IS NOT NULL`,
    ).run();
    db.prepare(
      `DELETE FROM meshcore_messages
         WHERE sender_id IS NULL
         AND id NOT IN (
           SELECT MIN(id) FROM meshcore_messages
           WHERE sender_id IS NULL
           GROUP BY timestamp, channel_idx, payload
         )`,
    ).run();
  }
  db.execScript(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_mc_msg_dedup ' +
      'ON meshcore_messages(sender_id, timestamp, channel_idx, payload) ' +
      'WHERE sender_id IS NOT NULL',
  );
  db.execScript(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_mc_msg_dedup_null_sender ' +
      'ON meshcore_messages(timestamp, channel_idx, payload) ' +
      'WHERE sender_id IS NULL',
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

/**
 * Remove duplicate reaction rows before idx_reaction_dedup (historical migration v4).
 * Same failure mode as packet dedup: CREATE UNIQUE INDEX fails if duplicates exist.
 * Idempotent when idx_reaction_dedup already exists.
 */
function ensureMessagesReactionDedup(db: NodeSqliteDB): void {
  const idx = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_reaction_dedup' LIMIT 1`)
    .get();
  if (idx !== undefined) return;
  if (!tableExists(db, 'messages')) return;

  db.prepare(
    `DELETE FROM messages
         WHERE id NOT IN (
           SELECT MIN(id) FROM messages
           WHERE emoji IS NOT NULL AND reply_id IS NOT NULL
           GROUP BY sender_id, reply_id, emoji
         )
         AND emoji IS NOT NULL AND reply_id IS NOT NULL`,
  ).run();

  db.execScript(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_reaction_dedup
        ON messages(sender_id, reply_id, emoji)
        WHERE emoji IS NOT NULL AND reply_id IS NOT NULL`,
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

const MESHCORE_LAST_ADVERT_MIN_PLAUSIBLE_SEC = 1_000_000_000;
const MESHTASTIC_ORPHAN_SENDING_WINDOW_MS = 120_000;
const MESHTASTIC_STALE_SENDING_MS = 24 * 3_600_000;

/**
 * Convert legacy millisecond `nodes.last_heard` values to Unix seconds (schema v36).
 * Idempotent — safe on every startup.
 */
function repairNodesLastHeardUnits(db: NodeSqliteDB): void {
  if (!tableExists(db, 'nodes')) return;
  db.prepare(
    `UPDATE nodes SET last_heard = CAST(last_heard / 1000 AS INTEGER)
     WHERE last_heard >= ?`,
  ).run(LAST_HEARD_MS_THRESHOLD);
}

/**
 * Delete orphan optimistic `sending` rows when an acked twin exists; promote aged lone sends to failed.
 * Idempotent — safe on every startup.
 */
function repairMeshtasticOrphanSendingMessages(db: NodeSqliteDB): void {
  if (!tableExists(db, 'messages')) return;

  db.prepare(
    `DELETE FROM messages
     WHERE status = 'sending'
       AND id IN (
         SELECT s.id FROM messages s
         INNER JOIN messages a ON s.id != a.id
           AND s.sender_id = a.sender_id
           AND s.channel = a.channel
           AND s.payload = a.payload
           AND a.status != 'sending'
           AND ABS(a.timestamp - s.timestamp) <= ?
       )`,
  ).run(MESHTASTIC_ORPHAN_SENDING_WINDOW_MS);

  const staleCutoff = Date.now() - MESHTASTIC_STALE_SENDING_MS;
  db.prepare(
    `UPDATE messages SET status = 'failed'
     WHERE status = 'sending' AND timestamp < ?`,
  ).run(staleCutoff);
}

/**
 * Delete orphan optimistic MeshCore `sending` rows when an acked/failed twin exists; promote stale
 * room posts to acked; fail aged lone sends (mirrors Meshtastic repair + hydration threshold).
 * Idempotent — safe on every startup.
 */
function repairMeshcoreOrphanSendingMessages(db: NodeSqliteDB): void {
  if (!tableExists(db, 'meshcore_messages')) return;

  db.prepare(
    `DELETE FROM meshcore_messages
     WHERE status = 'sending'
       AND id IN (
         SELECT s.id FROM meshcore_messages s
         INNER JOIN meshcore_messages a ON s.id != a.id
           AND s.sender_id = a.sender_id
           AND s.channel_idx = a.channel_idx
           AND s.payload = a.payload
           AND a.status != 'sending'
           AND ABS(a.timestamp - s.timestamp) <= ?
       )`,
  ).run(MESHTASTIC_ORPHAN_SENDING_WINDOW_MS);

  const staleRoomCutoff = Date.now() - MESHCORE_ROOM_STALE_SENDING_MS;
  db.prepare(
    `UPDATE meshcore_messages SET status = 'acked'
     WHERE status = 'sending'
       AND (channel_idx = ? OR room_server_id IS NOT NULL)
       AND timestamp < ?`,
  ).run(MESHCORE_ROOM_MESSAGE_CHANNEL, staleRoomCutoff);

  const staleCutoff = Date.now() - MESHTASTIC_STALE_SENDING_MS;
  db.prepare(
    `UPDATE meshcore_messages SET status = 'failed'
     WHERE status = 'sending' AND timestamp < ?`,
  ).run(staleCutoff);
}

/** Default inbound Meshtastic rows that bypassed column default via explicit NULL insert. */
function repairMeshtasticInboundNullStatus(db: NodeSqliteDB): void {
  if (!tableExists(db, 'messages')) return;
  db.prepare(
    `UPDATE messages SET status = 'acked'
     WHERE status IS NULL
       AND (received_via IS NOT NULL OR packet_id IS NOT NULL)`,
  ).run();
}

/** Remove MeshCore contact rows incorrectly persisted in the Meshtastic `nodes` table. */
function purgeMeshcoreRowsFromMeshtasticNodesTable(db: NodeSqliteDB): void {
  if (!tableExists(db, 'nodes')) return;
  const placeholders = MESHCORE_CONTACT_HW_LABELS.map(() => '?').join(', ');
  db.prepare(`DELETE FROM nodes WHERE hw_model IN (${placeholders})`).run(
    ...MESHCORE_CONTACT_HW_LABELS,
  );
}

/**
 * Repair repeater uptime stored as last_advert, invalid GPS, and orphan hop rows (schema v35).
 * Idempotent — safe on every startup.
 */
function repairMeshcoreContactDataQuality(db: NodeSqliteDB): void {
  if (!tableExists(db, 'meshcore_contacts')) return;

  const nowSec = Math.floor(Date.now() / 1000);
  const maxFutureSec = nowSec + MESHCORE_LAST_ADVERT_MAX_FUTURE_SKEW_SEC;
  db.prepare(
    `UPDATE meshcore_contacts SET last_advert = ?
     WHERE last_advert IS NOT NULL AND last_advert > ?`,
  ).run(nowSec, maxFutureSec);

  if (tableExists(db, 'meshcore_hop_history')) {
    db.prepare(
      `UPDATE meshcore_contacts
         SET last_advert = (
           SELECT CAST(h.timestamp / 1000 AS INTEGER)
           FROM meshcore_hop_history h
           WHERE h.node_id = meshcore_contacts.node_id
             AND h.timestamp >= 1000000000000
         )
       WHERE last_advert IS NOT NULL
         AND last_advert < ?
         AND EXISTS (
           SELECT 1 FROM meshcore_hop_history h
           WHERE h.node_id = meshcore_contacts.node_id
             AND h.timestamp >= 1000000000000
         )`,
    ).run(MESHCORE_LAST_ADVERT_MIN_PLAUSIBLE_SEC);

    db.prepare(
      `DELETE FROM meshcore_hop_history
       WHERE node_id NOT IN (SELECT node_id FROM meshcore_contacts)`,
    ).run();
  }

  db.prepare(
    `UPDATE meshcore_contacts
     SET last_advert = NULL
     WHERE last_advert IS NOT NULL AND last_advert < ?`,
  ).run(MESHCORE_LAST_ADVERT_MIN_PLAUSIBLE_SEC);

  db.prepare(
    `UPDATE meshcore_contacts SET adv_lat = NULL WHERE adv_lat IS NOT NULL AND (adv_lat < -90 OR adv_lat > 90)`,
  ).run();
  db.prepare(
    `UPDATE meshcore_contacts SET adv_lon = NULL WHERE adv_lon IS NOT NULL AND (adv_lon < -180 OR adv_lon > 180)`,
  ).run();

  if (tableExists(db, 'meshcore_messages')) {
    db.prepare(
      `DELETE FROM meshcore_messages
       WHERE id IN (
         SELECT m2.id FROM meshcore_messages m1
         INNER JOIN meshcore_messages m2 ON m1.id < m2.id
           AND m1.channel_idx = -1 AND m2.channel_idx = -1
           AND m1.received_via = 'rf' AND m2.received_via = 'rf'
           AND m1.sender_id IS NOT NULL AND m1.sender_id = m2.sender_id
           AND COALESCE(m1.to_node, -1) = COALESCE(m2.to_node, -1)
           AND m1.payload = m2.payload
           AND ABS(m2.timestamp - m1.timestamp) <= 120000
       )`,
    ).run();
  }
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
  ensureMessagesReactionDedup(db);
  ensureMeshcoreMessagesDedupIndex(db);
  migrateLegacyContactGroups(db);
  rebuildMeshcoreTraceHistoryIfNeeded(db);
  repairNodesLastHeardUnits(db);
  repairMeshcoreContactDataQuality(db);
  repairMeshtasticOrphanSendingMessages(db);
  repairMeshcoreOrphanSendingMessages(db);
  repairMeshtasticInboundNullStatus(db);
  purgeMeshcoreRowsFromMeshtasticNodesTable(db);
}

/**
 * Apply declarative schema sync + structural upgrades, then bump user_version when behind.
 * Safe to call on every startup (idempotent).
 */
export function runSchemaUpgrade(db: NodeSqliteDB): void {
  const cur = db.pragma('user_version', { simple: true }) as number;
  if (cur > CURRENT_SCHEMA_VERSION) {
    throw new DatabaseSchemaTooNewError(cur, CURRENT_SCHEMA_VERSION);
  }

  try {
    ensureTablesOnly(db);
    ensureColumns(db);
    structuralUpgrades(db);
    ensureIndexes(db);
    seedAppSettings(db);

    const versionAfterSync = db.pragma('user_version', { simple: true }) as number;
    if (versionAfterSync < CURRENT_SCHEMA_VERSION) {
      db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
    }
  } catch (e) {
    if (isDatabaseSchemaTooNewError(e)) throw e;
    console.error(
      '[db] runSchemaUpgrade failed',
      sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
    );
    throw new Error(`runSchemaUpgrade failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

import { app } from "electron";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";

let db: Database.Database | null = null;

export function getDatabasePath(): string {
  return path.join(app.getPath("userData"), "mesh-client.db");
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
      `Check folder permissions for your OS user account.`
    );
  }

  try {
    db = new Database(dbPath, { timeout: 5000 });
    // Restrict DB file to owner-only access (no-op on Windows)
    try { fs.chmodSync(dbPath, 0o600); } catch { /* Windows */ }
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");

    // Detect fresh DB before running setup (user_version = 0, no tables yet)
    const isFreshDb =
      (db.pragma("user_version", { simple: true }) as number) === 0 &&
      !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'").get();

    const setup = db.transaction(() => {
      createBaseTables();
      if (isFreshDb) {
        // Base DDL already includes all columns; stamp current schema version
        db!.pragma("user_version = 7");
      } else {
        runMigrations();
      }
    });
    setup();

    const version = db.pragma("user_version", { simple: true });
    console.log(`Database initialized at ${dbPath} (user_version = ${version})`);
  } catch (error) {
    console.error("Database init failed:", error);
    throw error;
  }
}

export function getDatabase(): Database.Database {
  if (!db) initDatabase();
  return db!;
}

function createBaseTables(): void {
  try {
    db!.exec(`
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
        to_node INTEGER
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
        source TEXT DEFAULT 'rf'
      );

      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_channel_ts ON messages(channel, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_nodes_last_heard ON nodes(last_heard);
    `);
  } catch (error) {
    throw new Error(
      `Failed to create base tables: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function runMigrations(): void {
  let userVersion = db!.pragma("user_version", { simple: true }) as number;

  if (userVersion < 1) {
    try {
      db!.exec("ALTER TABLE messages ADD COLUMN packet_id INTEGER");
      db!.exec("ALTER TABLE messages ADD COLUMN status TEXT DEFAULT 'acked'");
      db!.exec("ALTER TABLE messages ADD COLUMN error TEXT");
      db!.pragma("user_version = 1");
      userVersion = 1;
    } catch (e) {
      throw new Error(
        `Migration v1 failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  if (userVersion < 2) {
    try {
      db!.exec("ALTER TABLE messages ADD COLUMN emoji INTEGER");
      db!.exec("ALTER TABLE messages ADD COLUMN reply_id INTEGER");
      db!.pragma("user_version = 2");
      userVersion = 2;
    } catch (e) {
      throw new Error(
        `Migration v2 failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  if (userVersion < 3) {
    try {
      db!.exec("ALTER TABLE messages ADD COLUMN to_node INTEGER");
      db!.pragma("user_version = 3");
      userVersion = 3;
    } catch (e) {
      throw new Error(`Migration v3 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 4) {
    try {
      db!.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_reaction_dedup " +
        "ON messages(sender_id, reply_id, emoji) " +
        "WHERE emoji IS NOT NULL AND reply_id IS NOT NULL"
      );
      db!.pragma("user_version = 4");
      userVersion = 4;
    } catch (e) {
      throw new Error(`Migration v4 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 5) {
    try {
      db!.prepare("ALTER TABLE nodes ADD COLUMN favorited INTEGER DEFAULT 0").run();
      db!.pragma("user_version = 5");
      userVersion = 5;
    } catch (e) {
      throw new Error(`Migration v5 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 6) {
    try {
      db!.prepare(
        "CREATE INDEX IF NOT EXISTS idx_messages_channel_ts ON messages(channel, timestamp DESC)"
      ).run();
      db!.pragma("user_version = 6");
      userVersion = 6;
    } catch (e) {
      throw new Error(`Migration v6 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (userVersion < 7) {
    try {
      db!.prepare("ALTER TABLE nodes ADD COLUMN source TEXT DEFAULT 'rf'").run();
      db!.pragma("user_version = 7");
    } catch (e) {
      throw new Error(`Migration v7 failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

export async function exportDatabase(destPath: string): Promise<void> {
  await getDatabase().backup(destPath);
}

export function mergeDatabase(sourcePath: string) {
  const targetDb = getDatabase();
  let sourceDb: Database.Database | undefined;

  try {
    sourceDb = new Database(sourcePath, { readonly: true });

    const sourceNodes = sourceDb.prepare("SELECT * FROM nodes").all() as any[];
    const sourceMessages = sourceDb.prepare("SELECT * FROM messages").all() as any[];

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
        "SELECT 1 FROM messages WHERE sender_id = ? AND timestamp = ? AND payload = ? LIMIT 1"
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
        if (insertNode.run(node).changes > 0) nodesAdded++;
      }

      for (const msg of sourceMessages) {
        if (!checkMessage.get(msg.sender_id, msg.timestamp, msg.payload)) {
          insertMessage.run(msg);
          messagesAdded++;
        }
      }

      return { nodesAdded, messagesAdded };
    })();

    return result;
  } catch (err) {
    console.error("Merge failed:", err);
    throw err;
  } finally {
    if (sourceDb) sourceDb.close();
  }
}

export function deleteNodesBySource(source: string): number {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM nodes WHERE source = ?").run(source);
  return result.changes;
}

export function closeDatabase(): void {
  if (db) {
    try {
      db.close();
    } catch (err) {
      console.error("Error closing database:", err);
    } finally {
      db = null;
    }
  }
}

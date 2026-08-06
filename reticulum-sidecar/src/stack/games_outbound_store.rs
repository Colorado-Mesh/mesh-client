//! Sidecar-owned overlay for LRGP last-outbound envelope + delivery_state.
//!
//! Lives beside `LrgpStore`'s `games.db` so we do not fork `lrgp-rs` schema.
//! Survives sidecar restart so Resend can reuse the same envelope/nonce.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, OptionalExtension, params};

/// Cap rows so abandoned sessions cannot retain resend bytes forever.
pub const MAX_OUTBOUND_ROWS: usize = 256;

#[derive(Debug, Clone)]
pub struct OutboundRow {
    pub session_id: String,
    pub envelope: Vec<u8>,
    pub message_hash: Option<String>,
    pub delivery_state: String,
    pub app_id: Option<String>,
}

pub struct GamesOutboundStore {
    conn: Mutex<Connection>,
}

impl GamesOutboundStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| format!("games_outbound open: {e}"))?;
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| format!("games_outbound pragma: {e}"))?;
        let store = Self {
            conn: Mutex::new(conn),
        };
        store.init_tables()?;
        Ok(store)
    }

    fn init_tables(&self) -> Result<(), String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "games_outbound poisoned".to_string())?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS game_outbound (
                session_id TEXT NOT NULL,
                identity_id TEXT NOT NULL,
                envelope BLOB NOT NULL,
                message_hash TEXT,
                delivery_state TEXT NOT NULL DEFAULT 'idle',
                app_id TEXT,
                updated_at REAL NOT NULL,
                PRIMARY KEY (session_id, identity_id)
            );
            CREATE INDEX IF NOT EXISTS idx_game_outbound_message_hash
                ON game_outbound(message_hash)
                WHERE message_hash IS NOT NULL;
            ",
        )
        .map_err(|e| format!("games_outbound init: {e}"))?;
        Ok(())
    }

    pub fn upsert(
        &self,
        session_id: &str,
        identity_id: &str,
        envelope: &[u8],
        message_hash: Option<&str>,
        delivery_state: &str,
        app_id: Option<&str>,
    ) -> Result<(), String> {
        let updated_at = now_secs();
        let conn = self
            .conn
            .lock()
            .map_err(|_| "games_outbound poisoned".to_string())?;
        conn.execute(
            "INSERT INTO game_outbound
             (session_id, identity_id, envelope, message_hash, delivery_state, app_id, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(session_id, identity_id) DO UPDATE SET
               envelope = excluded.envelope,
               message_hash = excluded.message_hash,
               delivery_state = excluded.delivery_state,
               app_id = COALESCE(excluded.app_id, game_outbound.app_id),
               updated_at = excluded.updated_at",
            params![
                session_id,
                identity_id,
                envelope,
                message_hash,
                delivery_state,
                app_id,
                updated_at,
            ],
        )
        .map_err(|e| format!("games_outbound upsert: {e}"))?;
        Ok(())
    }

    /// Update delivery_state / message_hash without requiring envelope bytes.
    pub fn set_delivery_state(
        &self,
        session_id: &str,
        identity_id: &str,
        delivery_state: &str,
        message_hash: Option<&str>,
        app_id: Option<&str>,
    ) -> Result<(), String> {
        let updated_at = now_secs();
        let conn = self
            .conn
            .lock()
            .map_err(|_| "games_outbound poisoned".to_string())?;
        let existing: Option<Vec<u8>> = conn
            .query_row(
                "SELECT envelope FROM game_outbound WHERE session_id = ?1 AND identity_id = ?2",
                params![session_id, identity_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("games_outbound read: {e}"))?;
        let Some(envelope) = existing else {
            // No prior envelope — still record delivery_state with empty blob so
            // list/detail can surface failed enqueue without a resend cache.
            conn.execute(
                "INSERT INTO game_outbound
                 (session_id, identity_id, envelope, message_hash, delivery_state, app_id, updated_at)
                 VALUES (?1, ?2, X'', ?3, ?4, ?5, ?6)
                 ON CONFLICT(session_id, identity_id) DO UPDATE SET
                   message_hash = COALESCE(excluded.message_hash, game_outbound.message_hash),
                   delivery_state = excluded.delivery_state,
                   app_id = COALESCE(excluded.app_id, game_outbound.app_id),
                   updated_at = excluded.updated_at",
                params![
                    session_id,
                    identity_id,
                    message_hash,
                    delivery_state,
                    app_id,
                    updated_at,
                ],
            )
            .map_err(|e| format!("games_outbound set_delivery: {e}"))?;
            return Ok(());
        };
        let _ = envelope; // presence checked; UPDATE touches delivery columns only
        conn.execute(
            "UPDATE game_outbound SET
               delivery_state = ?3,
               message_hash = COALESCE(?4, message_hash),
               app_id = COALESCE(?5, app_id),
               updated_at = ?6
             WHERE session_id = ?1 AND identity_id = ?2",
            params![
                session_id,
                identity_id,
                delivery_state,
                message_hash,
                app_id,
                updated_at,
            ],
        )
        .map_err(|e| format!("games_outbound set_delivery: {e}"))?;
        Ok(())
    }

    pub fn get(&self, session_id: &str, identity_id: &str) -> Result<Option<OutboundRow>, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "games_outbound poisoned".to_string())?;
        conn.query_row(
            "SELECT session_id, envelope, message_hash, delivery_state, app_id
             FROM game_outbound WHERE session_id = ?1 AND identity_id = ?2",
            params![session_id, identity_id],
            |row| {
                Ok(OutboundRow {
                    session_id: row.get(0)?,
                    envelope: row.get(1)?,
                    message_hash: row.get(2)?,
                    delivery_state: row.get(3)?,
                    app_id: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("games_outbound get: {e}"))
    }

    pub fn get_by_message_hash(
        &self,
        identity_id: &str,
        message_hash: &str,
    ) -> Result<Option<OutboundRow>, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "games_outbound poisoned".to_string())?;
        conn.query_row(
            "SELECT session_id, envelope, message_hash, delivery_state, app_id
             FROM game_outbound
             WHERE identity_id = ?1 AND message_hash = ?2
             ORDER BY updated_at DESC LIMIT 1",
            params![identity_id, message_hash],
            |row| {
                Ok(OutboundRow {
                    session_id: row.get(0)?,
                    envelope: row.get(1)?,
                    message_hash: row.get(2)?,
                    delivery_state: row.get(3)?,
                    app_id: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("games_outbound get_by_hash: {e}"))
    }

    pub fn list_for_identity(&self, identity_id: &str) -> Result<Vec<OutboundRow>, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "games_outbound poisoned".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT session_id, envelope, message_hash, delivery_state, app_id
                 FROM game_outbound WHERE identity_id = ?1",
            )
            .map_err(|e| format!("games_outbound list prepare: {e}"))?;
        let rows = stmt
            .query_map(params![identity_id], |row| {
                Ok(OutboundRow {
                    session_id: row.get(0)?,
                    envelope: row.get(1)?,
                    message_hash: row.get(2)?,
                    delivery_state: row.get(3)?,
                    app_id: row.get(4)?,
                })
            })
            .map_err(|e| format!("games_outbound list: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("games_outbound list row: {e}"))?);
        }
        Ok(out)
    }

    pub fn delete(&self, session_id: &str, identity_id: &str) -> Result<(), String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "games_outbound poisoned".to_string())?;
        conn.execute(
            "DELETE FROM game_outbound WHERE session_id = ?1 AND identity_id = ?2",
            params![session_id, identity_id],
        )
        .map_err(|e| format!("games_outbound delete: {e}"))?;
        Ok(())
    }

    /// Drop oldest rows until at most `MAX_OUTBOUND_ROWS` remain for this identity.
    pub fn prune_to_cap(
        &self,
        identity_id: &str,
        keep_session: Option<&str>,
    ) -> Result<(), String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "games_outbound poisoned".to_string())?;
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM game_outbound WHERE identity_id = ?1",
                params![identity_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("games_outbound count: {e}"))?;
        let overflow = count - MAX_OUTBOUND_ROWS as i64;
        if overflow <= 0 {
            return Ok(());
        }
        // Delete oldest rows that are not the session we just wrote.
        conn.execute(
            "DELETE FROM game_outbound WHERE rowid IN (
               SELECT rowid FROM game_outbound
               WHERE identity_id = ?1
                 AND (?2 IS NULL OR session_id != ?2)
               ORDER BY updated_at ASC
               LIMIT ?3
             )",
            params![identity_id, keep_session, overflow],
        )
        .map_err(|e| format!("games_outbound prune: {e}"))?;
        Ok(())
    }
}

fn now_secs() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_get_survives_reopen() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("games_outbound.db");
        {
            let store = GamesOutboundStore::open(&path).expect("open");
            store
                .upsert(
                    "s1",
                    "id1",
                    b"env-bytes",
                    Some("mh1"),
                    "sending",
                    Some("ttt"),
                )
                .expect("upsert");
        }
        let store = GamesOutboundStore::open(&path).expect("reopen");
        let row = store.get("s1", "id1").expect("get").expect("some");
        assert_eq!(row.envelope, b"env-bytes");
        assert_eq!(row.message_hash.as_deref(), Some("mh1"));
        assert_eq!(row.delivery_state, "sending");
        assert_eq!(row.app_id.as_deref(), Some("ttt"));
    }

    #[test]
    fn get_by_message_hash_and_delete() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = GamesOutboundStore::open(dir.path().join("o.db")).expect("open");
        store
            .upsert("s1", "id1", b"e", Some("abc"), "sending", Some("chess"))
            .expect("upsert");
        let by_hash = store
            .get_by_message_hash("id1", "abc")
            .expect("by hash")
            .expect("some");
        assert_eq!(by_hash.session_id, "s1");
        store.delete("s1", "id1").expect("delete");
        assert!(store.get("s1", "id1").expect("get").is_none());
    }
}

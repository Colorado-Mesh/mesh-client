//! Durable store for LXMF 1.4 `ResumableLxMessage` bytes so signed outbound can
//! be restored across sidecar restarts (`restore_signed` → `submit_signed`).

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, params};

/// Cap abandoned signed outbound rows.
pub const MAX_RESUMABLE_ROWS: usize = 256;
/// Align with LXMF / proxy body budgets.
pub const MAX_RESUMABLE_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone)]
pub struct ResumableRow {
    pub message_hash: String,
    pub method: String,
    pub bytes: Vec<u8>,
}

pub struct LxmfResumableStore {
    conn: Mutex<Connection>,
}

impl LxmfResumableStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| format!("lxmf_resumable open: {e}"))?;
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(|e| format!("lxmf_resumable pragma: {e}"))?;
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
            .map_err(|_| "lxmf_resumable poisoned".to_string())?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS lxmf_resumable (
                message_hash TEXT NOT NULL PRIMARY KEY,
                method TEXT NOT NULL,
                payload BLOB NOT NULL,
                updated_at REAL NOT NULL
            );
            ",
        )
        .map_err(|e| format!("lxmf_resumable init: {e}"))?;
        Ok(())
    }

    pub fn upsert(&self, message_hash: &str, method: &str, payload: &[u8]) -> Result<(), String> {
        if payload.len() > MAX_RESUMABLE_BYTES {
            return Err(format!(
                "lxmf_resumable payload too large ({} > {MAX_RESUMABLE_BYTES})",
                payload.len()
            ));
        }
        let updated_at = now_secs();
        let conn = self
            .conn
            .lock()
            .map_err(|_| "lxmf_resumable poisoned".to_string())?;
        conn.execute(
            "INSERT INTO lxmf_resumable (message_hash, method, payload, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(message_hash) DO UPDATE SET
               method = excluded.method,
               payload = excluded.payload,
               updated_at = excluded.updated_at",
            params![message_hash, method, payload, updated_at],
        )
        .map_err(|e| format!("lxmf_resumable upsert: {e}"))?;
        Self::trim_locked(&conn)?;
        Ok(())
    }

    pub fn delete(&self, message_hash: &str) -> Result<(), String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "lxmf_resumable poisoned".to_string())?;
        conn.execute(
            "DELETE FROM lxmf_resumable WHERE message_hash = ?1",
            params![message_hash],
        )
        .map_err(|e| format!("lxmf_resumable delete: {e}"))?;
        Ok(())
    }

    pub fn list_all(&self) -> Result<Vec<ResumableRow>, String> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| "lxmf_resumable poisoned".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT message_hash, method, payload FROM lxmf_resumable ORDER BY updated_at ASC",
            )
            .map_err(|e| format!("lxmf_resumable list prepare: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ResumableRow {
                    message_hash: row.get(0)?,
                    method: row.get(1)?,
                    bytes: row.get(2)?,
                })
            })
            .map_err(|e| format!("lxmf_resumable list: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("lxmf_resumable list row: {e}"))?);
        }
        Ok(out)
    }

    #[cfg(test)]
    pub fn get(&self, message_hash: &str) -> Result<Option<ResumableRow>, String> {
        use rusqlite::OptionalExtension;
        let conn = self
            .conn
            .lock()
            .map_err(|_| "lxmf_resumable poisoned".to_string())?;
        conn.query_row(
            "SELECT message_hash, method, payload FROM lxmf_resumable WHERE message_hash = ?1",
            params![message_hash],
            |row| {
                Ok(ResumableRow {
                    message_hash: row.get(0)?,
                    method: row.get(1)?,
                    bytes: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("lxmf_resumable get: {e}"))
    }

    fn trim_locked(conn: &Connection) -> Result<(), String> {
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM lxmf_resumable", [], |r| r.get(0))
            .map_err(|e| format!("lxmf_resumable count: {e}"))?;
        if count as usize <= MAX_RESUMABLE_ROWS {
            return Ok(());
        }
        let excess = count as usize - MAX_RESUMABLE_ROWS;
        conn.execute(
            "DELETE FROM lxmf_resumable WHERE message_hash IN (
               SELECT message_hash FROM lxmf_resumable ORDER BY updated_at ASC LIMIT ?1
             )",
            params![excess as i64],
        )
        .map_err(|e| format!("lxmf_resumable trim: {e}"))?;
        Ok(())
    }
}

fn now_secs() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("mesh-lxmf-resumable-{label}-{nanos}.db"))
    }

    #[test]
    fn upsert_get_delete_round_trip() {
        let path = temp_path("round");
        let store = LxmfResumableStore::open(&path).unwrap();
        store.upsert("abcd", "direct", b"payload-bytes").unwrap();
        let row = store.get("abcd").unwrap().expect("row");
        assert_eq!(row.method, "direct");
        assert_eq!(row.bytes, b"payload-bytes");
        store.delete("abcd").unwrap();
        assert!(store.get("abcd").unwrap().is_none());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn list_all_orders_oldest_first() {
        let path = temp_path("list");
        let store = LxmfResumableStore::open(&path).unwrap();
        store.upsert("a", "direct", b"1").unwrap();
        store.upsert("b", "propagated", b"2").unwrap();
        let rows = store.list_all().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].message_hash, "a");
        let _ = std::fs::remove_file(&path);
    }
}

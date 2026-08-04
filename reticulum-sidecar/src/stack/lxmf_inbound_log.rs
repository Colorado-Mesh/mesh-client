//! Ring buffer of recent inbound LXMF payloads for WS catch-up after lag/reconnect.

use std::collections::VecDeque;
use std::sync::Mutex;

/// Cap for recent inbound LXMF payloads retained for catch-up.
pub const MAX_LXMF_INBOUND_LOG: usize = 200;

#[derive(Debug)]
pub struct LxmfInboundBuffer {
    max: usize,
    /// Monotonic opaque sequence stamped onto accepted rows as `ring_seq`.
    next_seq: Mutex<u64>,
    inner: Mutex<VecDeque<serde_json::Value>>,
}

impl LxmfInboundBuffer {
    pub fn new(max: usize) -> Self {
        Self {
            max: max.max(1),
            next_seq: Mutex::new(1),
            inner: Mutex::new(VecDeque::new()),
        }
    }

    /// Push an inbound `lxmf_message` payload. Dedupes by `message_hash` when present.
    /// Stamps a monotonic opaque `ring_seq` on accepted rows for catch-up cursors.
    /// Returns the stamped payload when accepted, or `None` when deduped / lock failed.
    pub fn push(&self, mut payload: serde_json::Value) -> Option<serde_json::Value> {
        let Ok(mut buf) = self.inner.lock() else {
            return None;
        };
        if let Some(hash) = payload
            .get("message_hash")
            .and_then(|v| v.as_str())
            .filter(|h| !h.is_empty())
        {
            if buf.iter().any(|row| {
                row.get("message_hash")
                    .and_then(|v| v.as_str())
                    .is_some_and(|h| h.eq_ignore_ascii_case(hash))
            }) {
                return None;
            }
        }
        let Ok(mut next) = self.next_seq.lock() else {
            return None;
        };
        let seq = *next;
        *next = next.saturating_add(1);
        drop(next);
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("ring_seq".into(), serde_json::json!(seq));
        }
        if buf.len() >= self.max {
            buf.pop_front();
        }
        buf.push_back(payload.clone());
        Some(payload)
    }

    pub fn len(&self) -> usize {
        self.inner.lock().map(|buf| buf.len()).unwrap_or(0)
    }

    /// Snapshot in chronological push order (oldest→newest via `push_back` / `VecDeque::iter`),
    /// filtered by an optional exclusive `(since_ts, since_seq)` cursor, then truncated to
    /// the newest `limit` rows.
    ///
    /// Cursor semantics:
    /// - `since_ts` alone: keep rows with `timestamp > since_ts` (legacy exclusive ms bound).
    /// - `since_ts` + `since_seq`: keep rows after that complete cursor —
    ///   `timestamp > since_ts` **or** (`timestamp == since_ts` **and** `ring_seq > since_seq`).
    ///   Same-ms twins after the stamped sequence are therefore recoverable without
    ///   re-returning already-processed boundary rows.
    pub fn snapshot(
        &self,
        since_ts: Option<i64>,
        since_seq: Option<u64>,
        limit: usize,
    ) -> Vec<serde_json::Value> {
        let limit = limit.max(1);
        let Ok(buf) = self.inner.lock() else {
            return Vec::new();
        };
        let mut out: Vec<serde_json::Value> = buf
            .iter()
            .filter(|row| after_catch_up_cursor(row, since_ts, since_seq))
            .cloned()
            .collect();
        if out.len() > limit {
            out = out.split_off(out.len() - limit);
        }
        out
    }
}

fn row_timestamp(row: &serde_json::Value) -> Option<i64> {
    row.get("timestamp").and_then(serde_json::Value::as_i64)
}

fn row_ring_seq(row: &serde_json::Value) -> u64 {
    row.get("ring_seq")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0)
}

fn after_catch_up_cursor(
    row: &serde_json::Value,
    since_ts: Option<i64>,
    since_seq: Option<u64>,
) -> bool {
    let Some(min_ts) = since_ts else {
        return true;
    };
    let Some(ts) = row_timestamp(row) else {
        return false;
    };
    if ts > min_ts {
        return true;
    }
    if ts < min_ts {
        return false;
    }
    // Same millisecond as the cursor: require a sequence past `since_seq`.
    match since_seq {
        Some(min_seq) => row_ring_seq(row) > min_seq,
        // Timestamp-only exclusive bound (legacy): drop the entire ms bucket.
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(hash: &str, ts: i64, text: &str) -> serde_json::Value {
        serde_json::json!({
            "message_hash": hash,
            "timestamp": ts,
            "text": text,
            "sender_hash": "aa".repeat(16),
            "direction": "inbound",
        })
    }

    #[test]
    fn ring_evicts_oldest_and_dedupes_hash() {
        let buf = LxmfInboundBuffer::new(2);
        assert!(buf.push(msg("h1", 1, "a")).is_some());
        assert!(buf.push(msg("h2", 2, "b")).is_some());
        assert!(buf.push(msg("h1", 1, "a-dup")).is_none());
        assert!(buf.push(msg("h3", 3, "c")).is_some());
        let rows = buf.snapshot(None, None, 10);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["message_hash"], "h2");
        assert_eq!(rows[1]["message_hash"], "h3");
    }

    #[test]
    fn since_ts_filters_exclusive_and_limit_keeps_newest() {
        let buf = LxmfInboundBuffer::new(10);
        buf.push(msg("h1", 100, "a"));
        buf.push(msg("h2", 200, "b"));
        buf.push(msg("h3", 300, "c"));
        let rows = buf.snapshot(Some(200), None, 2);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["message_hash"], "h3");
    }

    #[test]
    fn since_ts_at_boundary_returns_empty() {
        let buf = LxmfInboundBuffer::new(10);
        buf.push(msg("h2", 200, "b"));
        let rows = buf.snapshot(Some(200), None, 10);
        assert!(rows.is_empty());
    }

    #[test]
    fn since_ts_none_returns_full_chronological_buffer() {
        let buf = LxmfInboundBuffer::new(10);
        buf.push(msg("h1", 100, "a"));
        buf.push(msg("h2", 200, "b"));
        buf.push(msg("h3", 300, "c"));
        let rows = buf.snapshot(None, None, 10);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0]["message_hash"], "h1");
        assert_eq!(rows[1]["message_hash"], "h2");
        assert_eq!(rows[2]["message_hash"], "h3");
    }

    #[test]
    fn same_ms_twins_recoverable_via_ring_seq_cursor() {
        let buf = LxmfInboundBuffer::new(10);
        let a = buf.push(msg("h_a", 200, "a")).expect("accepted");
        let b = buf.push(msg("h_b", 200, "b")).expect("accepted");
        let seq_a = a["ring_seq"].as_u64().expect("seq a");
        let seq_b = b["ring_seq"].as_u64().expect("seq b");
        assert!(seq_b > seq_a);

        // After processing only the first twin, the second same-ms row must still be returned.
        let after_a = buf.snapshot(Some(200), Some(seq_a), 10);
        assert_eq!(after_a.len(), 1);
        assert_eq!(after_a[0]["message_hash"], "h_b");
        assert_eq!(after_a[0]["ring_seq"], seq_b);

        // Complete cursor at the second twin — no reprocessing.
        let after_b = buf.snapshot(Some(200), Some(seq_b), 10);
        assert!(after_b.is_empty());

        // Timestamp-only exclusive bound still drops the whole ms bucket (legacy clients).
        let ts_only = buf.snapshot(Some(200), None, 10);
        assert!(ts_only.is_empty());
    }

    #[test]
    fn push_stamps_monotonic_ring_seq_on_accepted_rows() {
        let buf = LxmfInboundBuffer::new(10);
        let a = buf.push(msg("h1", 1, "a")).expect("a");
        let b = buf.push(msg("h2", 2, "b")).expect("b");
        assert_eq!(a["ring_seq"], 1);
        assert_eq!(b["ring_seq"], 2);
    }
}

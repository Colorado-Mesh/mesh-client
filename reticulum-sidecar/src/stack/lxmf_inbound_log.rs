//! Ring buffer of recent inbound LXMF payloads for WS catch-up after lag/reconnect.

use std::collections::VecDeque;
use std::sync::Mutex;

/// Cap for recent inbound LXMF payloads retained for catch-up.
pub const MAX_LXMF_INBOUND_LOG: usize = 200;

#[derive(Debug)]
pub struct LxmfInboundBuffer {
    max: usize,
    inner: Mutex<VecDeque<serde_json::Value>>,
}

impl LxmfInboundBuffer {
    pub fn new(max: usize) -> Self {
        Self {
            max: max.max(1),
            inner: Mutex::new(VecDeque::new()),
        }
    }

    /// Push an inbound `lxmf_message` payload. Dedupes by `message_hash` when present.
    pub fn push(&self, payload: serde_json::Value) {
        let Ok(mut buf) = self.inner.lock() else {
            return;
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
                return;
            }
        }
        if buf.len() >= self.max {
            buf.pop_front();
        }
        buf.push_back(payload);
    }

    pub fn len(&self) -> usize {
        self.inner.lock().map(|buf| buf.len()).unwrap_or(0)
    }

    /// Snapshot newest-first filtered by optional `since_ts` (exclusive lower bound, ms),
    /// then reverse to chronological order for ingest catch-up.
    ///
    /// Exclusive (`ts > since_ts`) so a watermark equal to the newest ingested timestamp
    /// does not re-return that boundary row on every periodic catch-up.
    /// Same-ms twins at exactly `since_ts` are skipped (accepted tradeoff vs inclusive loop).
    pub fn snapshot(&self, since_ts: Option<i64>, limit: usize) -> Vec<serde_json::Value> {
        let limit = limit.max(1);
        let Ok(buf) = self.inner.lock() else {
            return Vec::new();
        };
        let mut out: Vec<serde_json::Value> = buf
            .iter()
            .filter(|row| match since_ts {
                None => true,
                Some(min_ts) => row
                    .get("timestamp")
                    .and_then(serde_json::Value::as_i64)
                    .is_some_and(|ts| ts > min_ts),
            })
            .cloned()
            .collect();
        if out.len() > limit {
            out = out.split_off(out.len() - limit);
        }
        out
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
        buf.push(msg("h1", 1, "a"));
        buf.push(msg("h2", 2, "b"));
        buf.push(msg("h1", 1, "a-dup"));
        buf.push(msg("h3", 3, "c"));
        let rows = buf.snapshot(None, 10);
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
        let rows = buf.snapshot(Some(200), 2);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["message_hash"], "h3");
    }

    #[test]
    fn since_ts_at_boundary_returns_empty() {
        let buf = LxmfInboundBuffer::new(10);
        buf.push(msg("h2", 200, "b"));
        let rows = buf.snapshot(Some(200), 10);
        assert!(rows.is_empty());
    }

    #[test]
    fn since_ts_none_returns_full_chronological_buffer() {
        let buf = LxmfInboundBuffer::new(10);
        buf.push(msg("h1", 100, "a"));
        buf.push(msg("h2", 200, "b"));
        buf.push(msg("h3", 300, "c"));
        let rows = buf.snapshot(None, 10);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0]["message_hash"], "h1");
        assert_eq!(rows[1]["message_hash"], "h2");
        assert_eq!(rows[2]["message_hash"], "h3");
    }

    #[test]
    fn same_ms_twins_excluded_at_exact_since_ts() {
        let buf = LxmfInboundBuffer::new(10);
        buf.push(msg("h_a", 200, "a"));
        buf.push(msg("h_b", 200, "b"));
        let below = buf.snapshot(Some(199), 10);
        assert_eq!(below.len(), 2);
        let at = buf.snapshot(Some(200), 10);
        assert!(at.is_empty());
    }
}

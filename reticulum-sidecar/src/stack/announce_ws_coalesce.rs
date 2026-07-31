//! Coalesce `announce.received` WS frames so announce storms stay O(1) bus pressure
//! (≤1 frame per flush window) even at ~100k path-table scale.

use std::collections::HashMap;
use std::time::Duration;

/// Normal flush window — mirror renderer peer-refresh coalesce (~400ms) with a small buffer.
pub const ANNOUNCE_WS_COALESCE_MS: u64 = 500;
/// Widen under storm when many distinct destinations are pending in the window.
pub const ANNOUNCE_WS_STORM_COALESCE_MS: u64 = 1000;
/// Pending distinct destinations that trigger the storm flush window.
pub const ANNOUNCE_WS_STORM_PENDING: usize = 256;
/// Max announces included in one WS frame (named preferred); overflow dropped.
pub const ANNOUNCE_WS_FLUSH_MAX: usize = 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnnounceWsRow {
    pub destination_hash: String,
    pub display_name: Option<String>,
    pub hops: u8,
}

/// Pending announces keyed by destination hash (last write wins).
#[derive(Debug, Default)]
pub struct AnnounceWsCoalescer {
    pending: HashMap<String, AnnounceWsRow>,
}

impl AnnounceWsCoalescer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }

    /// Insert or replace the row for this destination.
    pub fn push(&mut self, row: AnnounceWsRow) {
        self.pending.insert(row.destination_hash.clone(), row);
    }

    /// Flush window based on current pending size (storm widens the timer).
    pub fn coalesce_duration(&self) -> Duration {
        if self.pending.len() > ANNOUNCE_WS_STORM_PENDING {
            Duration::from_millis(ANNOUNCE_WS_STORM_COALESCE_MS)
        } else {
            Duration::from_millis(ANNOUNCE_WS_COALESCE_MS)
        }
    }

    /// Drain pending into a capped list (named first), newest-map order otherwise.
    pub fn take_flush_rows(&mut self) -> Vec<AnnounceWsRow> {
        if self.pending.is_empty() {
            return Vec::new();
        }
        let mut named = Vec::new();
        let mut nameless = Vec::new();
        for (_, row) in self.pending.drain() {
            if row
                .display_name
                .as_ref()
                .is_some_and(|n| !n.trim().is_empty())
            {
                named.push(row);
            } else {
                nameless.push(row);
            }
        }
        // Stable-ish: named first (prefer keeping labels), then nameless.
        named.extend(nameless);
        if named.len() > ANNOUNCE_WS_FLUSH_MAX {
            named.truncate(ANNOUNCE_WS_FLUSH_MAX);
        }
        named
    }
}

/// Build the WS text frame for one flush. Single-row keeps the legacy payload shape.
pub fn build_announce_received_frame(rows: &[AnnounceWsRow]) -> Option<String> {
    if rows.is_empty() {
        return None;
    }
    let payload = if rows.len() == 1 {
        let r = &rows[0];
        serde_json::json!({
            "destination_hash": r.destination_hash,
            "display_name": r.display_name,
            "hops": r.hops,
        })
    } else {
        let announces: Vec<serde_json::Value> = rows
            .iter()
            .map(|r| {
                serde_json::json!({
                    "destination_hash": r.destination_hash,
                    "display_name": r.display_name,
                    "hops": r.hops,
                })
            })
            .collect();
        serde_json::json!({ "announces": announces })
    };
    Some(
        serde_json::json!({
            "type": "announce.received",
            "payload": payload,
        })
        .to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(hash: &str, name: Option<&str>) -> AnnounceWsRow {
        AnnounceWsRow {
            destination_hash: hash.to_string(),
            display_name: name.map(str::to_string),
            hops: 1,
        }
    }

    #[test]
    fn last_write_wins_per_destination() {
        let mut c = AnnounceWsCoalescer::new();
        c.push(row("aa", Some("Old")));
        c.push(row("aa", Some("New")));
        c.push(row("bb", None));
        let flushed = c.take_flush_rows();
        assert!(c.is_empty());
        assert_eq!(flushed.len(), 2);
        let aa = flushed
            .iter()
            .find(|r| r.destination_hash == "aa")
            .expect("aa");
        assert_eq!(aa.display_name.as_deref(), Some("New"));
    }

    #[test]
    fn flush_prefers_named_when_over_cap() {
        let mut c = AnnounceWsCoalescer::new();
        for i in 0..(ANNOUNCE_WS_FLUSH_MAX + 50) {
            c.push(row(&format!("{i:032x}"), None));
        }
        for i in 0..10 {
            c.push(row(&format!("n{i:030x}"), Some(&format!("Peer{i}"))));
        }
        let flushed = c.take_flush_rows();
        assert_eq!(flushed.len(), ANNOUNCE_WS_FLUSH_MAX);
        let named = flushed
            .iter()
            .filter(|r| {
                r.display_name
                    .as_ref()
                    .is_some_and(|n| n.starts_with("Peer"))
            })
            .count();
        assert_eq!(named, 10);
    }

    #[test]
    fn storm_widens_coalesce_duration() {
        let mut c = AnnounceWsCoalescer::new();
        for i in 0..=ANNOUNCE_WS_STORM_PENDING {
            c.push(row(&format!("{i:032x}"), None));
        }
        assert_eq!(
            c.coalesce_duration(),
            Duration::from_millis(ANNOUNCE_WS_STORM_COALESCE_MS)
        );
        let mut small = AnnounceWsCoalescer::new();
        small.push(row("aa", None));
        assert_eq!(
            small.coalesce_duration(),
            Duration::from_millis(ANNOUNCE_WS_COALESCE_MS)
        );
    }

    #[test]
    fn build_frame_single_keeps_legacy_shape() {
        let frame = build_announce_received_frame(&[row("aa", Some("Alice"))]).unwrap();
        let v: serde_json::Value = serde_json::from_str(&frame).unwrap();
        assert_eq!(v["type"], "announce.received");
        assert_eq!(v["payload"]["destination_hash"], "aa");
        assert!(v["payload"].get("announces").is_none());
    }

    #[test]
    fn build_frame_many_uses_announces_array() {
        let frame =
            build_announce_received_frame(&[row("aa", Some("A")), row("bb", None)]).unwrap();
        let v: serde_json::Value = serde_json::from_str(&frame).unwrap();
        assert_eq!(v["payload"]["announces"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn many_distinct_dests_still_one_flush_batch() {
        let mut c = AnnounceWsCoalescer::new();
        for i in 0..5000 {
            c.push(row(&format!("{i:032x}"), None));
        }
        // One take_flush_rows call = one WS frame worth of rows (capped).
        let flushed = c.take_flush_rows();
        assert_eq!(flushed.len(), ANNOUNCE_WS_FLUSH_MAX);
        assert!(c.is_empty());
        assert!(build_announce_received_frame(&flushed).is_some());
    }
}

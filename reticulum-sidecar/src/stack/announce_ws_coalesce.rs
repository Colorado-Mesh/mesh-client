//! Coalesce `announce.received` WS frames so announce storms stay O(1) bus pressure
//! (≤1 frame per flush window) even at ~100k path-table scale.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
    /// Known destination aspect string when `name_hash` maps (e.g. `lxmf.delivery`).
    pub aspect: Option<String>,
    /// Identity hash recovered from the announce payload (hex), when present.
    pub identity_hash: Option<String>,
}

/// Snapshot published for `GET /api/v1/diagnostics` (`announce_ws`).
/// Field names match the IPC JSON contract (`last_*`).
#[allow(clippy::struct_field_names)]
#[derive(Debug, Clone, Copy, Default)]
pub struct AnnounceWsPressureSnapshot {
    pub last_window_ingress: u64,
    pub last_window_unique: u64,
    pub last_window_overflow: u64,
    pub last_storm_at_ms: u64,
    pub last_flush_at_ms: u64,
}

static LAST_WINDOW_INGRESS: AtomicU64 = AtomicU64::new(0);
static LAST_WINDOW_UNIQUE: AtomicU64 = AtomicU64::new(0);
static LAST_WINDOW_OVERFLOW: AtomicU64 = AtomicU64::new(0);
static LAST_STORM_AT_MS: AtomicU64 = AtomicU64::new(0);
static LAST_FLUSH_AT_MS: AtomicU64 = AtomicU64::new(0);

#[cfg(feature = "rns-stack")]
static KNOWN_ANNOUNCE_ASPECTS: std::sync::OnceLock<Vec<([u8; 10], &'static str)>> =
    std::sync::OnceLock::new();

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Publish last-flush pressure metrics for diagnostics.
pub fn record_announce_ws_flush(stats: AnnounceWsPressureSnapshot) {
    LAST_WINDOW_INGRESS.store(stats.last_window_ingress, Ordering::Relaxed);
    LAST_WINDOW_UNIQUE.store(stats.last_window_unique, Ordering::Relaxed);
    LAST_WINDOW_OVERFLOW.store(stats.last_window_overflow, Ordering::Relaxed);
    LAST_FLUSH_AT_MS.store(stats.last_flush_at_ms, Ordering::Relaxed);
    if stats.last_storm_at_ms > 0 {
        LAST_STORM_AT_MS.store(stats.last_storm_at_ms, Ordering::Relaxed);
    }
}

pub fn announce_ws_pressure_snapshot() -> AnnounceWsPressureSnapshot {
    AnnounceWsPressureSnapshot {
        last_window_ingress: LAST_WINDOW_INGRESS.load(Ordering::Relaxed),
        last_window_unique: LAST_WINDOW_UNIQUE.load(Ordering::Relaxed),
        last_window_overflow: LAST_WINDOW_OVERFLOW.load(Ordering::Relaxed),
        last_storm_at_ms: LAST_STORM_AT_MS.load(Ordering::Relaxed),
        last_flush_at_ms: LAST_FLUSH_AT_MS.load(Ordering::Relaxed),
    }
}

/// Pending announces keyed by destination hash (last write wins).
#[derive(Debug, Default)]
pub struct AnnounceWsCoalescer {
    pending: HashMap<String, AnnounceWsRow>,
    /// Total push() calls in the current coalesce window (includes overwrites).
    window_ingress: u64,
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
        self.window_ingress = self.window_ingress.saturating_add(1);
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

    /// Drain pending into a capped list (named first) and publish pressure metrics.
    pub fn take_flush_rows(&mut self) -> Vec<AnnounceWsRow> {
        if self.pending.is_empty() {
            self.window_ingress = 0;
            return Vec::new();
        }
        let unique_before = self.pending.len();
        let storm = unique_before > ANNOUNCE_WS_STORM_PENDING;
        let ingress = self.window_ingress;
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
        let overflow = unique_before.saturating_sub(ANNOUNCE_WS_FLUSH_MAX) as u64;
        if named.len() > ANNOUNCE_WS_FLUSH_MAX {
            named.truncate(ANNOUNCE_WS_FLUSH_MAX);
        }
        let now_ms = now_unix_ms();
        record_announce_ws_flush(AnnounceWsPressureSnapshot {
            last_window_ingress: ingress,
            last_window_unique: unique_before as u64,
            last_window_overflow: overflow,
            last_storm_at_ms: if storm { now_ms } else { 0 },
            last_flush_at_ms: now_ms,
        });
        self.window_ingress = 0;
        named
    }
}

/// Map announce `name_hash` (`SHA-256(app_name)[:10]`) to a known aspect string.
///
/// Unknown / zero hashes return `None` — callers must not invent `"unknown"`.
#[cfg(feature = "rns-stack")]
pub fn resolve_announce_aspect(name_hash: &[u8; 10]) -> Option<&'static str> {
    if name_hash.iter().all(|&b| b == 0) {
        return None;
    }
    let table = KNOWN_ANNOUNCE_ASPECTS.get_or_init(|| {
        [
            "lxmf.delivery",
            "lxmf.propagation",
            "nomadnetwork.node",
            "rrc.hub",
        ]
        .into_iter()
        .map(|aspect| (rns_identity::name_hash::name_hash(aspect), aspect))
        .collect()
    });
    table
        .iter()
        .find(|(nh, _)| nh == name_hash)
        .map(|(_, aspect)| *aspect)
}

fn announce_row_payload(r: &AnnounceWsRow) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    map.insert(
        "destination_hash".to_string(),
        serde_json::Value::String(r.destination_hash.clone()),
    );
    map.insert(
        "display_name".to_string(),
        match &r.display_name {
            Some(n) => serde_json::Value::String(n.clone()),
            None => serde_json::Value::Null,
        },
    );
    map.insert(
        "hops".to_string(),
        serde_json::Value::Number(serde_json::Number::from(r.hops)),
    );
    if let Some(ref aspect) = r.aspect {
        map.insert(
            "aspect".to_string(),
            serde_json::Value::String(aspect.clone()),
        );
    }
    if let Some(ref identity_hash) = r.identity_hash {
        map.insert(
            "identity_hash".to_string(),
            serde_json::Value::String(identity_hash.clone()),
        );
    }
    serde_json::Value::Object(map)
}

/// Build the WS text frame for one flush. Single-row keeps the legacy payload shape.
pub fn build_announce_received_frame(rows: &[AnnounceWsRow]) -> Option<String> {
    if rows.is_empty() {
        return None;
    }
    let payload = if rows.len() == 1 {
        announce_row_payload(&rows[0])
    } else {
        let announces: Vec<serde_json::Value> = rows.iter().map(announce_row_payload).collect();
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
    use std::sync::{Mutex, OnceLock};

    /// Process-global pressure atomics — serialize tests that flush / read them.
    fn pressure_metrics_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn row(hash: &str, name: Option<&str>) -> AnnounceWsRow {
        AnnounceWsRow {
            destination_hash: hash.to_string(),
            display_name: name.map(str::to_string),
            hops: 1,
            aspect: None,
            identity_hash: None,
        }
    }

    fn row_full(
        hash: &str,
        name: Option<&str>,
        aspect: Option<&str>,
        identity_hash: Option<&str>,
    ) -> AnnounceWsRow {
        AnnounceWsRow {
            destination_hash: hash.to_string(),
            display_name: name.map(str::to_string),
            hops: 2,
            aspect: aspect.map(str::to_string),
            identity_hash: identity_hash.map(str::to_string),
        }
    }

    #[test]
    fn last_write_wins_per_destination() {
        let _guard = pressure_metrics_lock();
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
        let snap = announce_ws_pressure_snapshot();
        assert_eq!(snap.last_window_ingress, 3);
        assert_eq!(snap.last_window_unique, 2);
        assert_eq!(snap.last_window_overflow, 0);
        assert!(snap.last_flush_at_ms > 0);
    }

    #[test]
    fn last_write_wins_preserves_latest_aspect_and_identity_hash() {
        let _guard = pressure_metrics_lock();
        let mut c = AnnounceWsCoalescer::new();
        c.push(row_full(
            "aa",
            Some("Old"),
            Some("lxmf.propagation"),
            Some("id_old"),
        ));
        c.push(row_full(
            "aa",
            Some("New"),
            Some("lxmf.delivery"),
            Some("id_new"),
        ));
        let flushed = c.take_flush_rows();
        let aa = flushed
            .iter()
            .find(|r| r.destination_hash == "aa")
            .expect("aa");
        assert_eq!(aa.aspect.as_deref(), Some("lxmf.delivery"));
        assert_eq!(aa.identity_hash.as_deref(), Some("id_new"));
    }

    #[test]
    fn flush_prefers_named_when_over_cap_and_records_overflow() {
        let _guard = pressure_metrics_lock();
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
        let snap = announce_ws_pressure_snapshot();
        assert!(snap.last_window_overflow >= 50);
        assert!(snap.last_flush_at_ms > 0);
    }

    #[test]
    fn storm_widens_coalesce_duration_and_stamps_storm_time() {
        let _guard = pressure_metrics_lock();
        let mut c = AnnounceWsCoalescer::new();
        for i in 0..=ANNOUNCE_WS_STORM_PENDING {
            c.push(row(&format!("{i:032x}"), None));
        }
        assert_eq!(
            c.coalesce_duration(),
            Duration::from_millis(ANNOUNCE_WS_STORM_COALESCE_MS)
        );
        let _ = c.take_flush_rows();
        let snap = announce_ws_pressure_snapshot();
        assert!(snap.last_storm_at_ms > 0);
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
        assert!(v["payload"].get("aspect").is_none());
        assert!(v["payload"].get("identity_hash").is_none());
    }

    #[test]
    fn build_frame_single_includes_aspect_and_identity_hash_when_present() {
        let id = "aabbccddeeff00112233445566778899";
        let frame = build_announce_received_frame(&[row_full(
            "aa",
            Some("Alice"),
            Some("lxmf.delivery"),
            Some(id),
        )])
        .unwrap();
        let v: serde_json::Value = serde_json::from_str(&frame).unwrap();
        assert_eq!(v["payload"]["aspect"], "lxmf.delivery");
        assert_eq!(v["payload"]["identity_hash"], id);
        assert_eq!(v["payload"]["hops"], 2);
    }

    #[test]
    fn build_frame_many_uses_announces_array() {
        let frame =
            build_announce_received_frame(&[row("aa", Some("A")), row("bb", None)]).unwrap();
        let v: serde_json::Value = serde_json::from_str(&frame).unwrap();
        assert_eq!(v["payload"]["announces"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn build_frame_batch_carries_per_row_aspect_and_identity_hash() {
        let frame = build_announce_received_frame(&[
            row_full("aa", Some("A"), Some("lxmf.delivery"), Some("id_a")),
            row_full("bb", None, Some("nomadnetwork.node"), None),
            row("cc", Some("C")),
        ])
        .unwrap();
        let v: serde_json::Value = serde_json::from_str(&frame).unwrap();
        let announces = v["payload"]["announces"].as_array().unwrap();
        assert_eq!(announces.len(), 3);
        let aa = announces
            .iter()
            .find(|a| a["destination_hash"] == "aa")
            .expect("aa");
        assert_eq!(aa["aspect"], "lxmf.delivery");
        assert_eq!(aa["identity_hash"], "id_a");
        let bb = announces
            .iter()
            .find(|a| a["destination_hash"] == "bb")
            .expect("bb");
        assert_eq!(bb["aspect"], "nomadnetwork.node");
        assert!(bb.get("identity_hash").is_none());
        let cc = announces
            .iter()
            .find(|a| a["destination_hash"] == "cc")
            .expect("cc");
        assert!(cc.get("aspect").is_none());
        assert!(cc.get("identity_hash").is_none());
    }

    #[test]
    fn many_distinct_dests_still_one_flush_batch() {
        let _guard = pressure_metrics_lock();
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

    #[cfg(feature = "rns-stack")]
    #[test]
    fn resolve_announce_aspect_maps_known_aspects() {
        assert_eq!(
            resolve_announce_aspect(&rns_identity::name_hash::name_hash("lxmf.delivery")),
            Some("lxmf.delivery")
        );
        assert_eq!(
            resolve_announce_aspect(&rns_identity::name_hash::name_hash("lxmf.propagation")),
            Some("lxmf.propagation")
        );
        assert_eq!(
            resolve_announce_aspect(&rns_identity::name_hash::name_hash("nomadnetwork.node")),
            Some("nomadnetwork.node")
        );
        assert_eq!(
            resolve_announce_aspect(&rns_identity::name_hash::name_hash("rrc.hub")),
            Some("rrc.hub")
        );
        assert_eq!(resolve_announce_aspect(&[0u8; 10]), None);
        assert_eq!(resolve_announce_aspect(&[1u8; 10]), None);
    }
}

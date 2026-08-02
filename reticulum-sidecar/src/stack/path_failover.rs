//! Shared path-slot / via failover helpers for Nomad Links and LXMF Direct.
//!
//! Exhaust ranked path slots and other live interfaces after a dead next-hop
//! before giving up (Nomad) or falling back to preferred PN (LXMF Direct).

use std::time::Duration;

use crate::stack::types::InterfaceRow;

/// How long to reject the failed path interface after a link failure so an
/// alternate hub slot can become active.
pub const IFACE_SUPPRESS_SECS: f64 = 120.0;

/// Wait for a path with a different via/iface after DropAllVia + suppress.
pub const VIA_FAILOVER_PROBE_WAIT: Duration = Duration::from_secs(8);

/// Extra RequestPath wait when other live interfaces remain but no slot appeared.
pub const VIA_FAILOVER_EXTRA_PROBE_WAIT: Duration = Duration::from_secs(8);

/// Max failovers after the first link failure (total tries = 1 + this).
pub const MAX_VIA_FAILOVERS: u8 = 2;

/// Poll interval while waiting for an alternate path slot.
pub const VIA_FAILOVER_POLL_INTERVAL: Duration = Duration::from_millis(200);

/// One usable path-table slot for the next Link / Direct attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathSlotCandidate {
    pub hops: u8,
    pub iface: Option<String>,
    pub via: Option<String>,
}

/// Active via_hash from ranked path slots (first active non-empty via).
pub fn active_via_hash_from_slots(slots: &[serde_json::Value]) -> Option<String> {
    slots.iter().find_map(|slot| {
        let active = slot
            .get("active")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        if !active {
            return None;
        }
        slot.get("via_hash")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    })
}

/// Truncate a via hash for progress / log prefixes.
pub fn via_prefix(via: Option<&str>) -> Option<String> {
    via.map(|v| v.chars().take(8).collect())
}

fn iface_blocked(iface: Option<&str>, blocked_ifaces: &[String]) -> bool {
    iface.is_some_and(|i| blocked_ifaces.iter().any(|b| b.eq_ignore_ascii_case(i)))
}

fn via_blocked(via: Option<&str>, blocked_vias: &[String]) -> bool {
    via.is_some_and(|v| blocked_vias.iter().any(|b| b.eq_ignore_ascii_case(v)))
}

/// Parse hops / interface / via from a path-slot JSON object.
pub fn slot_candidate(slot: &serde_json::Value) -> Option<PathSlotCandidate> {
    let hops = slot
        .get("hops")
        .and_then(serde_json::Value::as_u64)
        .map(|h| h as u8)?;
    let iface = slot
        .get("interface")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let via = slot
        .get("via_hash")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    Some(PathSlotCandidate { hops, iface, via })
}

fn slot_is_unblocked(
    cand: &PathSlotCandidate,
    blocked_ifaces: &[String],
    blocked_vias: &[String],
    failed_via: Option<&str>,
) -> bool {
    if iface_blocked(cand.iface.as_deref(), blocked_ifaces) {
        return false;
    }
    if via_blocked(cand.via.as_deref(), blocked_vias) {
        return false;
    }
    if failed_via.is_some_and(|fv| {
        cand.via
            .as_deref()
            .is_some_and(|v| v.eq_ignore_ascii_case(fv))
    }) {
        return false;
    }
    true
}

fn iface_preferred(iface: Option<&str>, prefer_ifaces: &[String]) -> bool {
    match iface {
        Some(i) if !prefer_ifaces.is_empty() => {
            prefer_ifaces.iter().any(|p| p.eq_ignore_ascii_case(i))
        }
        _ => false,
    }
}

/// Pick the best unblocked path slot.
///
/// Preference order:
/// 1. Unblocked slots on `prefer_ifaces` (other live hubs / RF)
/// 2. Any other unblocked slot (ranked backups)
///
/// Active vs backup order from the transport is preserved within each tier
/// (slots are scanned in list order).
pub fn select_unblocked_slot(
    slots: &[serde_json::Value],
    blocked_ifaces: &[String],
    blocked_vias: &[String],
    failed_via: Option<&str>,
    prefer_ifaces: &[String],
) -> Option<PathSlotCandidate> {
    let mut fallback: Option<PathSlotCandidate> = None;
    for slot in slots {
        let Some(cand) = slot_candidate(slot) else {
            continue;
        };
        if !slot_is_unblocked(&cand, blocked_ifaces, blocked_vias, failed_via) {
            continue;
        }
        if iface_preferred(cand.iface.as_deref(), prefer_ifaces) {
            return Some(cand);
        }
        if fallback.is_none() {
            fallback = Some(cand);
        }
    }
    fallback
}

/// Enabled interfaces that look live (up/connected/online/running).
pub fn live_interface_names(interfaces: &[InterfaceRow]) -> Vec<String> {
    interfaces
        .iter()
        .filter(|iface| iface.enabled && interface_status_live(&iface.status))
        .filter(|iface| !iface.name.trim().is_empty())
        .map(|iface| iface.name.clone())
        .collect()
}

fn interface_status_live(status: &str) -> bool {
    matches!(
        status.to_ascii_lowercase().as_str(),
        "up" | "connected" | "online" | "running"
    )
}

/// Live interface names that are not in the blocked set (candidates for rediscovery).
pub fn remaining_live_ifaces(live_ifaces: &[String], blocked_ifaces: &[String]) -> Vec<String> {
    live_ifaces
        .iter()
        .filter(|n| !blocked_ifaces.iter().any(|b| b.eq_ignore_ascii_case(n)))
        .cloned()
        .collect()
}

/// True when Direct LXMF should attempt another path before preferred-PN fallback.
pub fn should_retry_direct_path_failover(rounds_already: u8) -> bool {
    rounds_already < MAX_VIA_FAILOVERS
}

/// True when Nomad should enter another via-failover round after a link result.
///
/// Only `link_timeout` triggers in-request failover; other errors surface immediately.
/// `failover_round` is the count of failovers already completed (0 before the first).
pub fn should_attempt_nomad_via_failover(err_code: &str, failover_round: u8) -> bool {
    err_code == "link_timeout" && failover_round < MAX_VIA_FAILOVERS
}

/// Merge a newly tried interface name into the diagnostics list (case-insensitive dedupe).
pub fn push_tried_iface(tried: &mut Vec<String>, iface: Option<&str>) {
    let Some(name) = iface.map(str::trim).filter(|s| !s.is_empty()) else {
        return;
    };
    if tried.iter().any(|t| t.eq_ignore_ascii_case(name)) {
        return;
    }
    tried.push(name.to_string());
}

/// Record a failed (or initial) path attempt into tried + blocked diagnostics sets.
///
/// Used by the Nomad in-request failover loop so each round suppresses the dead
/// iface/via before `select_unblocked_slot` / rediscovery.
pub fn record_path_failover_attempt(
    tried: &mut Vec<String>,
    blocked_ifaces: &mut Vec<String>,
    blocked_vias: &mut Vec<String>,
    iface: Option<&str>,
    via: Option<&str>,
) {
    push_tried_iface(tried, iface);
    if let Some(name) = iface.map(str::trim).filter(|s| !s.is_empty()) {
        if !blocked_ifaces.iter().any(|b| b.eq_ignore_ascii_case(name)) {
            blocked_ifaces.push(name.to_string());
        }
    }
    if let Some(v) = via.map(str::trim).filter(|s| !s.is_empty()) {
        if !blocked_vias.iter().any(|b| b.eq_ignore_ascii_case(v)) {
            blocked_vias.push(v.to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stack::types::interface_discovery_defaults;

    fn slot(active: bool, hops: u8, iface: &str, via: &str) -> serde_json::Value {
        serde_json::json!({
            "active": active,
            "hops": hops,
            "interface": iface,
            "via_hash": via,
        })
    }

    fn iface_row(name: &str, enabled: bool, status: &str) -> InterfaceRow {
        let (
            discoverable,
            latitude,
            longitude,
            height,
            discovery_name,
            announce_interval_min,
            connectable,
            reachable_on,
        ) = interface_discovery_defaults();
        InterfaceRow {
            id: name.to_lowercase().replace(' ', "-"),
            name: name.into(),
            iface_type: "tcp".into(),
            enabled,
            status: status.into(),
            host: None,
            port: None,
            preset: None,
            serial_port: None,
            frequency: None,
            bandwidth: None,
            txpower: None,
            spreading_factor: None,
            coding_rate: None,
            callsign: None,
            id_interval: None,
            mode: None,
            seed_addresses: vec![],
            discoverable,
            latitude,
            longitude,
            height,
            discovery_name,
            announce_interval_min,
            connectable,
            reachable_on,
            network_name: None,
            passphrase: None,
            extra_config: std::collections::HashMap::default(),
        }
    }

    #[test]
    fn active_via_hash_from_slots_skips_inactive_and_empty() {
        assert_eq!(active_via_hash_from_slots(&[]), None);
        assert_eq!(
            active_via_hash_from_slots(&[serde_json::json!({
                "active": true,
                "via_hash": "",
            })]),
            None
        );
        assert_eq!(
            active_via_hash_from_slots(&[
                slot(false, 4, "TTP_TCP", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
                slot(true, 4, "TTP_TCP", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
            ]),
            Some("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".into())
        );
    }

    #[test]
    fn via_prefix_handles_none_and_truncates() {
        assert_eq!(via_prefix(None), None);
        assert_eq!(
            via_prefix(Some("abcdefghijklmnop")),
            Some("abcdefgh".into())
        );
        assert_eq!(via_prefix(Some("abcd")), Some("abcd".into()));
    }

    #[test]
    fn select_unblocked_prefers_other_live_iface_over_same_hub_backup() {
        let slots = [
            slot(true, 4, "TTP_TCP", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            slot(false, 5, "TTP_TCP", "cccccccccccccccccccccccccccccccc"),
            slot(
                false,
                3,
                "Local Transport Pi",
                "dddddddddddddddddddddddddddddddd",
            ),
        ];
        let blocked_ifaces = vec!["TTP_TCP".into()];
        let blocked_vias = vec!["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()];
        let prefer = vec!["Local Transport Pi".into()];
        let found = select_unblocked_slot(
            &slots,
            &blocked_ifaces,
            &blocked_vias,
            Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            &prefer,
        )
        .expect("local pi slot");
        assert_eq!(found.iface.as_deref(), Some("Local Transport Pi"));
        assert_eq!(found.hops, 3);
    }

    #[test]
    fn select_unblocked_rejects_blocked_via_even_on_other_iface() {
        let via = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let slots = [
            slot(true, 4, "TTP_TCP", via),
            slot(false, 3, "Local Transport Pi", via),
        ];
        let blocked_ifaces = vec!["TTP_TCP".into()];
        let blocked_vias = vec![via.into()];
        let prefer = vec!["Local Transport Pi".into()];
        assert!(
            select_unblocked_slot(&slots, &blocked_ifaces, &blocked_vias, Some(via), &prefer)
                .is_none()
        );
    }

    #[test]
    fn select_unblocked_falls_back_to_any_unblocked_slot() {
        let slots = [
            slot(true, 4, "TTP_TCP", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            slot(false, 6, "Ratspeak", "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"),
        ];
        let blocked_ifaces = vec!["TTP_TCP".into()];
        let blocked_vias = vec!["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()];
        // Prefer list empty / no match — still take Ratspeak backup.
        let found = select_unblocked_slot(
            &slots,
            &blocked_ifaces,
            &blocked_vias,
            Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
            &[],
        )
        .expect("backup");
        assert_eq!(found.iface.as_deref(), Some("Ratspeak"));
    }

    #[test]
    fn live_interface_names_filters_enabled_up() {
        let rows = [
            iface_row("TTP_TCP", true, "up"),
            iface_row("Ratspeak 2", false, "down"),
            iface_row("Local Transport Pi", true, "connected"),
            iface_row("Auto", true, "down"),
        ];
        let names = live_interface_names(&rows);
        assert_eq!(
            names,
            vec!["TTP_TCP".to_string(), "Local Transport Pi".to_string()]
        );
    }

    #[test]
    fn remaining_live_ifaces_excludes_blocked() {
        let live = vec!["TTP_TCP".into(), "Local Transport Pi".into()];
        let blocked = vec!["TTP_TCP".into()];
        assert_eq!(
            remaining_live_ifaces(&live, &blocked),
            vec!["Local Transport Pi".to_string()]
        );
    }

    #[test]
    fn should_retry_direct_path_failover_caps_rounds() {
        assert!(should_retry_direct_path_failover(0));
        assert!(should_retry_direct_path_failover(1));
        assert!(!should_retry_direct_path_failover(2));
        assert!(!should_retry_direct_path_failover(MAX_VIA_FAILOVERS));
    }

    #[test]
    fn push_tried_iface_dedupes_case_insensitive() {
        let mut tried = Vec::new();
        push_tried_iface(&mut tried, Some("TTP_TCP"));
        push_tried_iface(&mut tried, Some("ttp_tcp"));
        push_tried_iface(&mut tried, Some("Local Transport Pi"));
        push_tried_iface(&mut tried, None);
        push_tried_iface(&mut tried, Some("  "));
        assert_eq!(
            tried,
            vec!["TTP_TCP".to_string(), "Local Transport Pi".to_string()]
        );
    }

    #[test]
    fn should_attempt_nomad_via_failover_only_on_link_timeout_within_cap() {
        assert!(should_attempt_nomad_via_failover("link_timeout", 0));
        assert!(should_attempt_nomad_via_failover("link_timeout", 1));
        assert!(!should_attempt_nomad_via_failover("link_timeout", 2));
        assert!(!should_attempt_nomad_via_failover(
            "link_timeout",
            MAX_VIA_FAILOVERS
        ));
        assert!(!should_attempt_nomad_via_failover("path_not_found", 0));
        assert!(!should_attempt_nomad_via_failover("nomad_busy", 0));
    }

    #[test]
    fn record_path_failover_attempt_tracks_tried_and_blocked_sets() {
        let mut tried = Vec::new();
        let mut blocked_ifaces = Vec::new();
        let mut blocked_vias = Vec::new();
        record_path_failover_attempt(
            &mut tried,
            &mut blocked_ifaces,
            &mut blocked_vias,
            Some("TTP_TCP"),
            Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        );
        // Second attempt on another hub; case-insensitive dedupe on re-record.
        record_path_failover_attempt(
            &mut tried,
            &mut blocked_ifaces,
            &mut blocked_vias,
            Some("Local Transport Pi"),
            Some("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
        );
        record_path_failover_attempt(
            &mut tried,
            &mut blocked_ifaces,
            &mut blocked_vias,
            Some("ttp_tcp"),
            Some("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
        );
        assert_eq!(
            tried,
            vec!["TTP_TCP".to_string(), "Local Transport Pi".to_string()]
        );
        assert_eq!(
            blocked_ifaces,
            vec!["TTP_TCP".to_string(), "Local Transport Pi".to_string()]
        );
        assert_eq!(
            blocked_vias,
            vec![
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string()
            ]
        );
        // Initial + one failover recorded → round 1 still allows one more; round 2 stops.
        assert!(should_attempt_nomad_via_failover("link_timeout", 1));
        assert!(!should_attempt_nomad_via_failover("link_timeout", 2));
    }
}

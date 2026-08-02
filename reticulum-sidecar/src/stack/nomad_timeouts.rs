//! Nomad page fetch timeouts (MeshChat + Python RNS per-hop scaling on RF).

use super::types::InterfaceRow;
use super::via::resolve_outbound_sent_via;

/// MeshChat `NomadnetDownloader.download()` path_lookup_timeout default.
pub const NOMAD_PATH_LOOKUP_SECS: u64 = 15;

/// MeshChat TCP link_establishment_timeout default.
pub const NOMAD_TCP_LINK_ESTABLISH_SECS: u64 = 15;

/// Grace for RTT-scaled link.request transfer after path + link stages.
pub const NOMAD_TCP_TRANSFER_GRACE_SECS: u64 = 15;

/// Floor for LinkClient LRPROOF wait (rsReticulum proof-budget overlay).
/// MeshChat TCP overall is 45s; keep 15s transfer grace → 30s proof floor so
/// slow hub peers are not cut off at hops×6 (18s for the TCP link_hops floor).
pub const NOMAD_TCP_PROOF_FLOOR_SECS: u64 = 30;

/// Python RNS `DEFAULT_PER_HOP_TIMEOUT`.
pub const NOMAD_RF_PER_HOP_TIMEOUT_SECS: u64 = 6;

/// Python RNS first-hop component in link establishment.
pub const NOMAD_RF_FIRST_HOP_SECS: u64 = 6;

/// Extra grace for slow RF page transfers.
pub const NOMAD_RF_TRANSFER_GRACE_SECS: u64 = 30;

/// RNS transport default overall cap.
pub const NOMAD_RF_MAX_OVERALL_SECS: u64 = 180;

fn bounded_hops(hops: u8) -> u64 {
    u64::from(hops.clamp(1, 32))
}

/// Overall sidecar Link query deadline in seconds.
pub fn nomad_page_overall_timeout_secs(egress_via: &str, hops: u8) -> u64 {
    // BLE RNode uses the same per-hop Link budget as USB RF (not TCP MeshChat stages).
    if egress_via == "rf" || egress_via == "ble" {
        let bounded_hops = bounded_hops(hops);
        let link_establish = NOMAD_RF_FIRST_HOP_SECS + NOMAD_RF_PER_HOP_TIMEOUT_SECS * bounded_hops;
        let total = NOMAD_PATH_LOOKUP_SECS + link_establish + NOMAD_RF_TRANSFER_GRACE_SECS;
        total.min(NOMAD_RF_MAX_OVERALL_SECS)
    } else {
        NOMAD_PATH_LOOKUP_SECS + NOMAD_TCP_LINK_ESTABLISH_SECS + NOMAD_TCP_TRANSFER_GRACE_SECS
    }
}

/// Resolve egress from enabled interfaces and compute overall timeout.
/// Prefer [`resolve_nomad_page_timeout_secs`] with a path-table interface when known —
/// a local BLE/RNode being enabled must not force RF budgets for TCP-routed peers.
#[allow(dead_code)] // kept for tests + call sites that lack a path interface
pub fn nomad_page_timeout_secs_for_interfaces(interfaces: &[InterfaceRow], hops: u8) -> u64 {
    let egress = resolve_outbound_sent_via(interfaces);
    nomad_page_overall_timeout_secs(egress, hops)
}

/// Timeout for a Nomad page/file Link query.
/// When `path_interface` is known (path table), classify that interface; otherwise
/// fall back to local outbound capability (may prefer RF/BLE).
pub fn resolve_nomad_page_timeout_secs(
    interfaces: &[InterfaceRow],
    hops: u8,
    path_interface: Option<&str>,
    primary_local_serial_id: Option<&str>,
) -> (u64, &'static str) {
    let egress =
        super::via::resolve_lxmf_sent_via(path_interface, interfaces, primary_local_serial_id);
    // resolve_lxmf_sent_via returns owned String; map to static atom for logging.
    let atom: &'static str = match egress.as_str() {
        "ble" => "ble",
        "rf" => "rf",
        "tcp" => "tcp",
        _ => "network",
    };
    (nomad_page_overall_timeout_secs(atom, hops), atom)
}

/// Hops passed to `Link::new_initiator` (scales establishment timeout at 6s/hop).
///
/// TCP/network: restore release-like multi-hop proof windows (v5.25.0 passed raw
/// path hops into LinkClient). Floor at 3 (~18s) so 1-hop UI/path under-budget
/// does not collapse to 6s; cap at 7 (~42s) under the 45s MeshChat TCP overall.
/// #756's flat max-3 (~18s) is why some hub pages work on release but fail on HEAD.
pub fn nomad_link_initiator_hops(egress_via: &str, path_hops: u8) -> u8 {
    if egress_via == "rf" || egress_via == "ble" {
        path_hops.clamp(1, 32)
    } else {
        const TCP_LINK_INITIATOR_HOPS_MIN: u8 = 3;
        const TCP_LINK_INITIATOR_HOPS_MAX: u8 = 7;
        path_hops.clamp(TCP_LINK_INITIATOR_HOPS_MIN, TCP_LINK_INITIATOR_HOPS_MAX)
    }
}

/// Effective LRPROOF budget reported to the UI / failure logs.
///
/// Matches `rsReticulum-link-client-proof-budget.patch`:
/// `min(remaining, max(establishment = hops×6, NOMAD_TCP_PROOF_FLOOR_SECS))`.
/// Callers that already know remaining overall time may still clamp further.
pub fn nomad_link_proof_budget_secs(link_hops: u8) -> u64 {
    u64::from(link_hops)
        .saturating_mul(NOMAD_RF_PER_HOP_TIMEOUT_SECS)
        .max(NOMAD_TCP_PROOF_FLOOR_SECS)
}

fn interface_status_live(status: &str) -> bool {
    matches!(
        status.to_ascii_lowercase().as_str(),
        "up" | "connected" | "online" | "running"
    )
}

/// True when a remote Nomad Link has a plausible egress (path iface known, or any
/// enabled RF/BLE/TCP interface is live). Avoids burning the full Link budget when
/// the stack is up but hubs are still connecting.
pub fn nomad_remote_network_ready(
    interfaces: &[InterfaceRow],
    path_interface: Option<&str>,
) -> bool {
    if path_interface.is_some_and(|n| !n.is_empty()) {
        return true;
    }
    interfaces.iter().any(|iface| {
        if !iface.enabled || !interface_status_live(&iface.status) {
            return false;
        }
        matches!(
            super::via::classify_interface_row(
                &iface.iface_type,
                &iface.name,
                iface.serial_port.as_deref(),
            ),
            "tcp" | "rf" | "ble" | "network"
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stack::types::InterfaceRow;

    fn iface(iface_type: &str) -> InterfaceRow {
        InterfaceRow {
            id: "1".into(),
            name: "test".into(),
            iface_type: iface_type.into(),
            enabled: true,
            status: "up".into(),
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
            seed_addresses: Vec::new(),
            discoverable: None,
            latitude: None,
            longitude: None,
            height: None,
            discovery_name: None,
            announce_interval_min: None,
            connectable: None,
            reachable_on: None,
            network_name: None,
            passphrase: None,
            extra_config: std::collections::HashMap::new(),
        }
    }

    #[test]
    fn tcp_timeout_matches_meshchat_stages() {
        assert_eq!(nomad_page_overall_timeout_secs("tcp", 8), 45);
        assert_eq!(nomad_page_overall_timeout_secs("network", 1), 45);
    }

    #[test]
    fn rf_timeout_scales_with_hops_and_caps() {
        assert_eq!(nomad_page_overall_timeout_secs("rf", 1), 57);
        assert_eq!(nomad_page_overall_timeout_secs("rf", 8), 99);
        assert_eq!(nomad_page_overall_timeout_secs("rf", 32), 180);
        assert_eq!(nomad_page_overall_timeout_secs("ble", 6), 87);
    }

    #[test]
    fn timeout_from_interfaces_prefers_rnode() {
        let ifaces = vec![iface("tcp"), iface("rnode")];
        assert_eq!(nomad_page_timeout_secs_for_interfaces(&ifaces, 8), 99);
    }

    #[test]
    fn path_table_tcp_wins_over_local_ble_rnode() {
        let mut ble = iface("rnode");
        ble.serial_port = Some("ble://AA:BB:CC:DD:EE:FF".into());
        ble.name = "BLE RNode".into();
        let mut tcp = iface("tcp");
        tcp.name = "US-East".into();
        tcp.id = "tcp1".into();
        let ifaces = vec![ble, tcp];
        // Local outbound still prefers BLE when path is unknown.
        assert_eq!(nomad_page_timeout_secs_for_interfaces(&ifaces, 3), 69);
        // Path via TCP hub must use MeshChat TCP budget (45s), not RF.
        let (secs, egress) = resolve_nomad_page_timeout_secs(&ifaces, 3, Some("US-East"), None);
        assert_eq!(egress, "tcp");
        assert_eq!(secs, 45);
    }

    #[test]
    fn tcp_link_initiator_hops_floored_and_capped_for_release_parity() {
        // Floor 3 (~18s establishment); scale with path; cap 7 (~42s) under 45s overall.
        // LinkClient proof wait then floors at NOMAD_TCP_PROOF_FLOOR_SECS (30s).
        assert_eq!(nomad_link_initiator_hops("tcp", 1), 3);
        assert_eq!(nomad_link_initiator_hops("tcp", 2), 3);
        assert_eq!(nomad_link_initiator_hops("network", 1), 3);
        assert_eq!(nomad_link_initiator_hops("tcp", 5), 5);
        assert_eq!(nomad_link_initiator_hops("network", 4), 4);
        assert_eq!(nomad_link_initiator_hops("tcp", 7), 7);
        assert_eq!(nomad_link_initiator_hops("tcp", 8), 7);
        assert_eq!(nomad_link_initiator_hops("network", 32), 7);
        assert_eq!(nomad_link_initiator_hops("rf", 8), 8);
        assert_eq!(nomad_link_initiator_hops("ble", 6), 6);
        assert_eq!(nomad_link_initiator_hops("rf", 1), 1);
    }

    #[test]
    fn link_proof_budget_floors_at_thirty_for_low_initiator_hops() {
        // 3 × 6s = 18s establishment → floor 30s (TCP hub slow-LRPROOF fix).
        assert_eq!(nomad_link_proof_budget_secs(3), 30);
        assert_eq!(nomad_link_proof_budget_secs(1), 30);
        assert_eq!(nomad_link_proof_budget_secs(5), 30);
        // Above the floor, scale with hops×6.
        assert_eq!(nomad_link_proof_budget_secs(6), 36);
        assert_eq!(nomad_link_proof_budget_secs(7), 42);
    }

    #[test]
    fn network_ready_when_path_iface_or_live_egress() {
        let mut tcp = iface("tcp");
        tcp.status = "down".into();
        assert!(!nomad_remote_network_ready(&[tcp.clone()], None));
        assert!(nomad_remote_network_ready(&[tcp.clone()], Some("US-East")));
        tcp.status = "up".into();
        assert!(nomad_remote_network_ready(&[tcp], None));
    }
}

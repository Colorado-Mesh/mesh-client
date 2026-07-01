//! Nomad page fetch timeouts (MeshChat + Python RNS per-hop scaling on RF).

use super::via::resolve_outbound_sent_via;
use super::types::InterfaceRow;

/// MeshChat `NomadnetDownloader.download()` path_lookup_timeout default.
pub const NOMAD_PATH_LOOKUP_SECS: u64 = 15;

/// MeshChat TCP link_establishment_timeout default.
pub const NOMAD_TCP_LINK_ESTABLISH_SECS: u64 = 15;

/// Grace for RTT-scaled link.request transfer after path + link stages.
pub const NOMAD_TCP_TRANSFER_GRACE_SECS: u64 = 15;

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
    if egress_via == "rf" {
        let bounded_hops = bounded_hops(hops);
        let link_establish =
            NOMAD_RF_FIRST_HOP_SECS + NOMAD_RF_PER_HOP_TIMEOUT_SECS * bounded_hops;
        let total = NOMAD_PATH_LOOKUP_SECS + link_establish + NOMAD_RF_TRANSFER_GRACE_SECS;
        total.min(NOMAD_RF_MAX_OVERALL_SECS)
    } else {
        NOMAD_PATH_LOOKUP_SECS + NOMAD_TCP_LINK_ESTABLISH_SECS + NOMAD_TCP_TRANSFER_GRACE_SECS
    }
}

/// Resolve egress from enabled interfaces and compute overall timeout.
pub fn nomad_page_timeout_secs_for_interfaces(interfaces: &[InterfaceRow], hops: u8) -> u64 {
    let egress = resolve_outbound_sent_via(interfaces);
    nomad_page_overall_timeout_secs(egress, hops)
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
    }

    #[test]
    fn timeout_from_interfaces_prefers_rnode() {
        let ifaces = vec![iface("tcp"), iface("rnode")];
        assert_eq!(nomad_page_timeout_secs_for_interfaces(&ifaces, 8), 99);
    }
}

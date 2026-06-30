//! Reticulum LXMF transport classification (RF / TCP / network).

use super::types::InterfaceRow;

/// Classify an RNS interface name or UI type into a transport marker.
pub fn classify_interface(name_or_type: &str) -> &'static str {
    let lower = name_or_type.to_ascii_lowercase();
    if lower.contains("rnode") || lower == "rnode" {
        "rf"
    } else if lower.contains("tcp") || lower == "tcp" {
        "tcp"
    } else {
        "network"
    }
}

/// Pick the primary outbound transport from enabled stub interfaces.
pub fn resolve_stub_sent_via(interfaces: &[InterfaceRow]) -> &'static str {
    let mut fallback = "network";
    for iface in interfaces.iter().filter(|i| i.enabled) {
        match classify_interface(&iface.iface_type) {
            "rf" => return "rf",
            "tcp" => fallback = "tcp",
            _ => {}
        }
    }
    fallback
}

/// Outbound LXMF transport: local egress interface (RNode → RF), not the peer path-table label.
pub fn resolve_outbound_sent_via(interfaces: &[InterfaceRow]) -> &'static str {
    resolve_stub_sent_via(interfaces)
}

/// Resolve transport for a peer destination hash from a path-table interface name.
pub fn resolve_peer_sent_via(peer_interface: Option<&str>) -> &'static str {
    match peer_interface {
        Some(name) if !name.is_empty() => classify_interface(name),
        _ => "network",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stack::types::InterfaceRow;

    #[test]
    fn classify_rnode_variants() {
        assert_eq!(classify_interface("rnode"), "rf");
        assert_eq!(classify_interface("RNodeInterface"), "rf");
        assert_eq!(classify_interface("My RNode LoRa"), "rf");
    }

    #[test]
    fn classify_tcp_variants() {
        assert_eq!(classify_interface("tcp"), "tcp");
        assert_eq!(classify_interface("TCPClientInterface"), "tcp");
    }

    #[test]
    fn classify_network_fallback() {
        assert_eq!(classify_interface("auto"), "network");
        assert_eq!(classify_interface("AutoInterface"), "network");
        assert_eq!(classify_interface("unknown"), "network");
    }

    #[test]
    fn resolve_stub_prefers_rnode_interface_mode() {
        let ifaces = vec![InterfaceRow {
            id: "1".into(),
            name: "LoRa".into(),
            iface_type: "RNodeInterface".into(),
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
        }];
        assert_eq!(resolve_stub_sent_via(&ifaces), "rf");
        assert_eq!(resolve_outbound_sent_via(&ifaces), "rf");
    }
}

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

fn live_matches_config(live_row: &InterfaceRow, cfg: &InterfaceRow) -> bool {
    live_row.id == cfg.id || live_row.name == cfg.name
}

/// Union config with live RNS stats: every configured interface is returned; live rows
/// overlay status/enabled when names match. Config-only rows (e.g. failed USB open) stay
/// visible with `status: down`.
pub fn merge_live_interfaces_with_config(
    config: &[InterfaceRow],
    live: Vec<InterfaceRow>,
) -> Vec<InterfaceRow> {
    let mut merged: Vec<InterfaceRow> = Vec::with_capacity(config.len().max(live.len()));

    for cfg in config {
        if let Some(mut live_row) = live
            .iter()
            .find(|l| live_matches_config(l, cfg))
            .cloned()
        {
            live_row.id = cfg.id.clone();
            live_row.iface_type = cfg.iface_type.clone();
            live_row.host = cfg.host.clone();
            live_row.port = cfg.port;
            live_row.preset = cfg.preset.clone();
            live_row.serial_port = cfg.serial_port.clone();
            live_row.frequency = cfg.frequency;
            live_row.bandwidth = cfg.bandwidth;
            live_row.txpower = cfg.txpower;
            live_row.spreading_factor = cfg.spreading_factor;
            live_row.coding_rate = cfg.coding_rate;
            live_row.callsign = cfg.callsign.clone();
            live_row.id_interval = cfg.id_interval;
            live_row.mode = cfg.mode.clone();
            // Config INI is the source of truth for user enable/disable; live stats only
            // report carrier status (online), which must not flip `enabled` in the UI.
            live_row.enabled = cfg.enabled;
            merged.push(live_row);
        } else {
            let mut row = cfg.clone();
            if row.enabled {
                row.status = "down".into();
            }
            merged.push(row);
        }
    }

    for live_row in live {
        if !config.iter().any(|c| live_matches_config(&live_row, c)) {
            merged.push(live_row);
        }
    }

    merged
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
            seed_addresses: Vec::new(),
        }];
        assert_eq!(resolve_stub_sent_via(&ifaces), "rf");
        assert_eq!(resolve_outbound_sent_via(&ifaces), "rf");
    }

    #[test]
    fn merge_live_interfaces_uses_config_rnode_over_live_lora_mode() {
        let config = vec![InterfaceRow {
            id: "usb0".into(),
            name: "LoRa".into(),
            iface_type: "rnode".into(),
            enabled: true,
            status: "up".into(),
            host: None,
            port: None,
            preset: None,
            serial_port: Some("/dev/ttyUSB0".into()),
            frequency: None,
            bandwidth: None,
            txpower: None,
            spreading_factor: None,
            coding_rate: None,
            callsign: None,
            id_interval: None,
            mode: None,
            seed_addresses: Vec::new(),
        }];
        let live = vec![InterfaceRow {
            id: "rns-0".into(),
            name: "LoRa".into(),
            iface_type: "LoRa".into(),
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
        }];
        let merged = merge_live_interfaces_with_config(&config, live);
        assert_eq!(resolve_outbound_sent_via(&merged), "rf");
        assert_eq!(merged[0].iface_type, "rnode");
    }

    fn sample_iface(id: &str, name: &str, iface_type: &str, enabled: bool, status: &str) -> InterfaceRow {
        InterfaceRow {
            id: id.into(),
            name: name.into(),
            iface_type: iface_type.into(),
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
            seed_addresses: Vec::new(),
        }
    }

    #[test]
    fn merge_live_interfaces_keeps_config_only_rows_as_down() {
        let config = vec![
            sample_iface("heltec-v3", "Heltec V3", "rnode", true, "up"),
            sample_iface("auto", "Default Interface", "auto", true, "up"),
            sample_iface("tcp", "RNS Testnet", "tcp", true, "up"),
        ];
        let live = vec![
            InterfaceRow {
                id: "rns-0".into(),
                name: "Default Interface".into(),
                iface_type: "Auto".into(),
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
            },
            InterfaceRow {
                id: "rns-1".into(),
                name: "RNS Testnet".into(),
                iface_type: "TCP".into(),
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
            },
        ];
        let merged = merge_live_interfaces_with_config(&config, live);
        assert_eq!(merged.len(), 3);
        let heltec = merged.iter().find(|r| r.name == "Heltec V3").unwrap();
        assert_eq!(heltec.status, "down");
        assert_eq!(heltec.iface_type, "rnode");
    }

    #[test]
    fn merge_live_interfaces_preserves_config_enabled_when_live_offline() {
        let config = vec![sample_iface("nv0n2", "NV0N2", "rnode", true, "down")];
        let live = vec![InterfaceRow {
            id: "rns-0".into(),
            name: "NV0N2".into(),
            iface_type: "Full".into(),
            enabled: false,
            status: "down".into(),
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
        }];
        let merged = merge_live_interfaces_with_config(&config, live);
        assert_eq!(merged.len(), 1);
        assert!(merged[0].enabled);
        assert_eq!(merged[0].status, "down");
    }
}

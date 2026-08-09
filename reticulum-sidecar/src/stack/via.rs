//! Reticulum LXMF transport classification (RF / BLE / TCP / network).

use std::collections::{HashMap, HashSet};

use super::types::InterfaceRow;

/// Canonical atom order for multi-egress wire labels (`rf+tcp`, `ble+tcp`, …).
const VIA_ATOM_ORDER: &[&str] = &["ble", "rf", "tcp", "network"];

/// Classify an RNS interface name or UI type into a transport marker.
/// Prefer [`classify_interface_row`] when serial_port / config type are available
/// (BLE RNodes look like `rnode` with `ble://…` serial ports).
pub fn classify_interface(name_or_type: &str) -> &'static str {
    let lower = name_or_type.to_ascii_lowercase();
    if lower.contains("ble") || lower.starts_with("ble://") || lower.contains("bluetooth") {
        "ble"
    } else if lower.contains("rnode")
        || lower == "rnode"
        || lower.contains("lora")
        || lower == "kiss"
        || lower.contains("kiss")
    {
        "rf"
    } else if lower.contains("tcp") || lower == "tcp" {
        "tcp"
    } else {
        "network"
    }
}

/// Classify from config/live interface row fields (type + name + serial_port).
pub fn classify_interface_row(
    iface_type: &str,
    name: &str,
    serial_port: Option<&str>,
) -> &'static str {
    if let Some(port) = serial_port {
        let pl = port.to_ascii_lowercase();
        if pl.starts_with("ble://") {
            return "ble";
        }
    }
    let from_type = classify_interface(iface_type);
    if from_type != "network" {
        return from_type;
    }
    classify_interface(name)
}

/// Map a path-table interface name onto a local interface row when possible.
pub fn classify_path_interface_name(
    path_interface_name: &str,
    interfaces: &[InterfaceRow],
) -> &'static str {
    if let Some(row) = interfaces.iter().find(|i| {
        i.name.eq_ignore_ascii_case(path_interface_name)
            || i.id.eq_ignore_ascii_case(path_interface_name)
    }) {
        return classify_interface_row(&row.iface_type, &row.name, row.serial_port.as_deref());
    }
    classify_interface(path_interface_name)
}

/// Resolve transport for a peer destination hash from a path-table interface name.
/// Prefer [`resolve_path_sent_via`] when local interface rows are available.
#[allow(dead_code)] // legacy path-table helper; live stack uses resolve_path_sent_via
pub fn resolve_peer_sent_via(peer_interface: Option<&str>) -> &'static str {
    match peer_interface {
        Some(name) if !name.is_empty() => classify_interface(name),
        _ => "network",
    }
}

/// Path-table egress label: match local interface row when possible.
pub fn resolve_path_sent_via(
    peer_interface: Option<&str>,
    interfaces: &[InterfaceRow],
) -> Option<&'static str> {
    let name = peer_interface.filter(|n| !n.is_empty())?;
    Some(classify_path_interface_name(name, interfaces))
}

/// Merge observed atomic vias into an explicit wire label (`rf`, `tcp`, `rf+tcp`, …).
/// Never emits Meshtastic-style `both`.
pub fn merge_observed_egress_vias<'a, I>(vias: I) -> String
where
    I: IntoIterator<Item = &'a str>,
{
    let mut seen: HashSet<&str> = HashSet::new();
    for via in vias {
        if VIA_ATOM_ORDER.contains(&via) {
            seen.insert(via);
        }
    }
    let parts: Vec<&str> = VIA_ATOM_ORDER
        .iter()
        .copied()
        .filter(|v| seen.contains(v))
        .collect();
    if parts.is_empty() {
        "network".into()
    } else {
        parts.join("+")
    }
}

/// Chat-badge egress: path-table iface first, else local capability classifier.
pub fn resolve_lxmf_sent_via(
    path_interface_name: Option<&str>,
    interfaces: &[InterfaceRow],
    primary_local_serial_id: Option<&str>,
) -> String {
    if let Some(via) = resolve_path_sent_via(path_interface_name, interfaces) {
        return via.to_string();
    }
    resolve_outbound_sent_via_with_primary(interfaces, primary_local_serial_id).to_string()
}

/// Pick the primary outbound transport from enabled stub interfaces.
#[allow(dead_code)] // stub-stack egress; live stack uses resolve_outbound_sent_via_with_primary
pub fn resolve_stub_sent_via(interfaces: &[InterfaceRow]) -> &'static str {
    resolve_outbound_sent_via_with_primary(interfaces, None)
}

/// Local capability egress (enabled interfaces). For Nomad timeouts / no-path fallback only —
/// chat badges should prefer path-table / PacketTap evidence via [`resolve_lxmf_sent_via`].
pub fn resolve_outbound_sent_via(interfaces: &[InterfaceRow]) -> &'static str {
    resolve_outbound_sent_via_with_primary(interfaces, None)
}

/// When multiple enabled RF/BLE interfaces exist, prefer the effective primary local serial interface.
pub fn resolve_outbound_sent_via_with_primary(
    interfaces: &[InterfaceRow],
    primary_local_serial_id: Option<&str>,
) -> &'static str {
    if let Some(primary_id) = primary_local_serial_id {
        if let Some(iface) = interfaces.iter().find(|i| i.id == primary_id && i.enabled) {
            let via = classify_interface_row(
                &iface.iface_type,
                &iface.name,
                iface.serial_port.as_deref(),
            );
            if via == "rf" || via == "ble" {
                return via;
            }
        }
    }

    let mut has_ble = false;
    let mut fallback = "network";
    for iface in interfaces.iter().filter(|i| i.enabled) {
        match classify_interface_row(&iface.iface_type, &iface.name, iface.serial_port.as_deref()) {
            "rf" => return "rf",
            "ble" => has_ble = true,
            "tcp" => fallback = "tcp",
            _ => {}
        }
    }
    if has_ble {
        return "ble";
    }
    fallback
}

fn live_matches_config(live_row: &InterfaceRow, cfg: &InterfaceRow) -> bool {
    live_row.id == cfg.id || live_row.name == cfg.name
}

/// Union config with live RNS stats: every configured interface is returned; live rows
/// overlay status/enabled when names match. Config-only rows (e.g. failed USB open) stay
/// visible with `status: down`.
fn find_live_index_for_config(
    cfg: &InterfaceRow,
    live: &[InterfaceRow],
    live_by_id: &HashMap<String, usize>,
    live_by_name: &HashMap<String, usize>,
) -> Option<usize> {
    let mut candidates = Vec::with_capacity(2);
    if let Some(&idx) = live_by_id.get(&cfg.id) {
        candidates.push(idx);
    }
    if let Some(&idx) = live_by_name.get(&cfg.name) {
        candidates.push(idx);
    }
    candidates
        .into_iter()
        .filter(|&idx| live_matches_config(&live[idx], cfg))
        .min()
}

pub fn merge_live_interfaces_with_config(
    config: &[InterfaceRow],
    live: Vec<InterfaceRow>,
) -> Vec<InterfaceRow> {
    let mut merged: Vec<InterfaceRow> = Vec::with_capacity(config.len().max(live.len()));
    let mut live_by_id: HashMap<String, usize> = HashMap::new();
    let mut live_by_name: HashMap<String, usize> = HashMap::new();
    for (idx, row) in live.iter().enumerate() {
        live_by_id.entry(row.id.clone()).or_insert(idx);
        live_by_name.entry(row.name.clone()).or_insert(idx);
    }
    let mut matched_live = vec![false; live.len()];

    for cfg in config {
        if let Some(idx) = find_live_index_for_config(cfg, &live, &live_by_id, &live_by_name) {
            matched_live[idx] = true;
            let mut live_row = live[idx].clone();
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
            live_row.discoverable = cfg.discoverable;
            live_row.latitude = cfg.latitude;
            live_row.longitude = cfg.longitude;
            live_row.height = cfg.height;
            live_row.discovery_name = cfg.discovery_name.clone();
            live_row.announce_interval_min = cfg.announce_interval_min;
            live_row.connectable = cfg.connectable;
            live_row.reachable_on = cfg.reachable_on.clone();
            // Config is source of truth for IFAC / extras / BLE seeds (live stats omit them).
            live_row.network_name = cfg.network_name.clone();
            live_row.passphrase = cfg.passphrase.clone();
            live_row.extra_config = cfg.extra_config.clone();
            live_row.seed_addresses = cfg.seed_addresses.clone();
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

    for (idx, live_row) in live.into_iter().enumerate() {
        if !matched_live[idx] {
            merged.push(live_row);
        }
    }

    merged
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stack::types::InterfaceRow;

    fn sample_iface(
        id: &str,
        name: &str,
        iface_type: &str,
        enabled: bool,
        status: &str,
    ) -> InterfaceRow {
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
            flow_control: None,
            extra_config: std::collections::HashMap::new(),
        }
    }

    #[test]
    fn classify_rnode_variants() {
        assert_eq!(classify_interface("rnode"), "rf");
        assert_eq!(classify_interface("RNodeInterface"), "rf");
        assert_eq!(classify_interface("My RNode LoRa"), "rf");
    }

    #[test]
    fn classify_ble_variants() {
        assert_eq!(classify_interface("ble"), "ble");
        assert_eq!(classify_interface("BLEInterface"), "ble");
        assert_eq!(classify_interface("ble://AA:BB"), "ble");
    }

    #[test]
    fn classify_rnode_ble_serial_port() {
        assert_eq!(
            classify_interface_row("rnode", "Heltec", Some("ble://AA:BB:CC:DD:EE:FF")),
            "ble"
        );
        assert_eq!(
            classify_interface_row("rnode", "Heltec", Some("/dev/ttyUSB0")),
            "rf"
        );
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
    fn resolve_path_sent_via_matches_local_row() {
        let ifaces = vec![
            sample_iface("heltec", "Heltec V3", "rnode", true, "up"),
            sample_iface("tcp", "RNS Testnet", "tcp", true, "up"),
        ];
        assert_eq!(
            resolve_path_sent_via(Some("Heltec V3"), &ifaces),
            Some("rf")
        );
        assert_eq!(
            resolve_path_sent_via(Some("RNS Testnet"), &ifaces),
            Some("tcp")
        );
        assert_eq!(resolve_path_sent_via(None, &ifaces), None);
    }

    #[test]
    fn inbound_received_via_uses_config_type_not_display_name() {
        // Path-table stores interface *names*; without config match, "RNS Testnet"
        // would fall through classify_interface → network. Inbound must use the
        // same path→config-row matching as outbound (live delivery callback).
        let ifaces = vec![sample_iface("tcp", "RNS Testnet", "tcp", true, "up")];
        assert_eq!(classify_interface("RNS Testnet"), "network");
        assert_eq!(classify_path_interface_name("RNS Testnet", &ifaces), "tcp");
    }

    #[test]
    fn resolve_lxmf_sent_via_prefers_path_over_local_rnode() {
        let ifaces = vec![
            sample_iface("heltec", "Heltec V3", "rnode", true, "up"),
            sample_iface("tcp", "RNS Testnet", "tcp", true, "up"),
        ];
        assert_eq!(
            resolve_lxmf_sent_via(Some("RNS Testnet"), &ifaces, None),
            "tcp"
        );
        assert_eq!(resolve_lxmf_sent_via(None, &ifaces, None), "rf");
    }

    #[test]
    fn merge_observed_egress_vias_joins_explicit_atoms() {
        assert_eq!(merge_observed_egress_vias(["rf"]), "rf");
        assert_eq!(merge_observed_egress_vias(["tcp", "rf"]), "rf+tcp");
        assert_eq!(
            merge_observed_egress_vias(["network", "ble", "tcp"]),
            "ble+tcp+network"
        );
        assert_eq!(merge_observed_egress_vias(["both", "mqtt"]), "network");
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
            flow_control: None,
            extra_config: std::collections::HashMap::new(),
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
            flow_control: None,
            extra_config: std::collections::HashMap::new(),
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
            flow_control: None,
            extra_config: std::collections::HashMap::new(),
        }];
        let merged = merge_live_interfaces_with_config(&config, live);
        assert_eq!(resolve_outbound_sent_via(&merged), "rf");
        assert_eq!(merged[0].iface_type, "rnode");
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
                flow_control: None,
                extra_config: std::collections::HashMap::new(),
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
                flow_control: None,
                extra_config: std::collections::HashMap::new(),
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
            flow_control: None,
            extra_config: std::collections::HashMap::new(),
        }];
        let merged = merge_live_interfaces_with_config(&config, live);
        assert_eq!(merged.len(), 1);
        assert!(merged[0].enabled);
        assert_eq!(merged[0].status, "down");
    }

    #[test]
    fn merge_live_interfaces_preserves_ifac_and_extra_config() {
        // Matches TTP-shaped TCP from user report: IFAC on disk, live stats sparse.
        let mut extra = std::collections::HashMap::new();
        extra.insert("forward_interval".into(), "300".into());
        let config = vec![InterfaceRow {
            id: "ttp-tcp".into(),
            name: "TTP_TCP".into(),
            iface_type: "tcp".into(),
            enabled: true,
            status: "down".into(),
            host: Some("rns.thetechprepper.com".into()),
            port: Some(11312),
            preset: None,
            serial_port: None,
            frequency: None,
            bandwidth: None,
            txpower: None,
            spreading_factor: None,
            coding_rate: None,
            callsign: None,
            id_interval: None,
            mode: Some("boundary".into()),
            seed_addresses: vec!["AA:BB:CC:DD:EE:FF".into()],
            discoverable: None,
            latitude: None,
            longitude: None,
            height: None,
            discovery_name: None,
            announce_interval_min: None,
            connectable: None,
            reachable_on: None,
            network_name: Some("ttp_internal".into()),
            passphrase: Some("resistance202606".into()),
            flow_control: None,
            extra_config: extra.clone(),
        }];
        let live = vec![InterfaceRow {
            id: "rns-0".into(),
            name: "TTP_TCP".into(),
            iface_type: "Full".into(),
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
            flow_control: None,
            extra_config: std::collections::HashMap::new(),
        }];
        let merged = merge_live_interfaces_with_config(&config, live);
        assert_eq!(merged.len(), 1);
        let row = &merged[0];
        assert_eq!(row.id, "ttp-tcp");
        assert_eq!(row.status, "up");
        assert_eq!(row.host.as_deref(), Some("rns.thetechprepper.com"));
        assert_eq!(row.port, Some(11312));
        assert_eq!(row.mode.as_deref(), Some("boundary"));
        assert_eq!(row.network_name.as_deref(), Some("ttp_internal"));
        assert_eq!(row.passphrase.as_deref(), Some("resistance202606"));
        assert_eq!(
            row.extra_config.get("forward_interval").map(String::as_str),
            Some("300")
        );
        assert_eq!(row.seed_addresses, vec!["AA:BB:CC:DD:EE:FF".to_string()]);
    }
}

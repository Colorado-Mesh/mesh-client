//! Locally attached Reticulum serial interfaces and primary RNode selection.

use std::path::Path;

use super::config::{self, interface_id_from_name};
use super::types::InterfaceRow;

const LOCAL_SERIAL_TYPES: [&str; 3] = ["rnode", "rnode_multi", "kiss"];
const RNODE_TCP_SCHEME: &str = "tcp://";
const BLE_SCHEME: &str = "ble://";

pub fn is_local_serial_interface_type(iface_type: &str) -> bool {
    LOCAL_SERIAL_TYPES.contains(&iface_type.trim().to_ascii_lowercase().as_str())
}

fn strip_connect_host_brackets(host: &str) -> String {
    let trimmed = host.trim();
    if trimmed.starts_with('[') && trimmed.ends_with(']') && trimmed.len() > 2 {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
    }
}

fn parse_ipv4_octets(host: &str) -> Option<[u8; 4]> {
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    let mut octets = [0u8; 4];
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() || part.len() > 3 || !part.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let n: u16 = part.parse().ok()?;
        if n > 255 {
            return None;
        }
        octets[i] = n as u8;
    }
    Some(octets)
}

fn parse_ipv6_hextets(host: &str) -> Option<[u16; 8]> {
    let normalized = strip_connect_host_brackets(host).to_lowercase();
    if !normalized.contains(':') {
        return None;
    }

    let (head, _tail): (Vec<&str>, Vec<&str>) = if normalized.contains("::") {
        let parts: Vec<&str> = normalized.split("::").collect();
        if parts.len() != 2 {
            return None;
        }
        let head = if parts[0].is_empty() {
            Vec::new()
        } else {
            parts[0].split(':').collect()
        };
        let tail = if parts[1].is_empty() {
            Vec::new()
        } else {
            parts[1].split(':').collect()
        };
        let missing = 8usize.saturating_sub(head.len() + tail.len());
        if head.len() + tail.len() > 8 {
            return None;
        }
        let mut expanded: Vec<&str> = Vec::with_capacity(8);
        expanded.extend(head.iter().copied());
        expanded.extend(std::iter::repeat("0").take(missing));
        expanded.extend(tail.iter().copied());
        (expanded, Vec::new())
    } else {
        let split: Vec<&str> = normalized.split(':').collect();
        if split.len() != 8 {
            return None;
        }
        (split, Vec::new())
    };

    let mut hextets = [0u16; 8];
    for (i, part) in head.iter().enumerate() {
        if part.is_empty() || part.len() > 4 || !part.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        hextets[i] = u16::from_str_radix(part, 16).ok()?;
    }
    Some(hextets)
}

pub fn is_private_network_host(host: &str) -> bool {
    let Some(octets) = parse_ipv4_octets(&strip_connect_host_brackets(host)) else {
        return false;
    };
    let [a, b, _, _] = octets;
    a == 10
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
}

pub fn is_unique_local_ipv6(host: &str) -> bool {
    let Some(hextets) = parse_ipv6_hextets(host) else {
        return false;
    };
    let first_byte = (hextets[0] >> 8) as u8;
    first_byte == 0xfc || first_byte == 0xfd
}

pub fn is_link_local_ipv6(host: &str) -> bool {
    let Some(hextets) = parse_ipv6_hextets(host) else {
        return false;
    };
    (hextets[0] & 0xffc0) == 0xfe80
}

pub fn is_loopback_host(host: &str) -> bool {
    let bare = strip_connect_host_brackets(host).to_lowercase();
    if bare == "::1" {
        return true;
    }
    parse_ipv4_octets(&bare).is_some_and(|octets| octets[0] == 127)
}

fn is_mdns_local_hostname(host: &str) -> bool {
    let normalized = host.to_lowercase();
    normalized == "meshtastic.local"
        || normalized.ends_with(".meshtastic.local")
        || normalized.ends_with(".local")
}

/// Mirrors `isLocalConnectHost` in src/shared/connectHost.ts.
pub fn is_local_connect_host(host: &str) -> bool {
    let bare = strip_connect_host_brackets(host).to_lowercase();
    if bare.is_empty() {
        return false;
    }
    if is_mdns_local_hostname(&bare) {
        return true;
    }
    if is_loopback_host(&bare) {
        return true;
    }
    if is_private_network_host(&bare) {
        return true;
    }
    if is_unique_local_ipv6(&bare) {
        return true;
    }
    if is_link_local_ipv6(&bare) {
        return true;
    }
    false
}

fn parse_rnode_tcp_host(serial_port: &str) -> Option<String> {
    let trimmed = serial_port.trim();
    let rest = trimmed.strip_prefix(RNODE_TCP_SCHEME)?;
    if rest.is_empty() {
        return None;
    }
    let host = if rest.starts_with('[') {
        let closing = rest.find(']')?;
        rest[1..closing].to_string()
    } else {
        let colon_count = rest.matches(':').count();
        if colon_count == 0 {
            rest.to_string()
        } else if colon_count == 1 {
            rest.split_once(':')?.0.to_string()
        } else {
            let sep = rest.rfind(':')?;
            let maybe_port = &rest[sep + 1..];
            if maybe_port.chars().all(|c| c.is_ascii_digit())
                && maybe_port.len() > 0
                && maybe_port.parse::<u32>().ok()? > 255
            {
                rest[..sep].to_string()
            } else {
                rest.to_string()
            }
        }
    };
    if host.is_empty() {
        None
    } else {
        Some(strip_connect_host_brackets(&host))
    }
}

pub fn is_locally_connected_serial_interface(row: &InterfaceRow) -> bool {
    if !is_local_serial_interface_type(&row.iface_type) {
        return false;
    }
    let port = row.serial_port.as_deref().unwrap_or("").trim();
    if port.is_empty() {
        return false;
    }
    let lower = port.to_ascii_lowercase();
    if lower.starts_with(BLE_SCHEME) {
        return true;
    }
    if lower.starts_with(RNODE_TCP_SCHEME) {
        if let Some(host) = parse_rnode_tcp_host(port) {
            return is_local_connect_host(&host);
        }
        return false;
    }
    true
}

pub fn pick_default_primary_local_serial_interface_id(interfaces: &[InterfaceRow]) -> Option<String> {
    interfaces
        .iter()
        .find(|row| row.enabled && is_locally_connected_serial_interface(row))
        .map(|row| row.id.clone())
}

pub fn resolve_effective_primary_local_serial_interface_id(
    interfaces: &[InterfaceRow],
    stored_id: Option<&str>,
) -> Option<String> {
    if let Some(stored) = stored_id {
        if let Some(row) = interfaces.iter().find(|row| row.id == stored) {
            if row.enabled && is_locally_connected_serial_interface(row) {
                return Some(stored.to_string());
            }
        }
    }
    pick_default_primary_local_serial_interface_id(interfaces)
}

pub fn reorder_primary_local_serial_interface(
    config_dir: &Path,
    primary_id: &str,
) -> Result<bool, String> {
    let rows = config::interfaces_from_config_dir(config_dir)?;

    if !rows.iter().any(|row| row.id == primary_id) {
        return Err(format!("interface not found: {primary_id}"));
    }

    let local_indices: Vec<usize> = rows
        .iter()
        .enumerate()
        .filter(|(_, row)| is_locally_connected_serial_interface(row))
        .map(|(idx, _)| idx)
        .collect();

    if local_indices.is_empty() {
        return Ok(false);
    }

    let primary_idx = rows
        .iter()
        .position(|row| row.id == primary_id)
        .ok_or_else(|| format!("interface not found: {primary_id}"))?;

    if !local_indices.contains(&primary_idx) {
        return Err("interface is not a locally connected serial interface".into());
    }

    let target_idx = *local_indices.first().unwrap();
    config::move_interface_block_to_index(config_dir, primary_id, target_idx)
}

pub fn ensure_primary_local_serial_order(
    config_dir: &Path,
    effective_primary_id: &str,
) -> Result<bool, String> {
    reorder_primary_local_serial_interface(config_dir, effective_primary_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stack::config;
    use std::fs;

    fn sample_row(id: &str, iface_type: &str, enabled: bool, serial_port: Option<&str>) -> InterfaceRow {
        InterfaceRow {
            id: id.into(),
            name: id.into(),
            iface_type: iface_type.into(),
            enabled,
            status: "up".into(),
            host: None,
            port: None,
            preset: None,
            serial_port: serial_port.map(String::from),
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
        }
    }

    #[test]
    fn is_local_connect_host_matches_shared_fixture() {
        let json = include_str!("../../../src/shared/fixtures/localConnectHostClassification.json");
        let fixture: serde_json::Value = serde_json::from_str(json).expect("fixture json");
        for host in fixture["local"].as_array().expect("local array") {
            let h = host.as_str().expect("host string");
            assert!(is_local_connect_host(h), "expected local: {h}");
        }
        for host in fixture["remote"].as_array().expect("remote array") {
            let h = host.as_str().expect("host string");
            assert!(!is_local_connect_host(h), "expected remote: {h}");
        }
    }

    #[test]
    fn resolves_effective_primary_with_fallback() {
        let rows = vec![
            sample_row("first", "rnode", true, Some("/dev/ttyUSB0")),
            sample_row("second", "rnode", true, Some("ble://dev")),
        ];
        assert_eq!(
            resolve_effective_primary_local_serial_interface_id(&rows, None),
            Some("first".into())
        );
        assert_eq!(
            resolve_effective_primary_local_serial_interface_id(&rows, Some("second")),
            Some("second".into())
        );
    }

    #[test]
    fn reorder_moves_primary_before_other_local_serial_blocks() {
        let dir = std::env::temp_dir().join(format!(
            "mesh-client-primary-rnode-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let content = r#"[reticulum]
enable_transport = No

[logging]
loglevel = 4

[interfaces]

[[First RNode]]
type = RNodeInterface
enabled = Yes
port = /dev/ttyUSB0

[[Second RNode]]
type = RNodeInterface
enabled = Yes
port = ble://aa:bb:cc:dd:ee:ff
"#;
        config::write_config(&dir, content).unwrap();
        let second_id = interface_id_from_name("Second RNode");
        assert!(reorder_primary_local_serial_interface(&dir, &second_id).unwrap());
        let rows = config::interfaces_from_config_dir(&dir).unwrap();
        assert_eq!(rows[0].id, second_id);
        let _ = fs::remove_dir_all(&dir);
    }
}

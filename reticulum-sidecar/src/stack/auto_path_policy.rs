//! AutoInterface vs private LAN path policy for LXMF Direct.
//!
//! RNS correctly prefers 0-hop Auto neighbors. When Auto is unhealthy for delivery
//! (or Direct already failed on Auto) and a live **private** TCP/UDP path exists,
//! demote Auto toward that path. Never preempt healthy Auto to public internet hubs.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use crate::stack::types::InterfaceRow;

fn interface_status_live(status: &str) -> bool {
    matches!(
        status.to_ascii_lowercase().as_str(),
        "up" | "connected" | "online" | "running"
    )
}

/// True when `name_or_type` looks like AutoInterface.
pub fn is_auto_iface_name_or_type(name_or_type: &str) -> bool {
    let lower = name_or_type.trim().to_ascii_lowercase();
    lower == "auto"
        || lower == "autointerface"
        || lower.starts_with("autointerface")
        || lower == "default interface"
}

/// True when the config/live row is an AutoInterface.
pub fn is_auto_interface_row(row: &InterfaceRow) -> bool {
    is_auto_iface_name_or_type(&row.iface_type) || is_auto_iface_name_or_type(&row.name)
}

/// True when a TCP/UDP host string is on-LAN / private (no DNS).
///
/// Private: RFC1918, IPv4 link-local, IPv6 ULA (`fd00::/8`) / link-local (`fe80::/10`),
/// or hostname ending in `.local`. Non-`.local` hostnames and public IPs are public.
pub fn host_is_private_lan(host: &str) -> bool {
    let trimmed = host.trim();
    if trimmed.is_empty() {
        return false;
    }
    // Bracketed IPv6 literals: `[fe80::1]` or `[fe80::1%en0]`
    let unbracketed = trimmed
        .strip_prefix('[')
        .and_then(|s| s.split(']').next())
        .unwrap_or(trimmed);
    let without_zone = unbracketed.split('%').next().unwrap_or(unbracketed);
    if let Ok(ip) = without_zone.parse::<IpAddr>() {
        return ip_is_private_lan(ip);
    }
    let host_only = trimmed.split('%').next().unwrap_or(trimmed);
    host_only.to_ascii_lowercase().ends_with(".local")
}

fn ip_is_private_lan(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => ipv4_is_private_lan(v4),
        IpAddr::V6(v6) => ipv6_is_private_lan(v6),
    }
}

fn ipv4_is_private_lan(ip: Ipv4Addr) -> bool {
    ip.is_private() || ip.is_link_local() || ip.is_loopback()
}

fn ipv6_is_private_lan(ip: Ipv6Addr) -> bool {
    if ip.is_loopback() || ip.is_unicast_link_local() {
        return true;
    }
    // Unique local address fd00::/8 (includes fc00::/7 ULA).
    (ip.octets()[0] & 0xfe) == 0xfc
}

/// TCP/UDP (non-Auto) row whose configured host is private LAN.
pub fn interface_row_is_private_network(row: &InterfaceRow) -> bool {
    if is_auto_interface_row(row) {
        return false;
    }
    let lower_type = row.iface_type.to_ascii_lowercase();
    let is_ip_client = lower_type.contains("tcp")
        || lower_type.contains("udp")
        || lower_type == "tcpclientinterface"
        || lower_type == "udpclientinterface"
        || lower_type == "tcpserverinterface"
        || lower_type == "udpserverinterface";
    if !is_ip_client {
        // Fall back: name contains tcp/udp and has a host.
        let name_l = row.name.to_ascii_lowercase();
        if !(name_l.contains("tcp") || name_l.contains("udp")) {
            return false;
        }
    }
    row.host.as_deref().is_some_and(host_is_private_lan)
}

/// Whether Auto is unhealthy for Direct delivery.
///
/// - `delivery_degraded`: recent Auto Direct failure still within suppress window.
/// - Otherwise evaluate the **active** Auto path row when known (a second down Auto
///   must not demote a live active Auto).
/// - When the active iface is Auto by name only (no matching row), unhealthy only if
///   every enabled Auto is down.
pub fn auto_unhealthy_for_delivery(
    interfaces: &[InterfaceRow],
    active_path_iface: Option<&str>,
    delivery_degraded: bool,
) -> bool {
    if delivery_degraded {
        return true;
    }
    let autos: Vec<&InterfaceRow> = interfaces
        .iter()
        .filter(|r| is_auto_interface_row(r) && r.enabled)
        .collect();
    if let Some(name) = active_path_iface.map(str::trim).filter(|s| !s.is_empty()) {
        if let Some(row) = find_interface_row(name, interfaces) {
            if is_auto_interface_row(row) {
                return !interface_status_live(&row.status);
            }
            return false;
        }
        if is_auto_iface_name_or_type(name) {
            if autos.is_empty() {
                return true;
            }
            return autos.iter().all(|r| !interface_status_live(&r.status));
        }
        return false;
    }
    false
}

/// Live private TCP/UDP interface display names.
pub fn live_private_iface_names(interfaces: &[InterfaceRow]) -> Vec<String> {
    interfaces
        .iter()
        .filter(|r| r.enabled && interface_status_live(&r.status))
        .filter(|r| interface_row_is_private_network(r))
        .filter(|r| !r.name.trim().is_empty())
        .map(|r| r.name.clone())
        .collect()
}

/// Reorder live iface names: private LAN first, then the rest (stable within tiers).
pub fn order_live_ifaces_private_first(
    live_ifaces: &[String],
    interfaces: &[InterfaceRow],
) -> Vec<String> {
    let private = live_private_iface_names(interfaces);
    let mut out: Vec<String> = Vec::with_capacity(live_ifaces.len());
    for name in live_ifaces {
        if private.iter().any(|p| p.eq_ignore_ascii_case(name)) {
            out.push(name.clone());
        }
    }
    for name in live_ifaces {
        if !out.iter().any(|o| o.eq_ignore_ascii_case(name)) {
            out.push(name.clone());
        }
    }
    out
}

/// Match a path-table interface name to a local row (name or id).
pub fn find_interface_row<'a>(
    path_iface: &str,
    interfaces: &'a [InterfaceRow],
) -> Option<&'a InterfaceRow> {
    interfaces
        .iter()
        .find(|i| i.name.eq_ignore_ascii_case(path_iface) || i.id.eq_ignore_ascii_case(path_iface))
}

/// Active path iface is Auto.
pub fn path_iface_is_auto(path_iface: Option<&str>, interfaces: &[InterfaceRow]) -> bool {
    let Some(name) = path_iface.map(str::trim).filter(|s| !s.is_empty()) else {
        return false;
    };
    if let Some(row) = find_interface_row(name, interfaces) {
        return is_auto_interface_row(row);
    }
    is_auto_iface_name_or_type(name)
}

/// Whether path slot interface names include a live private non-Auto iface.
pub fn path_has_live_private_backup(
    path_slot_ifaces: &[String],
    interfaces: &[InterfaceRow],
) -> bool {
    let private = live_private_iface_names(interfaces);
    if private.is_empty() {
        return false;
    }
    path_slot_ifaces.iter().any(|slot_iface| {
        private
            .iter()
            .any(|p| p.eq_ignore_ascii_case(slot_iface.trim()))
    })
}

/// Preempt Auto Direct toward a private path when Auto is unhealthy and a private
/// LAN hub is live. When `path_slot_ifaces` is non-empty, require the private hub
/// to already appear in those slots; when empty (active-route-only path cache),
/// any live private hub is enough — Suppress + RequestPath can promote it.
pub fn should_preempt_auto_for_private_direct(
    active_path_iface: Option<&str>,
    path_slot_ifaces: &[String],
    interfaces: &[InterfaceRow],
    delivery_degraded: bool,
) -> bool {
    if !path_iface_is_auto(active_path_iface, interfaces) {
        return false;
    }
    if !auto_unhealthy_for_delivery(interfaces, active_path_iface, delivery_degraded) {
        return false;
    }
    let private = live_private_iface_names(interfaces);
    if private.is_empty() {
        return false;
    }
    if path_slot_ifaces.is_empty() {
        return true;
    }
    path_has_live_private_backup(path_slot_ifaces, interfaces)
}

/// Live iface names for failover prefer tier (private LAN first when requested).
pub fn prefer_ifaces_for_failover(
    interfaces: &[InterfaceRow],
    blocked_ifaces: &[String],
    prefer_private_first: bool,
) -> Vec<String> {
    use super::path_failover::{live_interface_names, remaining_live_ifaces};
    let live = live_interface_names(interfaces);
    let ordered = if prefer_private_first {
        order_live_ifaces_private_first(&live, interfaces)
    } else {
        live
    };
    remaining_live_ifaces(&ordered, blocked_ifaces)
}

/// After Auto Direct failure, prefer private live ifaces when choosing rediscovery targets.
pub fn should_prefer_private_after_auto_failure(
    failed_iface: Option<&str>,
    interfaces: &[InterfaceRow],
) -> bool {
    if !path_iface_is_auto(failed_iface, interfaces) {
        return false;
    }
    !live_private_iface_names(interfaces).is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stack::types::interface_discovery_defaults;
    use std::collections::HashMap;

    fn row(
        name: &str,
        iface_type: &str,
        enabled: bool,
        status: &str,
        host: Option<&str>,
    ) -> InterfaceRow {
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
            iface_type: iface_type.into(),
            enabled,
            status: status.into(),
            host: host.map(str::to_string),
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
            flow_control: None,
            extra_config: HashMap::default(),
        }
    }

    #[test]
    fn host_private_literals() {
        assert!(host_is_private_lan("192.168.1.111"));
        assert!(host_is_private_lan("10.0.0.1"));
        assert!(host_is_private_lan("172.16.0.5"));
        assert!(host_is_private_lan("172.31.255.1"));
        assert!(host_is_private_lan("169.254.1.1"));
        assert!(host_is_private_lan("fe80::1"));
        assert!(host_is_private_lan("[fe80::1]"));
        assert!(host_is_private_lan("fd12::1"));
        assert!(host_is_private_lan("pi.local"));
        assert!(host_is_private_lan("Pi.Local"));
    }

    #[test]
    fn host_public_and_empty() {
        assert!(!host_is_private_lan("2.ratspeak.org"));
        assert!(!host_is_private_lan("8.8.8.8"));
        assert!(!host_is_private_lan("2001:db8::1"));
        assert!(!host_is_private_lan(""));
        assert!(!host_is_private_lan("   "));
    }

    #[test]
    fn auto_row_not_private_network_target() {
        let auto = row("Auto", "auto", true, "up", None);
        assert!(is_auto_interface_row(&auto));
        assert!(!interface_row_is_private_network(&auto));
    }

    #[test]
    fn private_tcp_row_detected() {
        let pi = row(
            "Local Transport Pi",
            "tcp",
            true,
            "up",
            Some("192.168.1.111"),
        );
        assert!(interface_row_is_private_network(&pi));
        let public = row("Ratspeak 2", "tcp", true, "up", Some("2.ratspeak.org"));
        assert!(!interface_row_is_private_network(&public));
        let no_host = row("TCP", "tcp", true, "up", None);
        assert!(!interface_row_is_private_network(&no_host));
    }

    #[test]
    fn healthy_auto_no_preempt() {
        let ifaces = [
            row("Auto", "auto", true, "up", None),
            row(
                "Local Transport Pi",
                "tcp",
                true,
                "up",
                Some("192.168.1.111"),
            ),
        ];
        assert!(!auto_unhealthy_for_delivery(&ifaces, Some("Auto"), false));
        assert!(!should_preempt_auto_for_private_direct(
            Some("Auto"),
            &["Auto".into(), "Local Transport Pi".into()],
            &ifaces,
            false,
        ));
    }

    #[test]
    fn mixed_auto_live_active_not_unhealthy() {
        let ifaces = [
            row("Auto", "auto", true, "up", None),
            row("Auto Backup", "auto", true, "down", None),
            row(
                "Local Transport Pi",
                "tcp",
                true,
                "up",
                Some("192.168.1.111"),
            ),
        ];
        assert!(!auto_unhealthy_for_delivery(&ifaces, Some("Auto"), false));
        assert!(!should_preempt_auto_for_private_direct(
            Some("Auto"),
            &[],
            &ifaces,
            false,
        ));
    }

    #[test]
    fn delivery_degraded_preempts_while_auto_up() {
        let ifaces = [
            row("Auto", "auto", true, "up", None),
            row(
                "Local Transport Pi",
                "tcp",
                true,
                "up",
                Some("192.168.1.111"),
            ),
        ];
        assert!(auto_unhealthy_for_delivery(&ifaces, Some("Auto"), true));
        assert!(should_preempt_auto_for_private_direct(
            Some("Auto"),
            &["Auto".into(), "Local Transport Pi".into()],
            &ifaces,
            true,
        ));
    }

    #[test]
    fn unhealthy_auto_with_private_preempts() {
        let ifaces = [
            row("Auto", "auto", true, "down", None),
            row(
                "Local Transport Pi",
                "tcp",
                true,
                "up",
                Some("192.168.1.111"),
            ),
        ];
        assert!(auto_unhealthy_for_delivery(&ifaces, Some("Auto"), false));
        assert!(should_preempt_auto_for_private_direct(
            Some("Auto"),
            &["Auto".into(), "Local Transport Pi".into()],
            &ifaces,
            false,
        ));
    }

    #[test]
    fn unhealthy_auto_public_only_no_preempt() {
        let ifaces = [
            row("Auto", "auto", true, "down", None),
            row("Ratspeak 2", "tcp", true, "up", Some("2.ratspeak.org")),
        ];
        assert!(!should_preempt_auto_for_private_direct(
            Some("Auto"),
            &["Auto".into(), "Ratspeak 2".into()],
            &ifaces,
            false,
        ));
    }

    #[test]
    fn unhealthy_auto_empty_slots_preempts_when_private_live() {
        let ifaces = [
            row("Auto", "auto", true, "down", None),
            row(
                "Local Transport Pi",
                "tcp",
                true,
                "up",
                Some("192.168.1.111"),
            ),
        ];
        assert!(should_preempt_auto_for_private_direct(
            Some("Auto"),
            &[],
            &ifaces,
            false,
        ));
    }

    #[test]
    fn unhealthy_auto_slots_without_private_no_preempt() {
        let ifaces = [
            row("Auto", "auto", true, "down", None),
            row(
                "Local Transport Pi",
                "tcp",
                true,
                "up",
                Some("192.168.1.111"),
            ),
            row("Ratspeak 2", "tcp", true, "up", Some("2.ratspeak.org")),
        ];
        // Non-empty slots list that does not include the private hub.
        assert!(!should_preempt_auto_for_private_direct(
            Some("Auto"),
            &["Auto".into(), "Ratspeak 2".into()],
            &ifaces,
            false,
        ));
    }

    #[test]
    fn prefer_ifaces_private_first_excludes_blocked() {
        let ifaces = [
            row("Ratspeak 2", "tcp", true, "up", Some("2.ratspeak.org")),
            row(
                "Local Transport Pi",
                "tcp",
                true,
                "up",
                Some("192.168.1.111"),
            ),
            row("Auto", "auto", true, "up", None),
        ];
        let prefer = prefer_ifaces_for_failover(&ifaces, &["Auto".into()], true);
        assert_eq!(
            prefer,
            vec!["Local Transport Pi".to_string(), "Ratspeak 2".to_string()]
        );
    }

    #[test]
    fn order_private_first() {
        let ifaces = [
            row("Ratspeak 2", "tcp", true, "up", Some("2.ratspeak.org")),
            row(
                "Local Transport Pi",
                "tcp",
                true,
                "up",
                Some("192.168.1.111"),
            ),
        ];
        let live = vec!["Ratspeak 2".into(), "Local Transport Pi".into()];
        assert_eq!(
            order_live_ifaces_private_first(&live, &ifaces),
            vec!["Local Transport Pi".to_string(), "Ratspeak 2".to_string()]
        );
    }

    #[test]
    fn prefer_private_after_auto_failure() {
        let ifaces = [row(
            "Local Transport Pi",
            "tcp",
            true,
            "up",
            Some("192.168.1.111"),
        )];
        assert!(should_prefer_private_after_auto_failure(
            Some("Auto"),
            &ifaces
        ));
        assert!(!should_prefer_private_after_auto_failure(
            Some("Ratspeak 2"),
            &ifaces
        ));
    }
}

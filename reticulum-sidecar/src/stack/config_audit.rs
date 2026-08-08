//! Config audit + repair for Reticulum interface INI.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::config::{
    self, StackSettings, interface_id_from_name, list_interface_ini_blocks_for_audit,
};
use super::rf_profiles::{match_params_to_profile, rf_profile_by_id};
use super::types::InterfaceRow;

pub const SHARED_INSTANCE_NAME: &str = "SharedInstanceServer";
pub const SHARED_INSTANCE_CLIENT_NAME: &str = "SharedInstanceClient";

#[derive(Debug, Clone, Serialize)]
pub struct ConfigAuditIssue {
    pub kind: String,
    pub severity: String,
    pub interface_id: Option<String>,
    pub interface_name: Option<String>,
    pub message: String,
    pub repair_kind: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ConfigRepairRequest {
    #[serde(default)]
    pub repair_kinds: Vec<String>,
}

pub fn audit_config(
    config_dir: &Path,
    live_interfaces: &[InterfaceRow],
    stack_settings: &StackSettings,
    stack_running: bool,
) -> Result<Vec<ConfigAuditIssue>, String> {
    let mut issues = Vec::new();
    let config_rows = config::interfaces_from_config_dir(config_dir).unwrap_or_default();

    let live_by_name: HashMap<String, &InterfaceRow> = live_interfaces
        .iter()
        .map(|i| (i.name.clone(), i))
        .collect();

    for block in list_interface_ini_blocks_for_audit(config_dir)? {
        let id = interface_id_from_name(&block.name);
        if block.iface_type.as_deref() == Some("TCPClientInterface") && block.enabled {
            if block.has_enabled_key && !block.has_interface_enabled_key {
                issues.push(issue(
                    "tcp_enable_key",
                    "error",
                    Some(id.clone()),
                    Some(block.name.clone()),
                    format!(
                        "TCP interface \"{}\" uses enabled=Yes but RNS requires interface_enabled",
                        block.name
                    ),
                    Some("repair_config"),
                ));
            }
            if !block.has_name_field {
                issues.push(issue(
                    "tcp_missing_name",
                    "warning",
                    Some(id.clone()),
                    Some(block.name.clone()),
                    format!("TCP interface \"{}\" missing name = field", block.name),
                    Some("repair_config"),
                ));
            }
        }
    }

    for row in &config_rows {
        if row.iface_type == "rnode" && row.enabled {
            audit_rnode_row(row, &mut issues);
        }
    }

    // Keep status set aligned with renderer `isReticulumInterfaceOnlineStatus`.
    let shared_client_live = live_interfaces.iter().find(|i| {
        i.name == SHARED_INSTANCE_CLIENT_NAME
            && matches!(
                i.status.to_ascii_lowercase().as_str(),
                "up" | "connected" | "online" | "running"
            )
    });
    let shared_instance_client = shared_client_live.is_some();

    if stack_running && !shared_instance_client {
        for row in config_rows.iter().filter(|r| r.enabled) {
            if row.iface_type != "tcp" {
                continue;
            }
            if !live_by_name.contains_key(&row.name) {
                issues.push(issue(
                    "ghost_interface",
                    "error",
                    Some(row.id.clone()),
                    Some(row.name.clone()),
                    format!(
                        "Interface \"{}\" enabled in config but not loaded by RNS",
                        row.name
                    ),
                    Some("repair_config"),
                ));
            }
        }
    }

    for live in live_interfaces {
        // Client mode never spawns local TCP hubs — unreachable is misleading.
        if !shared_instance_client
            && live.iface_type == "tcp"
            && live.enabled
            && live.status != "up"
        {
            issues.push(issue(
                "tcp_unreachable",
                "warning",
                Some(live.id.clone()),
                Some(live.name.clone()),
                format!("TCP interface \"{}\" is unreachable", live.name),
                Some("disable"),
            ));
        }
        if live.name == SHARED_INSTANCE_NAME {
            issues.push(issue(
                "runtime_only_interface",
                "info",
                Some(live.id.clone()),
                Some(live.name.clone()),
                "Runtime shared-instance server (not in config)".into(),
                None,
            ));
        }
    }

    let has_auto_config = config_rows
        .iter()
        .any(|r| r.iface_type == "auto" && r.enabled);
    if stack_running && !has_auto_config {
        issues.push(issue(
            "missing_auto_interface",
            "warning",
            None,
            None,
            "No enabled AutoInterface — local LAN discovery is off".into(),
            Some("add_auto"),
        ));
    }

    if stack_running {
        if let Some(auto) = live_interfaces
            .iter()
            .find(|i| i.iface_type == "auto" || i.name == "Default Interface")
        {
            if auto.enabled && auto.status != "up" {
                issues.push(issue(
                    "auto_interface_down",
                    "warning",
                    Some(auto.id.clone()),
                    Some(auto.name.clone()),
                    format!("AutoInterface \"{}\" is enabled but down", auto.name),
                    Some("restart_stack"),
                ));
            }
        }
    }

    let shared_live = live_interfaces
        .iter()
        .find(|i| i.name == SHARED_INSTANCE_NAME);
    if let Some(client) = shared_client_live {
        issues.push(issue(
            "shared_instance_client",
            "warning",
            Some(client.id.clone()),
            Some(SHARED_INSTANCE_CLIENT_NAME.into()),
            "Share instance attached as a client of another Reticulum app — local TCP hubs in this config are not started".into(),
            Some("disable_share_instance"),
        ));
    } else if stack_settings.share_instance {
        if stack_running && shared_live.map(|i| i.status.as_str()) != Some("up") {
            issues.push(issue(
                "missing_shared_instance",
                "warning",
                shared_live.map(|i| i.id.clone()),
                Some(SHARED_INSTANCE_NAME.into()),
                "Share instance is on but this app is not hosting the shared server — quit other Reticulum apps or turn off Share instance, then restart".into(),
                Some("disable_share_instance"),
            ));
        }
    } else if shared_live.is_some() {
        issues.push(issue(
            "shared_instance_unexpected",
            "info",
            shared_live.map(|i| i.id.clone()),
            Some(SHARED_INSTANCE_NAME.into()),
            "Shared instance server is live but Share instance is off — restart the stack".into(),
            Some("restart_stack"),
        ));
    }

    let enabled_rnodes: Vec<&InterfaceRow> = live_interfaces
        .iter()
        .filter(|i| i.iface_type == "rnode" && i.enabled)
        .collect();
    if enabled_rnodes.len() >= 2 {
        let mut keys = HashSet::new();
        for r in &enabled_rnodes {
            if let Some(p) =
                match_params_to_profile(r.frequency, r.bandwidth, r.spreading_factor, r.coding_rate)
            {
                keys.insert(p.id);
            } else {
                keys.insert(format!(
                    "custom:{}:{}:{}",
                    r.frequency.unwrap_or(0),
                    r.bandwidth.unwrap_or(0),
                    r.spreading_factor.unwrap_or(0)
                ));
            }
        }
        if keys.len() > 1 {
            issues.push(issue(
                "rf_cross_mismatch",
                "warning",
                None,
                None,
                "Multiple enabled RNodes use different RF parameters".into(),
                Some("edit"),
            ));
        }
    }

    for r in &enabled_rnodes {
        if let Some(profile) =
            match_params_to_profile(r.frequency, r.bandwidth, r.spreading_factor, r.coding_rate)
        {
            if profile.tier == "fallback" {
                issues.push(issue(
                    "rf_using_fallback",
                    "info",
                    Some(r.id.clone()),
                    Some(r.name.clone()),
                    format!(
                        "RNode \"{}\" uses global fallback profile {}",
                        r.name, profile.id
                    ),
                    Some("edit"),
                ));
            }
        }
    }

    audit_rmap_discovery(&config_rows, stack_settings, &mut issues);

    Ok(issues)
}

fn is_valid_lat_lon(lat: f64, lon: f64) -> bool {
    lat.is_finite()
        && (-90.0..=90.0).contains(&lat)
        && lon.is_finite()
        && (-180.0..=180.0).contains(&lon)
}

fn is_local_rnode_publish_target(row: &InterfaceRow) -> bool {
    if row.iface_type != "rnode" && row.iface_type != "rnode_multi" && row.iface_type != "kiss" {
        return row.iface_type == "ble_peer";
    }
    row.serial_port
        .as_ref()
        .is_some_and(|p| !p.trim().is_empty())
}

fn audit_rmap_discovery(
    config_rows: &[InterfaceRow],
    stack_settings: &StackSettings,
    issues: &mut Vec<ConfigAuditIssue>,
) {
    let mut any_discoverable = false;
    let mut discoverable_local_rnode = false;
    let mut any_enabled_tcp = false;

    for row in config_rows {
        if row.iface_type == "tcp" && row.enabled {
            any_enabled_tcp = true;
        }
        if row.discoverable != Some(true) {
            continue;
        }
        any_discoverable = true;
        if is_local_rnode_publish_target(row) && row.enabled {
            discoverable_local_rnode = true;
        }

        let coords_ok = row
            .latitude
            .zip(row.longitude)
            .is_some_and(|(lat, lon)| is_valid_lat_lon(lat, lon));
        if !coords_ok {
            issues.push(issue(
                "rmap_missing_coordinates",
                "error",
                Some(row.id.clone()),
                Some(row.name.clone()),
                format!(
                    "Interface \"{}\" is discoverable but missing valid latitude/longitude",
                    row.name
                ),
                Some("edit"),
            ));
        }

        if row.iface_type == "i2p" && row.connectable != Some(true) {
            issues.push(issue(
                "rmap_i2p_not_connectable",
                "warning",
                Some(row.id.clone()),
                Some(row.name.clone()),
                format!(
                    "I2P interface \"{}\" is discoverable but connectable is not yes",
                    row.name
                ),
                Some("edit"),
            ));
        }
    }

    if any_discoverable && !stack_settings.enable_transport {
        issues.push(issue(
            "rmap_transport_disabled",
            "warning",
            None,
            None,
            "Discoverable interfaces are configured but enable_transport is off".into(),
            Some("edit"),
        ));
    }

    if discoverable_local_rnode && !any_enabled_tcp {
        issues.push(issue(
            "rmap_no_tcp_hub",
            "warning",
            None,
            None,
            "Discoverable local RNode has no enabled TCP client hub for internet reachability"
                .into(),
            Some("edit"),
        ));
    }
}

fn audit_rnode_row(row: &InterfaceRow, issues: &mut Vec<ConfigAuditIssue>) {
    if let Some(ref preset) = row.preset {
        if let Some(profile) = rf_profile_by_id(preset) {
            if !super::rf_profiles::params_match_profile(
                row.frequency,
                row.bandwidth,
                row.spreading_factor,
                row.coding_rate,
                &profile,
            ) {
                issues.push(issue(
                    "rf_preset_deviation",
                    "warning",
                    Some(row.id.clone()),
                    Some(row.name.clone()),
                    format!(
                        "RNode \"{}\" params differ from preset {}",
                        row.name, preset
                    ),
                    Some("apply_preset"),
                ));
            }
            if profile.canonical_id.is_some() && profile.tier == "legacy" {
                issues.push(issue(
                    "rf_legacy_preset_id",
                    "info",
                    Some(row.id.clone()),
                    Some(row.name.clone()),
                    format!(
                        "Legacy preset \"{}\" — consider {}",
                        preset,
                        profile.canonical_id.as_deref().unwrap_or(preset)
                    ),
                    Some("repair_config"),
                ));
            }
        }
    } else if row.frequency.is_some()
        && match_params_to_profile(
            row.frequency,
            row.bandwidth,
            row.spreading_factor,
            row.coding_rate,
        )
        .is_none()
    {
        issues.push(issue(
            "rf_unknown_params",
            "warning",
            Some(row.id.clone()),
            Some(row.name.clone()),
            format!(
                "RNode \"{}\" RF params match no coordinated or fallback profile",
                row.name
            ),
            Some("edit"),
        ));
    }
}

fn issue(
    kind: &str,
    severity: &str,
    interface_id: Option<String>,
    interface_name: Option<String>,
    message: String,
    repair_kind: Option<&str>,
) -> ConfigAuditIssue {
    ConfigAuditIssue {
        kind: kind.into(),
        severity: severity.into(),
        interface_id,
        interface_name,
        message,
        repair_kind: repair_kind.map(str::to_string),
    }
}

pub fn repair_config(
    config_dir: &Path,
    request: &ConfigRepairRequest,
) -> Result<(Vec<String>, bool), String> {
    let kinds: HashSet<&str> = request.repair_kinds.iter().map(String::as_str).collect();
    let repair_all = kinds.is_empty();
    let mut repaired = Vec::new();
    let mut restart_required = false;

    let run_repair_config = repair_all || kinds.contains("repair_config");
    let run_apply_preset =
        repair_all || kinds.contains("apply_preset") || kinds.contains("repair_config");

    if run_repair_config {
        for name in config::repair_tcp_blocks_in_config(config_dir)? {
            repaired.push(format!("tcp:{name}"));
            restart_required = true;
        }
        for name in config::normalize_legacy_preset_ids(config_dir)? {
            repaired.push(format!("preset_id:{name}"));
            restart_required = true;
        }
    }
    if run_apply_preset {
        for name in config::apply_preset_defaults_to_config_rnodes(config_dir)? {
            repaired.push(format!("rnode_preset:{name}"));
            restart_required = true;
        }
    }
    if (repair_all || kinds.contains("add_auto")) && config::add_default_auto_interface(config_dir)?
    {
        repaired.push("add_auto:Default Interface".into());
        restart_required = true;
    }
    if repair_all || kinds.contains("disable_share_instance") {
        let mut settings = config::get_stack_settings(config_dir)?;
        if settings.share_instance {
            settings.share_instance = false;
            config::set_stack_settings(config_dir, &settings)?;
            repaired.push("disable_share_instance".into());
            restart_required = true;
        }
    }

    Ok((repaired, restart_required))
}

/// Offline config lint: parse + audit without a live stack (for validate-config CLI).
pub fn validate_config_offline(config_dir: &Path) -> Result<Vec<ConfigAuditIssue>, String> {
    config::parse_config_dir(config_dir)?;
    let settings = config::get_stack_settings(config_dir)?;
    audit_config(config_dir, &[], &settings, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stack::config::{self, StackSettings};
    use crate::stack::types::InterfaceRow;
    use std::fs;
    use uuid::Uuid;

    fn write_sample_config(dir: &std::path::Path, extra: &str) {
        let content = format!(
            r#"[reticulum]
enable_transport = Yes
share_instance = Yes

[logging]
loglevel = 4

[interfaces]
{extra}
"#
        );
        config::write_config(dir, &content).unwrap();
    }

    #[test]
    fn rmap_missing_coordinates_when_discoverable_without_lat() {
        let dir = std::env::temp_dir().join(format!("mesh_reticulum_audit_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        write_sample_config(
            &dir,
            r#"[[LoRa]]
type = RNodeInterface
enabled = Yes
port = /dev/ttyUSB0
discoverable = Yes
"#,
        );
        let rows = config::interfaces_from_config_dir(&dir).unwrap();
        let settings = StackSettings {
            enable_transport: true,
            ..Default::default()
        };
        let issues = audit_config(&dir, &rows, &settings, false).unwrap();
        assert!(issues.iter().any(|i| i.kind == "rmap_missing_coordinates"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rmap_no_tcp_hub_when_discoverable_rnode_only() {
        let dir = std::env::temp_dir().join(format!("mesh_reticulum_audit_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        write_sample_config(
            &dir,
            r#"[[LoRa]]
type = RNodeInterface
enabled = Yes
port = /dev/ttyUSB0
discoverable = Yes
latitude = 40.0
longitude = -105.0
"#,
        );
        let rows = config::interfaces_from_config_dir(&dir).unwrap();
        let settings = StackSettings {
            enable_transport: true,
            ..Default::default()
        };
        let issues = audit_config(&dir, &rows, &settings, false).unwrap();
        assert!(issues.iter().any(|i| i.kind == "rmap_no_tcp_hub"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rmap_transport_disabled_when_discoverable() {
        let dir = std::env::temp_dir().join(format!("mesh_reticulum_audit_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        write_sample_config(
            &dir,
            r#"[[LoRa]]
type = RNodeInterface
enabled = Yes
port = /dev/ttyUSB0
discoverable = Yes
latitude = 40.0
longitude = -105.0
"#,
        );
        let rows = config::interfaces_from_config_dir(&dir).unwrap();
        let settings = StackSettings {
            enable_transport: false,
            ..Default::default()
        };
        let issues = audit_config(&dir, &rows, &settings, false).unwrap();
        assert!(issues.iter().any(|i| i.kind == "rmap_transport_disabled"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rmap_i2p_not_connectable_when_discoverable() {
        let dir = std::env::temp_dir().join(format!("mesh_reticulum_audit_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        write_sample_config(
            &dir,
            r#"[[I2P]]
type = I2PInterface
enabled = Yes
peers = g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p
discoverable = Yes
latitude = 48.8566
longitude = 2.3522
"#,
        );
        let rows = config::interfaces_from_config_dir(&dir).unwrap();
        let settings = StackSettings {
            enable_transport: true,
            ..Default::default()
        };
        let issues = audit_config(&dir, &rows, &settings, false).unwrap();
        assert!(issues.iter().any(|i| i.kind == "rmap_i2p_not_connectable"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn shared_instance_client_suppresses_tcp_unreachable() {
        let dir = std::env::temp_dir().join(format!("mesh_reticulum_audit_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        write_sample_config(
            &dir,
            r#"[[Ratspeak]]
type = TCPClientInterface
interface_enabled = Yes
name = Ratspeak
target_host = rns.ratspeak.org
target_port = 4242
"#,
        );
        let mut rows = config::interfaces_from_config_dir(&dir).unwrap();
        for row in &mut rows {
            if row.name == "Ratspeak" {
                row.status = "down".into();
            }
        }
        rows.push(InterfaceRow {
            id: "rns-0".into(),
            name: SHARED_INSTANCE_CLIENT_NAME.into(),
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
        });
        let settings = StackSettings {
            share_instance: true,
            ..Default::default()
        };
        let issues = audit_config(&dir, &rows, &settings, true).unwrap();
        assert!(issues.iter().any(|i| i.kind == "shared_instance_client"));
        assert!(issues.iter().all(|i| i.kind != "tcp_unreachable"));
        assert!(issues.iter().all(|i| i.kind != "ghost_interface"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn repair_disable_share_instance_turns_share_off() {
        let dir = std::env::temp_dir().join(format!("mesh_reticulum_audit_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        write_sample_config(
            &dir,
            r#"[[Default Interface]]
type = AutoInterface
enabled = Yes
"#,
        );
        let mut settings = StackSettings {
            share_instance: true,
            ..Default::default()
        };
        config::set_stack_settings(&dir, &settings).unwrap();
        let req = ConfigRepairRequest {
            repair_kinds: vec!["disable_share_instance".into()],
        };
        let (repaired, restart) = repair_config(&dir, &req).unwrap();
        assert!(repaired.iter().any(|r| r == "disable_share_instance"));
        assert!(restart);
        settings = config::get_stack_settings(&dir).unwrap();
        assert!(!settings.share_instance);

        let (repaired2, restart2) = repair_config(&dir, &req).unwrap();
        assert!(!repaired2.iter().any(|r| r == "disable_share_instance"));
        assert!(!restart2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_config_offline_flags_tcp_enable_key() {
        let dir = std::env::temp_dir().join(format!("mesh_reticulum_audit_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        write_sample_config(
            &dir,
            r#"[[Legacy TCP]]
type = TCPClientInterface
enabled = Yes
name = Legacy TCP
target_host = 127.0.0.1
target_port = 4242
"#,
        );
        let issues = validate_config_offline(&dir).unwrap();
        assert!(issues.iter().any(|i| i.kind == "tcp_enable_key"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rmap_clean_config_produces_no_rmap_issues() {
        let dir = std::env::temp_dir().join(format!("mesh_reticulum_audit_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        write_sample_config(
            &dir,
            r#"[[LoRa]]
type = RNodeInterface
enabled = Yes
port = /dev/ttyUSB0
discoverable = Yes
latitude = 40.0
longitude = -105.0

[[RMAP World]]
type = TCPClientInterface
interface_enabled = Yes
name = RMAP World
target_host = rmap.world
target_port = 4242
"#,
        );
        let rows = config::interfaces_from_config_dir(&dir).unwrap();
        let settings = StackSettings {
            enable_transport: true,
            ..Default::default()
        };
        let issues = audit_config(&dir, &rows, &settings, false).unwrap();
        assert!(!issues.iter().any(|i| i.kind.starts_with("rmap_")));
        let _ = fs::remove_dir_all(&dir);
    }
}

//! Config audit + repair for Reticulum interface INI.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::config::{
    self, interface_id_from_name, list_interface_ini_blocks_for_audit, StackSettings,
};
use super::rf_profiles::{match_params_to_profile, rf_profile_by_id};
use super::types::InterfaceRow;

pub const SHARED_INSTANCE_NAME: &str = "SharedInstanceServer";

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

    if stack_running {
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
        if live.iface_type == "tcp" && live.enabled && live.status != "up" {
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

    let shared_live = live_interfaces.iter().find(|i| i.name == SHARED_INSTANCE_NAME);
    if stack_settings.share_instance {
        if stack_running && shared_live.map(|i| i.status.as_str()) != Some("up") {
            issues.push(issue(
                "missing_shared_instance",
                "warning",
                shared_live.map(|i| i.id.clone()),
                Some(SHARED_INSTANCE_NAME.into()),
                "share_instance is on but SharedInstanceServer is not up".into(),
                Some("restart_stack"),
            ));
        }
    } else if shared_live.is_some() {
        issues.push(issue(
            "shared_instance_unexpected",
            "info",
            shared_live.map(|i| i.id.clone()),
            Some(SHARED_INSTANCE_NAME.into()),
            "SharedInstanceServer is live but share_instance is off — restart stack".into(),
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
            if let Some(p) = match_params_to_profile(
                r.frequency,
                r.bandwidth,
                r.spreading_factor,
                r.coding_rate,
            ) {
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
        if let Some(profile) = match_params_to_profile(
            r.frequency,
            r.bandwidth,
            r.spreading_factor,
            r.coding_rate,
        ) {
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

    Ok(issues)
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
                    format!("RNode \"{}\" params differ from preset {}", row.name, preset),
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
    let kinds: HashSet<&str> = request.repair_kinds.iter().map(|s| s.as_str()).collect();
    let repair_all = kinds.is_empty();
    let mut repaired = Vec::new();
    let mut restart_required = false;

    let run_repair_config = repair_all || kinds.contains("repair_config");
    let run_apply_preset = repair_all || kinds.contains("apply_preset") || kinds.contains("repair_config");

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
    if repair_all || kinds.contains("add_auto") {
        if config::add_default_auto_interface(config_dir)? {
            repaired.push("add_auto:Default Interface".into());
            restart_required = true;
        }
    }

    Ok((repaired, restart_required))
}

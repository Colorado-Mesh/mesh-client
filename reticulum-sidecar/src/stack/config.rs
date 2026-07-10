//! rnsd-style INI config read/write (ConfigObj subset used by Reticulum).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use uuid::Uuid;

use super::types::{AddInterfaceRequest, InterfaceRow};

pub const CONFIG_FILENAME: &str = "config";

const SUPPORTED_TYPES: &[&str] = &[
    "AutoInterface",
    "TCPClientInterface",
    "RNodeInterface",
    "UDPInterface",
    "KISSInterface",
    "PipeInterface",
    "I2PInterface",
    "RNodeMultiInterface",
    "BlePeerInterface",
];

const SERIAL_PORT_IFACE_TYPES: &[&str] = &["rnode", "rnode_multi", "kiss"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportMode {
    Merge,
    Replace,
}

impl ImportMode {
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "merge" => Some(Self::Merge),
            "replace" => Some(Self::Replace),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct StackSettings {
    pub enable_transport: bool,
    pub share_instance: bool,
    pub loglevel: i32,
    #[serde(default)]
    pub announce_interval_sec: u32,
}

#[derive(Debug, Clone)]
pub struct ImportResult {
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct IniBlock {
    name: String,
    values: HashMap<String, String>,
    order: Vec<String>,
}

#[derive(Debug, Clone)]
struct ParsedConfig {
    reticulum: IniBlock,
    logging: IniBlock,
    interfaces: Vec<IniBlock>,
    /// Raw lines preserved for unknown top-level sections (future-proof).
    extra_sections: Vec<String>,
}

pub fn config_path(config_dir: &Path) -> PathBuf {
    config_dir.join(CONFIG_FILENAME)
}

pub fn read_config(config_dir: &Path) -> Result<String, String> {
    let path = config_path(config_dir);
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok(default_config_content())
    }
}

pub fn write_config(config_dir: &Path, content: &str) -> Result<(), String> {
    parse_config(content)?;
    fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    let path = config_path(config_dir);
    let tmp_path = config_dir.join(format!("{CONFIG_FILENAME}.tmp"));
    fs::write(&tmp_path, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &path).map_err(|e| e.to_string())
}

pub fn get_stack_settings(config_dir: &Path) -> Result<StackSettings, String> {
    let content = read_config(config_dir)?;
    let parsed = parse_config(&content)?;
    Ok(stack_settings_from_parsed(&parsed))
}

pub fn set_stack_settings(config_dir: &Path, settings: &StackSettings) -> Result<(), String> {
    let content = read_config(config_dir)?;
    let mut parsed = parse_config(&content)?;
    parsed
        .reticulum
        .set("enable_transport", &bool_to_ini(settings.enable_transport));
    parsed
        .reticulum
        .set("share_instance", &bool_to_ini(settings.share_instance));
    parsed
        .logging
        .set("loglevel", &settings.loglevel.to_string());
    parsed
        .reticulum
        .set("announce_interval_sec", &settings.announce_interval_sec.to_string());
    write_config(config_dir, &serialize_config(&parsed))
}

pub fn interfaces_from_config(content: &str) -> Result<Vec<InterfaceRow>, String> {
    let parsed = parse_config(content)?;
    Ok(interfaces_from_parsed(&parsed))
}

pub fn interfaces_from_config_dir(config_dir: &Path) -> Result<Vec<InterfaceRow>, String> {
    let content = read_config(config_dir)?;
    interfaces_from_config(&content)
}

pub fn sync_config_interfaces(
    config_dir: &Path,
    interfaces: &[InterfaceRow],
) -> Result<(), String> {
    let content = read_config(config_dir)?;
    let mut parsed = parse_config(&content)?;
    parsed.interfaces = interfaces.iter().map(interface_row_to_block).collect();
    write_config(config_dir, &serialize_config(&parsed))
}

pub fn import_config(
    config_dir: &Path,
    content: &str,
    mode: ImportMode,
) -> Result<ImportResult, String> {
    let incoming = parse_config(content)?;
    let warnings = collect_unsupported_warnings(&incoming);

    let merged = match mode {
        ImportMode::Replace => incoming,
        ImportMode::Merge => {
            let existing_content = read_config(config_dir)?;
            let mut existing = parse_config(&existing_content)?;
            merge_configs(&mut existing, &incoming);
            existing
        }
    };

    write_config(config_dir, &serialize_config(&merged))?;
    Ok(ImportResult { warnings })
}

fn merge_configs(existing: &mut ParsedConfig, incoming: &ParsedConfig) {
    for (k, v) in &incoming.reticulum.values {
        existing.reticulum.set(k, v);
    }
    for (k, v) in &incoming.logging.values {
        existing.logging.set(k, v);
    }
    for iface in &incoming.interfaces {
        if let Some(idx) = existing
            .interfaces
            .iter()
            .position(|i| i.name == iface.name)
        {
            existing.interfaces[idx] = iface.clone();
        } else {
            existing.interfaces.push(iface.clone());
        }
    }
}

fn collect_unsupported_warnings(parsed: &ParsedConfig) -> Vec<String> {
    let mut warnings = Vec::new();
    for block in &parsed.interfaces {
        if let Some(t) = block.get("type") {
            if !SUPPORTED_TYPES.contains(&t) {
                warnings.push(format!(
                    "interface \"{}\" has unsupported type \"{t}\" (kept in config)",
                    block.name
                ));
            }
        }
    }
    warnings
}

fn stack_settings_from_parsed(parsed: &ParsedConfig) -> StackSettings {
    StackSettings {
        enable_transport: parsed
            .reticulum
            .get_bool("enable_transport")
            .unwrap_or(false),
        share_instance: parsed.reticulum.get_bool("share_instance").unwrap_or(true),
        loglevel: parsed
            .logging
            .get("loglevel")
            .and_then(|v| v.parse().ok())
            .unwrap_or(4),
        announce_interval_sec: parsed
            .reticulum
            .get("announce_interval_sec")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
    }
}

fn interfaces_from_parsed(parsed: &ParsedConfig) -> Vec<InterfaceRow> {
    parsed
        .interfaces
        .iter()
        .filter_map(|block| interface_block_to_row(block))
        .collect()
}

fn interface_block_to_row(block: &IniBlock) -> Option<InterfaceRow> {
    let raw_type = block.get("type")?;
    if !SUPPORTED_TYPES.contains(&raw_type) {
        return None;
    }
    let iface_type = config_type_to_ui(raw_type)?;
    let enabled = block
        .get_bool("enabled")
        .or_else(|| block.get_bool("interface_enabled"))
        .unwrap_or(false);

    let (host, port) = if iface_type == "tcp" {
        (
            block.get("target_host").map(str::to_string),
            block.get("target_port").and_then(|p| p.parse::<u16>().ok()),
        )
    } else if iface_type == "i2p" {
        (
            block
                .get("peers")
                .map(str::trim)
                .filter(|peers| !peers.is_empty())
                .map(str::to_string),
            None,
        )
    } else {
        (None, None)
    };

    let serial_port = if SERIAL_PORT_IFACE_TYPES.contains(&iface_type) {
        block.get("port").map(str::to_string)
    } else {
        None
    };

    let seed_addresses = if iface_type == "ble_peer" {
        block
            .get("seed_addresses")
            .map(|s| {
                s.split(',')
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    Some(InterfaceRow {
        id: interface_id_from_name(&block.name),
        name: block.name.clone(),
        iface_type: iface_type.to_string(),
        enabled,
        status: if enabled { "up" } else { "down" }.into(),
        host,
        port,
        preset: block.get("preset").map(str::to_string),
        serial_port,
        frequency: block.get("frequency").and_then(|v| v.parse().ok()),
        bandwidth: block.get("bandwidth").and_then(|v| v.parse().ok()),
        txpower: block.get("txpower").and_then(|v| v.parse().ok()),
        spreading_factor: block
            .get("spreadingfactor")
            .or_else(|| block.get("spreading_factor"))
            .and_then(|v| v.parse().ok()),
        coding_rate: block.get("codingrate").and_then(|v| v.parse().ok()),
        callsign: block.get("callsign").map(str::to_string),
        id_interval: block.get("id_interval").and_then(|v| v.parse().ok()),
        mode: block.get("mode").map(str::to_string),
        seed_addresses,
        discoverable: block.get_bool("discoverable"),
        latitude: block.get("latitude").and_then(|v| v.parse().ok()),
        longitude: block.get("longitude").and_then(|v| v.parse().ok()),
        height: block.get("height").and_then(|v| v.parse().ok()),
        discovery_name: block.get("discovery_name").map(str::to_string),
        announce_interval_min: block
            .get("announce_interval")
            .and_then(|v| v.parse().ok()),
        connectable: block.get_bool("connectable"),
        reachable_on: block.get("reachable_on").map(str::to_string),
    })
}

fn interface_row_to_block(row: &InterfaceRow) -> IniBlock {
    let mut block = IniBlock {
        name: row.name.clone(),
        values: HashMap::new(),
        order: Vec::new(),
    };
    block.set("type", &ui_type_to_config(&row.iface_type));
    if row.iface_type == "tcp" || row.iface_type == "udp" {
        block.set("interface_enabled", &bool_to_ini(row.enabled));
        block.set("name", &row.name);
    } else {
        block.set("enabled", &bool_to_ini(row.enabled));
    }

    if row.iface_type == "tcp" || row.iface_type == "udp" {
        if let Some(host) = &row.host {
            block.set("target_host", host);
        }
        if let Some(port) = row.port {
            block.set("target_port", &port.to_string());
        }
    }

    if row.iface_type == "i2p" {
        if let Some(host) = &row.host {
            block.set("peers", host);
        }
    }

    if row.iface_type == "rnode" {
        write_rnode_radio_fields(&mut block, row);
    }

    if SERIAL_PORT_IFACE_TYPES.contains(&row.iface_type.as_str()) && row.iface_type != "rnode" {
        if let Some(port) = &row.serial_port {
            block.set("port", port);
        }
    }

    if row.iface_type == "ble_peer" && !row.seed_addresses.is_empty() {
        block.set("seed_addresses", &row.seed_addresses.join(","));
    }

    write_discovery_fields(&mut block, row);

    block
}

fn write_discovery_fields(block: &mut IniBlock, row: &InterfaceRow) {
    if let Some(v) = row.discoverable {
        block.set("discoverable", &bool_to_ini(v));
    }
    if let Some(v) = row.latitude {
        block.set("latitude", &v.to_string());
    }
    if let Some(v) = row.longitude {
        block.set("longitude", &v.to_string());
    }
    if let Some(v) = row.height {
        block.set("height", &v.to_string());
    }
    if let Some(v) = &row.discovery_name {
        block.set("discovery_name", v);
    }
    if let Some(v) = row.announce_interval_min {
        block.set("announce_interval", &v.to_string());
    }
    if let Some(v) = row.connectable {
        block.set("connectable", &bool_to_ini(v));
    }
    if let Some(v) = &row.reachable_on {
        block.set("reachable_on", v);
    }
}

fn write_rnode_radio_fields(block: &mut IniBlock, row: &InterfaceRow) {
    if let Some(port) = &row.serial_port {
        block.set("port", port);
    }
    if let Some(v) = row.frequency {
        block.set("frequency", &v.to_string());
    }
    if let Some(v) = row.bandwidth {
        block.set("bandwidth", &v.to_string());
    }
    if let Some(v) = row.txpower {
        block.set("txpower", &v.to_string());
    }
    if let Some(v) = row.spreading_factor {
        block.set("spreadingfactor", &v.to_string());
    }
    if let Some(v) = row.coding_rate {
        block.set("codingrate", &v.to_string());
    }
    if let Some(v) = &row.callsign {
        block.set("callsign", v);
    }
    if let Some(v) = row.id_interval {
        block.set("id_interval", &v.to_string());
    }
    if let Some(v) = &row.mode {
        block.set("mode", v);
    }
    if let Some(v) = &row.preset {
        block.set("preset", v);
    }
}

const I2P_PEERS_MAX_LEN: usize = 512;
const REACHABLE_ON_MAX_LEN: usize = 256;

pub fn validate_lat_lon(lat: f64, lon: f64) -> Result<(), String> {
    if !lat.is_finite() || lat < -90.0 || lat > 90.0 {
        return Err("invalid latitude".into());
    }
    if !lon.is_finite() || lon < -180.0 || lon > 180.0 {
        return Err("invalid longitude".into());
    }
    Ok(())
}

pub fn validate_reachable_on(value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("reachable_on required".into());
    }
    if trimmed.len() > REACHABLE_ON_MAX_LEN {
        return Err("reachable_on too long".into());
    }
    if trimmed.contains('\n') || trimmed.contains('\r') || trimmed.contains('\0') {
        return Err("invalid reachable_on".into());
    }
    Ok(())
}

fn apply_discovery_patch(row: &mut InterfaceRow, patch: &UpdateInterfacePatch) -> Result<(), String> {
    if patch.discoverable.is_some() {
        row.discoverable = patch.discoverable;
    }
    if patch.latitude.is_some() {
        if let Some(lat) = patch.latitude {
            if let Some(lon) = patch.longitude.or(row.longitude) {
                validate_lat_lon(lat, lon)?;
            } else if row.longitude.is_none() {
                validate_lat_lon(lat, 0.0)?;
            }
        }
        row.latitude = patch.latitude;
    }
    if patch.longitude.is_some() {
        if let Some(lon) = patch.longitude {
            if let Some(lat) = patch.latitude.or(row.latitude) {
                validate_lat_lon(lat, lon)?;
            } else if row.latitude.is_none() {
                validate_lat_lon(0.0, lon)?;
            }
        }
        row.longitude = patch.longitude;
    }
    if patch.height.is_some() {
        row.height = patch.height;
    }
    if patch.discovery_name.is_some() {
        row.discovery_name = patch.discovery_name.clone();
    }
    if patch.announce_interval_min.is_some() {
        row.announce_interval_min = patch.announce_interval_min;
    }
    if patch.connectable.is_some() {
        row.connectable = patch.connectable;
    }
    if patch.reachable_on.is_some() {
        if let Some(ref value) = patch.reachable_on {
            if !value.trim().is_empty() {
                validate_reachable_on(value)?;
            }
        }
        row.reachable_on = patch.reachable_on.clone();
    }
    if row.discoverable == Some(true) {
        if let (Some(lat), Some(lon)) = (row.latitude, row.longitude) {
            validate_lat_lon(lat, lon)?;
        }
    }
    Ok(())
}

const I2P_B32_SUFFIX: &str = ".b32.i2p";

fn validate_i2p_peers(peers: &str) -> Result<(), String> {
    let trimmed = peers.trim();
    if trimmed.is_empty() {
        return Err("i2p peers required".into());
    }
    if trimmed.len() > I2P_PEERS_MAX_LEN {
        return Err("i2p peers too long".into());
    }
    if trimmed.contains('\n') || trimmed.contains('\r') || trimmed.contains('\0') {
        return Err("invalid i2p peers".into());
    }
    for entry in trimmed.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let lower = entry.to_ascii_lowercase();
        if !lower.ends_with(I2P_B32_SUFFIX) {
            return Err("invalid i2p peer address".into());
        }
        let hash = &lower[..lower.len() - I2P_B32_SUFFIX.len()];
        if hash.len() != 52 || !hash.chars().all(|c| matches!(c, 'a'..='z' | '2'..='7')) {
            return Err("invalid i2p peer address".into());
        }
    }
    Ok(())
}

pub fn add_interface_to_config(
    config_dir: &Path,
    req: &AddInterfaceRequest,
) -> Result<InterfaceRow, String> {
    if req.iface_type == "i2p" {
        if let Some(ref host) = req.host {
            validate_i2p_peers(host)?;
        } else {
            return Err("i2p peers required".into());
        }
    }
    let id = Uuid::new_v4().to_string();
    let name = req
        .name
        .clone()
        .unwrap_or_else(|| format!("{}-{}", req.iface_type, &id[..8]));

    let enabled = req.enabled.unwrap_or(true);
    let mut row = InterfaceRow {
        id: interface_id_from_name(&name),
        name,
        iface_type: req.iface_type.clone(),
        enabled,
        status: if enabled { "pending".into() } else { "down".into() },
        host: req.host.clone(),
        port: req.port,
        preset: req.preset.clone(),
        serial_port: req.serial_port.clone(),
        frequency: req.frequency,
        bandwidth: req.bandwidth,
        txpower: req.txpower,
        spreading_factor: req.spreading_factor,
        coding_rate: req.coding_rate,
        callsign: req.callsign.clone(),
        id_interval: req.id_interval,
        mode: req.mode.clone(),
        seed_addresses: req.seed_addresses.clone(),
        discoverable: req.discoverable,
        latitude: req.latitude,
        longitude: req.longitude,
        height: req.height,
        discovery_name: req.discovery_name.clone(),
        announce_interval_min: req.announce_interval_min,
        connectable: req.connectable,
        reachable_on: req.reachable_on.clone(),
    };

    apply_preset_defaults(&mut row);

    let content = read_config(config_dir)?;
    let mut parsed = parse_config(&content)?;
    if parsed
        .interfaces
        .iter()
        .any(|b| interface_id_from_name(&b.name) == row.id)
    {
        row.id = format!("{}-{}", row.id, &id[..4]);
    }
    parsed.interfaces.push(interface_row_to_block(&row));
    write_config(config_dir, &serialize_config(&parsed))?;
    Ok(row)
}

pub fn update_interface_in_config(
    config_dir: &Path,
    id: &str,
    patch: &UpdateInterfacePatch,
) -> Result<InterfaceRow, String> {
    let content = read_config(config_dir)?;
    let mut parsed = parse_config(&content)?;
    let idx = parsed
        .interfaces
        .iter()
        .position(|b| interface_id_from_name(&b.name) == id)
        .ok_or_else(|| format!("interface not found: {id}"))?;

    let mut row = interface_block_to_row(&parsed.interfaces[idx])
        .ok_or_else(|| format!("interface not found or unsupported: {id}"))?;

    let preset_before = row.preset.clone();

    if let Some(v) = &patch.name {
        row.name = v.clone();
    }
    if let Some(v) = &patch.iface_type {
        row.iface_type = v.clone();
    }
    if let Some(v) = patch.enabled {
        row.enabled = v;
        row.status = if v { "up" } else { "down" }.into();
    }
    if patch.host.is_some() {
        if row.iface_type == "i2p" {
            if let Some(ref host) = patch.host {
                validate_i2p_peers(host)?;
            }
        }
        row.host = patch.host.clone();
    }
    if patch.port.is_some() {
        row.port = patch.port;
    }
    if patch.serial_port.is_some() {
        row.serial_port = patch.serial_port.clone();
    }
    if patch.preset.is_some() {
        row.preset = patch.preset.clone();
    }
    if patch.frequency.is_some() {
        row.frequency = patch.frequency;
    }
    if patch.bandwidth.is_some() {
        row.bandwidth = patch.bandwidth;
    }
    if patch.txpower.is_some() {
        row.txpower = patch.txpower;
    }
    if patch.spreading_factor.is_some() {
        row.spreading_factor = patch.spreading_factor;
    }
    if patch.coding_rate.is_some() {
        row.coding_rate = patch.coding_rate;
    }
    if patch.callsign.is_some() {
        row.callsign = patch.callsign.clone();
    }
    if patch.id_interval.is_some() {
        row.id_interval = patch.id_interval;
    }
    if patch.mode.is_some() {
        row.mode = patch.mode.clone();
    }
    if patch.seed_addresses.is_some() {
        row.seed_addresses = patch.seed_addresses.clone().unwrap_or_default();
    }

    apply_discovery_patch(&mut row, patch)?;

    let preset_changed = patch.preset.is_some() && patch.preset != preset_before;
    if preset_changed {
        crate::stack::rf_profiles::force_apply_profile_defaults_to_row(&mut row);
    } else {
        apply_preset_defaults(&mut row);
    }

    if row.iface_type == "i2p" {
        validate_i2p_peers(row.host.as_deref().unwrap_or(""))?;
    }

    parsed.interfaces[idx] = interface_row_to_block(&row);
    write_config(config_dir, &serialize_config(&parsed))?;
    Ok(row)
}

pub fn delete_interface_from_config(config_dir: &Path, id: &str) -> Result<(), String> {
    let content = read_config(config_dir)?;
    let mut parsed = parse_config(&content)?;
    let len_before = parsed.interfaces.len();
    parsed
        .interfaces
        .retain(|b| interface_id_from_name(&b.name) != id);
    if parsed.interfaces.len() == len_before {
        return Err(format!("interface not found: {id}"));
    }
    write_config(config_dir, &serialize_config(&parsed))
}

pub fn set_interface_enabled_in_config(
    config_dir: &Path,
    id: &str,
    enabled: bool,
) -> Result<(), String> {
    update_interface_in_config(
        config_dir,
        id,
        &UpdateInterfacePatch {
            enabled: Some(enabled),
            ..UpdateInterfacePatch::default()
        },
    )?;
    Ok(())
}

/// Move an interface INI block to `target_index` (0-based among interface blocks).
pub fn move_interface_block_to_index(
    config_dir: &Path,
    id: &str,
    target_index: usize,
) -> Result<bool, String> {
    let content = read_config(config_dir)?;
    let mut parsed = parse_config(&content)?;
    let current_idx = parsed
        .interfaces
        .iter()
        .position(|b| interface_id_from_name(&b.name) == id)
        .ok_or_else(|| format!("interface not found: {id}"))?;
    if current_idx == target_index {
        return Ok(false);
    }
    let block = parsed.interfaces.remove(current_idx);
    let insert_at = if current_idx < target_index {
        target_index.saturating_sub(1)
    } else {
        target_index
    };
    parsed
        .interfaces
        .insert(insert_at.min(parsed.interfaces.len()), block);
    write_config(config_dir, &serialize_config(&parsed))?;
    Ok(true)
}

#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct UpdateInterfacePatch {
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub iface_type: Option<String>,
    pub enabled: Option<bool>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub preset: Option<String>,
    pub serial_port: Option<String>,
    pub frequency: Option<u64>,
    pub bandwidth: Option<u32>,
    pub txpower: Option<i32>,
    pub spreading_factor: Option<u8>,
    pub coding_rate: Option<u8>,
    pub callsign: Option<String>,
    pub id_interval: Option<u32>,
    pub mode: Option<String>,
    pub seed_addresses: Option<Vec<String>>,
    pub discoverable: Option<bool>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub height: Option<u32>,
    pub discovery_name: Option<String>,
    pub announce_interval_min: Option<u32>,
    pub connectable: Option<bool>,
    pub reachable_on: Option<String>,
}

/// Expand `preset` into concrete radio fields on disk when INI rows are incomplete.
pub fn repair_rnode_radio_fields_in_config(config_dir: &Path) -> Result<bool, String> {
    let content = read_config(config_dir)?;
    let mut parsed = parse_config(&content)?;
    let mut changed = false;
    for block in &mut parsed.interfaces {
        let Some(mut row) = interface_block_to_row(block) else {
            continue;
        };
        if !rnode_needs_preset_expansion(&row) {
            continue;
        }
        apply_preset_defaults(&mut row);
        *block = interface_row_to_block(&row);
        changed = true;
    }
    if changed {
        write_config(config_dir, &serialize_config(&parsed))?;
    }
    Ok(changed)
}

fn rnode_needs_preset_expansion(row: &InterfaceRow) -> bool {
    if row.iface_type != "rnode" {
        return false;
    }
    let preset = row.preset.as_deref().unwrap_or("");
    if !crate::stack::rf_profiles::known_preset_ids().iter().any(|id| id == preset) {
        return false;
    }
    row.frequency.is_none()
        || row.bandwidth.is_none()
        || row.spreading_factor.is_none()
        || row.coding_rate.is_none()
        || row.txpower.is_none()
}

fn apply_preset_defaults(row: &mut InterfaceRow) {
    crate::stack::rf_profiles::apply_profile_defaults_to_row(row);
}

/// INI block metadata for config audit (TCP enable-key checks).
#[derive(Debug, Clone)]
pub struct ConfigAuditIniBlock {
    pub name: String,
    pub iface_type: Option<String>,
    pub has_enabled_key: bool,
    pub has_interface_enabled_key: bool,
    pub enabled: bool,
    pub has_name_field: bool,
}

pub fn list_interface_ini_blocks_for_audit(config_dir: &Path) -> Result<Vec<ConfigAuditIniBlock>, String> {
    let content = read_config(config_dir)?;
    let parsed = parse_config(&content)?;
    Ok(parsed
        .interfaces
        .iter()
        .map(|block| ConfigAuditIniBlock {
            name: block.name.clone(),
            iface_type: block.get("type").map(str::to_string),
            has_enabled_key: block.get("enabled").is_some(),
            has_interface_enabled_key: block.get("interface_enabled").is_some(),
            enabled: block
                .get_bool("enabled")
                .or_else(|| block.get_bool("interface_enabled"))
                .unwrap_or(false),
            has_name_field: block.get("name").is_some(),
        })
        .collect())
}

pub fn repair_tcp_blocks_in_config(config_dir: &Path) -> Result<Vec<String>, String> {
    let content = read_config(config_dir)?;
    let mut parsed = parse_config(&content)?;
    let mut repaired = Vec::new();
    for block in &mut parsed.interfaces {
        if block.get("type") != Some("TCPClientInterface") {
            continue;
        }
        let enabled = block
            .get_bool("enabled")
            .or_else(|| block.get_bool("interface_enabled"))
            .unwrap_or(false);
        block.set("interface_enabled", &bool_to_ini(enabled));
        if block.get("name").is_none() {
            let section_name = block.name.clone();
            block.set("name", &section_name);
        }
        if block.values.contains_key("enabled") {
            block.values.remove("enabled");
            block.order.retain(|k| k != "enabled");
        }
        repaired.push(block.name.clone());
    }
    if !repaired.is_empty() {
        write_config(config_dir, &serialize_config(&parsed))?;
    }
    Ok(repaired)
}

pub fn add_default_auto_interface(config_dir: &Path) -> Result<bool, String> {
    let content = read_config(config_dir)?;
    let mut parsed = parse_config(&content)?;
    if parsed
        .interfaces
        .iter()
        .any(|b| b.get("type") == Some("AutoInterface"))
    {
        return Ok(false);
    }
    let mut block = IniBlock::new("Default Interface");
    block.set("type", "AutoInterface");
    block.set("enabled", "Yes");
    block.set("name", "Default Interface");
    parsed.interfaces.insert(0, block);
    write_config(config_dir, &serialize_config(&parsed))?;
    Ok(true)
}

pub fn normalize_legacy_preset_ids(config_dir: &Path) -> Result<Vec<String>, String> {
    let content = read_config(config_dir)?;
    let mut parsed = parse_config(&content)?;
    let mut changed_names = Vec::new();
    for block in &mut parsed.interfaces {
        let Some(mut row) = interface_block_to_row(block) else {
            continue;
        };
        let Some(preset) = row.preset.clone() else {
            continue;
        };
        let Some(profile) = crate::stack::rf_profiles::rf_profile_by_id(&preset) else {
            continue;
        };
        let Some(canonical) = profile.canonical_id.clone() else {
            continue;
        };
        row.preset = Some(canonical);
        crate::stack::rf_profiles::force_apply_profile_defaults_to_row(&mut row);
        *block = interface_row_to_block(&row);
        changed_names.push(row.name);
    }
    if !changed_names.is_empty() {
        write_config(config_dir, &serialize_config(&parsed))?;
    }
    Ok(changed_names)
}

pub fn apply_preset_defaults_to_config_rnodes(config_dir: &Path) -> Result<Vec<String>, String> {
    let content = read_config(config_dir)?;
    let mut parsed = parse_config(&content)?;
    let mut changed_names = Vec::new();
    for block in &mut parsed.interfaces {
        let Some(mut row) = interface_block_to_row(block) else {
            continue;
        };
        if row.iface_type != "rnode" {
            continue;
        }
        let Some(preset) = row.preset.clone() else {
            continue;
        };
        let Some(profile) = crate::stack::rf_profiles::rf_profile_by_id(&preset) else {
            continue;
        };
        if crate::stack::rf_profiles::row_params_match_preset(&row) {
            continue;
        }
        if let Some(canonical) = profile.canonical_id.clone() {
            row.preset = Some(canonical);
        }
        crate::stack::rf_profiles::force_apply_profile_defaults_to_row(&mut row);
        *block = interface_row_to_block(&row);
        changed_names.push(row.name);
    }
    if !changed_names.is_empty() {
        write_config(config_dir, &serialize_config(&parsed))?;
    }
    Ok(changed_names)
}

pub fn interface_id_from_name(name: &str) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    slug.trim_matches('-').to_string()
}

fn config_type_to_ui(raw: &str) -> Option<&'static str> {
    match raw {
        "AutoInterface" => Some("auto"),
        "TCPClientInterface" => Some("tcp"),
        "RNodeInterface" => Some("rnode"),
        "UDPInterface" => Some("udp"),
        "KISSInterface" => Some("kiss"),
        "PipeInterface" => Some("pipe"),
        "I2PInterface" => Some("i2p"),
        "RNodeMultiInterface" => Some("rnode_multi"),
        "BlePeerInterface" => Some("ble_peer"),
        _ => None,
    }
}

fn ui_type_to_config(ui: &str) -> String {
    match ui {
        "auto" => "AutoInterface".into(),
        "tcp" => "TCPClientInterface".into(),
        "rnode" => "RNodeInterface".into(),
        "udp" => "UDPInterface".into(),
        "kiss" => "KISSInterface".into(),
        "pipe" => "PipeInterface".into(),
        "i2p" => "I2PInterface".into(),
        "rnode_multi" => "RNodeMultiInterface".into(),
        "ble_peer" => "BlePeerInterface".into(),
        other => other.to_string(),
    }
}

fn bool_to_ini(v: bool) -> String {
    if v { "Yes".into() } else { "No".into() }
}

impl IniBlock {
    fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            values: HashMap::new(),
            order: Vec::new(),
        }
    }

    fn get(&self, key: &str) -> Option<&str> {
        self.values.get(key).map(String::as_str)
    }

    fn get_bool(&self, key: &str) -> Option<bool> {
        self.get(key).and_then(parse_bool)
    }

    fn set(&mut self, key: &str, value: &str) {
        if !self.values.contains_key(key) {
            self.order.push(key.to_string());
        }
        self.values.insert(key.to_string(), value.to_string());
    }
}

fn parse_bool(raw: &str) -> Option<bool> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "yes" | "true" | "on" | "1" => Some(true),
        "no" | "false" | "off" | "0" => Some(false),
        _ => None,
    }
}

fn parse_config(input: &str) -> Result<ParsedConfig, String> {
    let mut reticulum = IniBlock::new("reticulum");
    let mut logging = IniBlock::new("logging");
    let mut interfaces: Vec<IniBlock> = Vec::new();
    let mut extra_sections: Vec<String> = Vec::new();

    let mut current_top: Option<String> = None;
    let mut current_iface: Option<usize> = None;

    for (line_num, raw_line) in input.lines().enumerate() {
        let line = strip_comment(raw_line).trim();
        if line.is_empty() {
            continue;
        }

        if line.starts_with('[') && line.ends_with(']') {
            let open = line.chars().take_while(|&c| c == '[').count();
            let close = line.chars().rev().take_while(|&c| c == ']').count();
            if open != close {
                return Err(format!("line {}: mismatched brackets", line_num + 1));
            }
            let name = line[open..line.len() - close].trim();
            if name.is_empty() {
                return Err(format!("line {}: empty section name", line_num + 1));
            }

            if open == 1 {
                current_iface = None;
                current_top = Some(name.to_string());
                if name != "reticulum" && name != "logging" && name != "interfaces" {
                    extra_sections.push(format!("[{name}]"));
                }
            } else if open == 2 {
                if current_top.as_deref() != Some("interfaces") {
                    return Err(format!(
                        "line {}: interface subsection outside [interfaces]",
                        line_num + 1
                    ));
                }
                interfaces.push(IniBlock::new(name.to_string()));
                current_iface = Some(interfaces.len() - 1);
            } else {
                return Err(format!(
                    "line {}: nesting depth > 2 not supported",
                    line_num + 1
                ));
            }
            continue;
        }

        let Some(eq) = line.find('=') else {
            return Err(format!("line {}: unrecognized line", line_num + 1));
        };
        let key = line[..eq].trim();
        let value = line[eq + 1..].trim().trim_matches('"').to_string();
        if key.is_empty() {
            return Err(format!("line {}: empty key", line_num + 1));
        }

        match current_top.as_deref() {
            Some("reticulum") => reticulum.set(key, &value),
            Some("logging") => logging.set(key, &value),
            Some("interfaces") => {
                if let Some(idx) = current_iface {
                    interfaces[idx].set(key, &value);
                }
            }
            Some(other) => {
                extra_sections.push(format!("{key} = {value}  # section={other}"));
            }
            None => extra_sections.push(format!("{key} = {value}")),
        }
    }

    Ok(ParsedConfig {
        reticulum,
        logging,
        interfaces,
        extra_sections,
    })
}

fn strip_comment(line: &str) -> &str {
    let mut in_quote = false;
    for (i, ch) in line.char_indices() {
        match ch {
            '"' => in_quote = !in_quote,
            '#' if !in_quote => return &line[..i],
            _ => {}
        }
    }
    line
}

fn serialize_config(parsed: &ParsedConfig) -> String {
    let mut out = String::new();
    out.push_str("# mesh-client-reticulum sidecar config\n\n");
    write_block_section(&mut out, "reticulum", &parsed.reticulum);
    out.push('\n');
    write_block_section(&mut out, "logging", &parsed.logging);
    out.push_str("\n[interfaces]\n\n");
    for iface in &parsed.interfaces {
        out.push_str(&format!("[[{}]]\n", iface.name));
        for key in &iface.order {
            if let Some(value) = iface.values.get(key) {
                out.push_str(&format!("{key} = {value}\n"));
            }
        }
        out.push('\n');
    }
    for line in &parsed.extra_sections {
        out.push_str(line);
        out.push('\n');
    }
    out
}

fn write_block_section(out: &mut String, section: &str, block: &IniBlock) {
    out.push_str(&format!("[{section}]\n"));
    for key in &block.order {
        if let Some(value) = block.values.get(key) {
            out.push_str(&format!("{key} = {value}\n"));
        }
    }
}

fn default_config_content() -> String {
    serialize_config(&ParsedConfig {
        reticulum: {
            let mut b = IniBlock::new("reticulum");
            b.set("enable_transport", "No");
            b.set("share_instance", "Yes");
            b.set("instance_name", "default");
            b
        },
        logging: {
            let mut b = IniBlock::new("logging");
            b.set("loglevel", "4");
            b
        },
        interfaces: Vec::new(),
        extra_sections: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"[reticulum]
enable_transport = No
share_instance = Yes

[logging]
loglevel = 4

[interfaces]

[[Auto Peer]]
type = AutoInterface
enabled = Yes

[[TCP Upstream]]
type = TCPClientInterface
interface_enabled = true
target_host = 127.0.0.1
target_port = 4242

[[LoRa Node]]
type = RNodeInterface
enabled = No
port = /dev/ttyUSB0
frequency = 915000000
bandwidth = 125000
txpower = 7
spreadingfactor = 8
codingrate = 5
"#;

    #[test]
    fn parses_auto_tcp_rnode_with_enabled_variants() {
        let parsed = parse_config(SAMPLE).unwrap();
        let rows = interfaces_from_parsed(&parsed);
        assert_eq!(rows.len(), 3);

        let auto = rows.iter().find(|r| r.iface_type == "auto").unwrap();
        assert!(auto.enabled);
        assert_eq!(auto.name, "Auto Peer");

        let tcp = rows.iter().find(|r| r.iface_type == "tcp").unwrap();
        assert!(tcp.enabled);
        assert_eq!(tcp.host.as_deref(), Some("127.0.0.1"));
        assert_eq!(tcp.port, Some(4242));

        let rnode = rows.iter().find(|r| r.iface_type == "rnode").unwrap();
        assert!(!rnode.enabled);
        assert_eq!(rnode.serial_port.as_deref(), Some("/dev/ttyUSB0"));
        assert_eq!(rnode.frequency, Some(915_000_000));
        assert_eq!(rnode.spreading_factor, Some(8));
    }

    #[test]
    fn round_trip_preserves_interfaces() {
        let parsed = parse_config(SAMPLE).unwrap();
        let serialized = serialize_config(&parsed);
        let reparsed = parse_config(&serialized).unwrap();
        let rows = interfaces_from_parsed(&reparsed);
        assert_eq!(rows.len(), 3);
    }

    #[test]
    fn kiss_and_rnode_multi_serial_port_round_trip() {
        let content = r#"
[interfaces]
[[KISS Radio]]
type = KISSInterface
enabled = Yes
port = /dev/ttyUSB1

[[Multi RNode]]
type = RNodeMultiInterface
enabled = Yes
port = /dev/ttyACM0
"#;
        let parsed = parse_config(content).unwrap();
        let rows = interfaces_from_parsed(&parsed);
        let kiss = rows.iter().find(|r| r.iface_type == "kiss").unwrap();
        assert_eq!(kiss.serial_port.as_deref(), Some("/dev/ttyUSB1"));
        let multi = rows.iter().find(|r| r.iface_type == "rnode_multi").unwrap();
        assert_eq!(multi.serial_port.as_deref(), Some("/dev/ttyACM0"));

        let kiss_block = interface_row_to_block(kiss);
        assert_eq!(kiss_block.get("port"), Some("/dev/ttyUSB1"));
        let multi_block = interface_row_to_block(multi);
        assert_eq!(multi_block.get("port"), Some("/dev/ttyACM0"));
    }

    #[test]
    fn i2p_peers_round_trip() {
        let peer = "g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p";
        let content = format!(
            r#"
[interfaces]
[[RNS Testnet I2P Hub A]]
type = I2PInterface
enabled = No
peers = {peer}
"#
        );
        let parsed = parse_config(&content).unwrap();
        let rows = interfaces_from_parsed(&parsed);
        let i2p = rows.iter().find(|r| r.iface_type == "i2p").unwrap();
        assert!(!i2p.enabled);
        assert_eq!(i2p.host.as_deref(), Some(peer));
        let block = interface_row_to_block(i2p);
        assert_eq!(block.get("peers"), Some(peer));
    }

    #[test]
    fn i2p_multi_peer_round_trip() {
        let peer_a = "g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p";
        let peer_b = "abc123def456.b32.i2p";
        let peers = format!("{peer_a}, {peer_b}");
        let content = format!(
            r#"
[interfaces]
[[RNS Testnet I2P Hub Multi]]
type = I2PInterface
enabled = No
peers = {peers}
"#
        );
        let parsed = parse_config(&content).unwrap();
        let rows = interfaces_from_parsed(&parsed);
        let i2p = rows.iter().find(|r| r.iface_type == "i2p").unwrap();
        assert_eq!(i2p.host.as_deref(), Some(peers.as_str()));
        let block = interface_row_to_block(i2p);
        assert_eq!(block.get("peers"), Some(peers.as_str()));
    }

    #[test]
    fn rnode_tcp_serial_port_round_trip() {
        let content = r#"
[interfaces]
[[WiFi RNode]]
type = RNodeInterface
enabled = Yes
port = tcp://192.168.1.10:7633
frequency = 915000000
bandwidth = 125000
spreadingfactor = 8
codingrate = 5
txpower = 17
"#;
        let parsed = parse_config(content).unwrap();
        let rows = interfaces_from_parsed(&parsed);
        let rnode = rows.iter().find(|r| r.iface_type == "rnode").unwrap();
        assert_eq!(rnode.serial_port.as_deref(), Some("tcp://192.168.1.10:7633"));

        let block = interface_row_to_block(rnode);
        assert_eq!(block.get("port"), Some("tcp://192.168.1.10:7633"));
        let serialized = serialize_config(&parsed);
        assert!(serialized.contains("port = tcp://192.168.1.10:7633"));
    }

    #[test]
    fn ble_peer_seed_addresses_round_trip() {
        let content = r#"
[interfaces]
[[BLE Peer]]
type = BlePeerInterface
enabled = Yes
seed_addresses = AA:BB:CC:DD:EE:FF,RNode 1234
"#;
        let parsed = parse_config(content).unwrap();
        let rows = interfaces_from_parsed(&parsed);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].iface_type, "ble_peer");
        assert_eq!(
            rows[0].seed_addresses,
            vec!["AA:BB:CC:DD:EE:FF".to_string(), "RNode 1234".to_string()]
        );
        let serialized = serialize_config(&parsed);
        assert!(serialized.contains("seed_addresses = AA:BB:CC:DD:EE:FF,RNode 1234"));
    }

    #[test]
    fn extra_sections_round_trip() {
        let content = r#"[reticulum]
share_instance = Yes

[logging]
loglevel = 4

[interfaces]

[[Auto Peer]]
type = AutoInterface
enabled = Yes

[future_section]
future_key = future_value
"#;
        let parsed = parse_config(content).unwrap();
        assert!(!parsed.extra_sections.is_empty());
        let serialized = serialize_config(&parsed);
        assert!(serialized.contains("[future_section]"));
        assert!(serialized.contains("future_key = future_value"));
        let reparsed = parse_config(&serialized).unwrap();
        assert_eq!(parsed.extra_sections, reparsed.extra_sections);
    }

    #[test]
    fn write_config_rejects_invalid_content() {
        let dir = std::env::temp_dir().join(format!("mesh_reticulum_cfg_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let err = write_config(&dir, "not valid ini [[[").unwrap_err();
        assert!(!err.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stack_settings_from_sample() {
        let parsed = parse_config(SAMPLE).unwrap();
        let settings = stack_settings_from_parsed(&parsed);
        assert!(!settings.enable_transport);
        assert!(settings.share_instance);
        assert_eq!(settings.loglevel, 4);
    }

    #[test]
    fn import_merge_adds_interface() {
        let dir = std::env::temp_dir().join(format!("mesh_reticulum_cfg_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        write_config(&dir, SAMPLE).unwrap();

        let extra = r#"
[interfaces]
[[New TCP]]
type = TCPClientInterface
enabled = Yes
target_host = 10.0.0.1
target_port = 5000
"#;
        import_config(&dir, extra, ImportMode::Merge).unwrap();
        let rows = interfaces_from_config_dir(&dir).unwrap();
        assert_eq!(rows.len(), 4);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn repair_rnode_preset_writes_missing_radio_fields() {
        let dir = std::env::temp_dir().join(format!("mesh_reticulum_cfg_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let content = r#"
[reticulum]
share_instance = Yes

[logging]
loglevel = 4

[interfaces]
[[BLE RNode]]
type = RNodeInterface
enabled = Yes
port = ble://a399d3be-fa79-45ab-a394-7d9299682617
preset = rnode_us915
"#;
        write_config(&dir, content).unwrap();
        assert!(repair_rnode_radio_fields_in_config(&dir).unwrap());

        let repaired = read_config(&dir).unwrap();
        assert!(repaired.contains("frequency = 914875000"));
        assert!(repaired.contains("bandwidth = 125000"));
        assert!(repaired.contains("spreadingfactor = 8"));
        assert!(repaired.contains("codingrate = 5"));
        assert!(repaired.contains("txpower = 17"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn repair_rnode_adds_txpower_when_only_frequency_present() {
        let dir = std::env::temp_dir().join(format!("mesh_reticulum_cfg_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let content = r#"
[reticulum]
share_instance = Yes

[logging]
loglevel = 4

[interfaces]
[[BLE RNode]]
type = RNodeInterface
enabled = Yes
port = ble://a399d3be-fa79-45ab-a394-7d9299682617
preset = rnode_us915
frequency = 915000000
bandwidth = 125000
spreadingfactor = 8
codingrate = 5
"#;
        write_config(&dir, content).unwrap();
        assert!(repair_rnode_radio_fields_in_config(&dir).unwrap());

        let repaired = read_config(&dir).unwrap();
        assert!(repaired.contains("txpower = 17"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn update_interface_applies_preset_defaults() {
        let dir = std::env::temp_dir().join(format!("mesh_reticulum_cfg_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let content = r#"
[reticulum]
share_instance = Yes

[logging]
loglevel = 4

[interfaces]
[[BLE RNode]]
type = RNodeInterface
enabled = Yes
port = ble://a399d3be-fa79-45ab-a394-7d9299682617
"#;
        write_config(&dir, content).unwrap();

        let row = update_interface_in_config(
            &dir,
            "ble-rnode",
            &UpdateInterfacePatch {
                preset: Some("rnode_us915".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(row.frequency, Some(914_875_000));
        assert_eq!(row.txpower, Some(17));

        let updated = read_config(&dir).unwrap();
        assert!(updated.contains("frequency = 914875000"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn apply_preset_repair_overwrites_deviating_rnode_frequency() {
        let dir = std::env::temp_dir().join(format!("mesh_reticulum_cfg_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let content = r#"
[reticulum]
share_instance = Yes

[logging]
loglevel = 4

[interfaces]
[[NV0N2]]
type = RNodeInterface
enabled = Yes
port = /dev/cu.usbserial-test
preset = rnode_us915
frequency = 915000000
bandwidth = 125000
spreadingfactor = 8
codingrate = 5
"#;
        write_config(&dir, content).unwrap();
        let repaired = apply_preset_defaults_to_config_rnodes(&dir).unwrap();
        assert_eq!(repaired, vec!["NV0N2"]);

        let updated = read_config(&dir).unwrap();
        assert!(updated.contains("frequency = 914875000"));
        assert!(updated.contains("preset = rnode_us"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn update_interface_keeps_custom_frequency_when_preset_unchanged() {
        let dir = std::env::temp_dir().join(format!("mesh_reticulum_cfg_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let content = r#"
[reticulum]
share_instance = Yes

[logging]
loglevel = 4

[interfaces]
[[NV0N2]]
type = RNodeInterface
enabled = Yes
port = /dev/cu.usbserial-test
preset = rnode_us
frequency = 914875000
bandwidth = 125000
spreadingfactor = 8
codingrate = 5
txpower = 17
"#;
        write_config(&dir, content).unwrap();

        let row = update_interface_in_config(
            &dir,
            "nv0n2",
            &UpdateInterfacePatch {
                preset: Some("rnode_us".into()),
                frequency: Some(915_000_000),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(row.frequency, Some(915_000_000));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn add_interface_respects_enabled_false() {
        let dir = std::env::temp_dir().join(format!("mesh_reticulum_cfg_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        write_config(
            &dir,
            r#"[reticulum]
share_instance = Yes

[logging]
loglevel = 4

[interfaces]
"#,
        )
        .unwrap();

        let row = add_interface_to_config(
            &dir,
            &AddInterfaceRequest {
                iface_type: "tcp".into(),
                name: Some("RNS Testnet".into()),
                enabled: Some(false),
                host: Some("reticulum.betweentheborders.com".into()),
                port: Some(4242),
                ..Default::default()
            },
        )
        .unwrap();

        assert!(!row.enabled);
        let content = read_config(&dir).unwrap();
        assert!(content.contains("interface_enabled = No"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn add_i2p_interface_accepts_official_testnet_b32_peer() {
        let dir = std::env::temp_dir().join(format!(
            "mesh-client-reticulum-i2p-add-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        write_config(
            &dir,
            r#"
[reticulum]
enable_transport = Yes
share_instance = Yes

[logging]
loglevel = 4

[interfaces]
"#,
        )
        .unwrap();

        let peer = "g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p";
        let row = add_interface_to_config(
            &dir,
            &AddInterfaceRequest {
                iface_type: "i2p".into(),
                name: Some("RNS Testnet I2P Hub A".into()),
                enabled: Some(false),
                host: Some(peer.into()),
                ..Default::default()
            },
        )
        .unwrap();

        assert_eq!(row.iface_type, "i2p");
        assert_eq!(row.host.as_deref(), Some(peer));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn discovery_fields_round_trip_rnode_and_i2p() {
        let content = r#"
[interfaces]
[[LoRa Node]]
type = RNodeInterface
enabled = Yes
port = /dev/ttyUSB0
discoverable = Yes
latitude = 39.7392
longitude = -104.9903
height = 1600
discovery_name = My Node
announce_interval = 120
reachable_on = mesh.example.com

[[I2P Node]]
type = I2PInterface
enabled = Yes
peers = g3br23bvx3lq5uddcsjii74xgmn6y5q325ovrkq2zw2wbzbqgbuq.b32.i2p
connectable = Yes
discoverable = Yes
latitude = 48.8566
longitude = 2.3522
"#;
        let parsed = parse_config(content).unwrap();
        let rows = interfaces_from_parsed(&parsed);
        let rnode = rows.iter().find(|r| r.iface_type == "rnode").unwrap();
        assert_eq!(rnode.discoverable, Some(true));
        assert_eq!(rnode.latitude, Some(39.7392));
        assert_eq!(rnode.longitude, Some(-104.9903));
        assert_eq!(rnode.height, Some(1600));
        assert_eq!(rnode.discovery_name.as_deref(), Some("My Node"));
        assert_eq!(rnode.announce_interval_min, Some(120));
        assert_eq!(rnode.reachable_on.as_deref(), Some("mesh.example.com"));

        let i2p = rows.iter().find(|r| r.iface_type == "i2p").unwrap();
        assert_eq!(i2p.connectable, Some(true));
        assert_eq!(i2p.discoverable, Some(true));

        let serialized = serialize_config(&parsed);
        let reparsed = parse_config(&serialized).unwrap();
        let rows2 = interfaces_from_parsed(&reparsed);
        assert_eq!(rows2.len(), 2);
        let rnode2 = rows2.iter().find(|r| r.iface_type == "rnode").unwrap();
        assert_eq!(rnode2.discoverable, Some(true));
        assert_eq!(rnode2.announce_interval_min, Some(120));
    }

    #[test]
    fn update_interface_preserves_discovery_when_patch_enabled_only() {
        let dir = std::env::temp_dir().join(format!("mesh_reticulum_cfg_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        write_config(
            &dir,
            r#"
[interfaces]
[[LoRa Node]]
type = RNodeInterface
enabled = Yes
port = /dev/ttyUSB0
discoverable = Yes
latitude = 40.0
longitude = -105.0
"#,
        )
        .unwrap();

        let row = update_interface_in_config(
            &dir,
            "lo-ra-node",
            &UpdateInterfacePatch {
                enabled: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(row.discoverable, Some(true));
        assert_eq!(row.latitude, Some(40.0));

        let content = read_config(&dir).unwrap();
        assert!(content.contains("discoverable = Yes"));
        assert!(content.contains("latitude = 40"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_reachable_on_rejects_newlines() {
        assert!(validate_reachable_on("host.example.com").is_ok());
        assert!(validate_reachable_on("/usr/local/bin/my-ip.sh").is_ok());
        assert!(validate_reachable_on("bad\nhost").is_err());
    }

    #[test]
    fn validate_lat_lon_rejects_out_of_range() {
        assert!(validate_lat_lon(40.0, -105.0).is_ok());
        assert!(validate_lat_lon(91.0, 0.0).is_err());
        assert!(validate_lat_lon(0.0, 181.0).is_err());
    }
}

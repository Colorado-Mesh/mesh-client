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
    fs::create_dir_all(config_dir).map_err(|e| e.to_string())?;
    fs::write(config_path(config_dir), content).map_err(|e| e.to_string())
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
    })
}

fn interface_row_to_block(row: &InterfaceRow) -> IniBlock {
    let mut block = IniBlock {
        name: row.name.clone(),
        values: HashMap::new(),
        order: Vec::new(),
    };
    block.set("type", &ui_type_to_config(&row.iface_type));
    block.set("enabled", &bool_to_ini(row.enabled));

    if row.iface_type == "tcp" {
        if let Some(host) = &row.host {
            block.set("target_host", host);
        }
        if let Some(port) = row.port {
            block.set("target_port", &port.to_string());
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

    block
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

pub fn add_interface_to_config(
    config_dir: &Path,
    req: &AddInterfaceRequest,
) -> Result<InterfaceRow, String> {
    let id = Uuid::new_v4().to_string();
    let name = req
        .name
        .clone()
        .unwrap_or_else(|| format!("{}-{}", req.iface_type, &id[..8]));

    let mut row = InterfaceRow {
        id: interface_id_from_name(&name),
        name,
        iface_type: req.iface_type.clone(),
        enabled: true,
        status: "pending".into(),
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
}

fn apply_preset_defaults(row: &mut InterfaceRow) {
    if row.iface_type != "rnode" {
        return;
    }
    let preset = row.preset.as_deref().unwrap_or("");
    match preset {
        "rnode_eu868" => {
            row.frequency.get_or_insert(868_000_000);
            row.bandwidth.get_or_insert(125_000);
            row.spreading_factor.get_or_insert(8);
            row.coding_rate.get_or_insert(5);
        }
        "rnode_us915" | "rnode_generic" => {
            row.frequency.get_or_insert(915_000_000);
            row.bandwidth.get_or_insert(125_000);
            row.spreading_factor.get_or_insert(8);
            row.coding_rate.get_or_insert(5);
        }
        _ => {}
    }
}

fn interface_id_from_name(name: &str) -> String {
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
}

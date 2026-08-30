use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::path_medium::PathMediumSetting;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StackIdentity {
    pub configured: bool,
    pub identity_hash: String,
    pub lxmf_hash: String,
    pub display_name: Option<String>,
    pub mnemonic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterfaceRow {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub iface_type: String,
    pub enabled: bool,
    pub status: String,
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
    /// Effective RNS interface mode from live `GetInterfaceStats` (Debug name
    /// mapped to canonical rnsd values). None when offline / unknown. Config
    /// `mode` remains the user-configured value; the UI compares the two.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_mode: Option<String>,
    #[serde(default)]
    pub seed_addresses: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discoverable: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latitude: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub longitude: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub discovery_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub announce_interval_min: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connectable: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reachable_on: Option<String>,
    /// IFAC virtual network name (common interface option).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub network_name: Option<String>,
    /// IFAC authentication passphrase (common interface option).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passphrase: Option<String>,
    /// RNode/KISS TX ready-gate (`CMD_READY`). Defaults on for RF interfaces so
    /// bursts do not overflow the bounded TX queue. Only meaningful for RF types.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flow_control: Option<bool>,
    /// Upstream RNS opt-out: keep configured mode when `discoverable` would
    /// otherwise auto-correct to Access Point / Gateway. Derived by mesh-client
    /// when publish is on and mode is not AP/Gateway.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ignore_config_warnings: Option<bool>,
    /// Host outbound TX mpsc fill from live `GetInterfaceStats` (None when offline / unknown).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tx_queue_used: Option<u64>,
    /// Host outbound TX mpsc capacity from live stats.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tx_queue_max: Option<u64>,
    /// Unknown INI keys preserved across CRUD so typed writes do not drop them.
    #[serde(default)]
    pub extra_config: HashMap<String, String>,
}

/// Discovery-related defaults for `InterfaceRow` struct literals outside config parse.
#[allow(dead_code, clippy::type_complexity)]
pub fn interface_discovery_defaults() -> (
    Option<bool>,
    Option<f64>,
    Option<f64>,
    Option<u32>,
    Option<String>,
    Option<u32>,
    Option<bool>,
    Option<String>,
) {
    (None, None, None, None, None, None, None, None)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactRow {
    pub destination_hash: String,
    pub display_name: Option<String>,
    pub last_heard: Option<u64>,
    pub favorited: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerRow {
    pub destination_hash: String,
    pub display_name: Option<String>,
    pub hops: Option<u8>,
    pub last_seen: Option<u64>,
    pub interface: Option<String>,
    pub path_hash: Option<String>,
    #[serde(default)]
    pub via_hash: Option<String>,
    /// 64-byte X25519+Ed25519 public key as 128 hex chars when known from announces.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub public_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopologyEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropagationRow {
    pub id: String,
    pub name: String,
    pub hops: Option<u8>,
    pub enabled: bool,
    pub status: String,
    #[serde(default)]
    pub destination_hash: Option<String>,
    /// 64-byte X25519+Ed25519 public key as 128 hex chars (from PN announce).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub public_key: Option<String>,
    /// Identity hash recovered from the PN announce (32 hex chars).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_hash: Option<String>,
}

/// Heard `lxmf.propagation` announce (not auto-added to configured list).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredPropagationRow {
    pub destination_hash: String,
    #[serde(default)]
    pub identity_hash: Option<String>,
    /// 64-byte X25519+Ed25519 public key as 128 hex chars (from PN announce).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub public_key: Option<String>,
    pub display_name: Option<String>,
    pub hops: Option<u8>,
    pub last_seen: Option<u64>,
    /// Actively serving when true (from PN announce `node_state`).
    pub node_state: bool,
    pub peering_cost: u8,
    /// Medium the announce path was learned over, when a path is known.
    ///
    /// Auto ranking deprioritizes RF: a propagation node reachable only over LoRa
    /// cannot serve a 256 KB propagation limit at usable speed, so a hop-count-only
    /// ranking would pick it over a slightly more distant IP node and then time out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub medium: Option<PathMediumSetting>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NomadNodeRow {
    pub destination_hash: String,
    /// Identity hash recovered from the node's `nomadnetwork.node` announce
    /// (`AnnounceHandlerEvent::identity_hash`); required to rebuild the
    /// destination for page/file link queries via `LinkClient::query`.
    #[serde(default)]
    pub identity_hash: Option<String>,
    pub display_name: Option<String>,
    pub last_seen: Option<u64>,
    #[serde(default)]
    pub favorited: bool,
    pub hops: Option<u8>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NomadServeStatsRow {
    pub request_count: u64,
    pub page_hits: u64,
    pub file_hits: u64,
    pub not_found_count: u64,
    pub last_request_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NomadServingStatus {
    pub enabled: bool,
    pub running: bool,
    pub destination_hash: Option<String>,
    pub identity_hash: Option<String>,
    pub display_name: String,
    pub page_count: usize,
    pub file_count: usize,
    pub stats: NomadServeStatsRow,
    pub content_root: String,
    /// Absolute path the user chose as the watched content source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_source: Option<String>,
    /// `site_root` | `pages_dir`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_layout: Option<String>,
    /// `ok` | `degraded` | `unavailable` — watcher / content-source health.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub watcher_status: Option<String>,
    /// Stable error code when enabled but not running, or watcher degraded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RrcHubRow {
    pub destination_hash: String,
    #[serde(default)]
    pub identity_hash: Option<String>,
    pub display_name: Option<String>,
    /// recommended | welcome | manual | announce — higher wins when merging names.
    #[serde(default)]
    pub name_source: Option<String>,
    pub last_seen: Option<u64>,
    #[serde(default)]
    pub favorited: bool,
    pub hops: Option<u8>,
    pub status: Option<String>,
    /// recommended | discovered | manual
    #[serde(default = "default_rrc_source")]
    pub source: String,
    #[serde(default)]
    pub recommended: bool,
}

fn default_rrc_source() -> String {
    "discovered".into()
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct AddInterfaceRequest {
    #[serde(rename = "type")]
    pub iface_type: String,
    pub name: Option<String>,
    #[serde(default)]
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
    #[serde(default)]
    pub seed_addresses: Vec<String>,
    #[serde(default)]
    pub discoverable: Option<bool>,
    #[serde(default)]
    pub latitude: Option<f64>,
    #[serde(default)]
    pub longitude: Option<f64>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub discovery_name: Option<String>,
    #[serde(default)]
    pub announce_interval_min: Option<u32>,
    #[serde(default)]
    pub connectable: Option<bool>,
    #[serde(default)]
    pub reachable_on: Option<String>,
    #[serde(default)]
    pub network_name: Option<String>,
    #[serde(default)]
    pub passphrase: Option<String>,
    /// RNode/KISS TX ready-gate. When omitted, RF interfaces default to `true`.
    #[serde(default)]
    pub flow_control: Option<bool>,
    #[serde(default)]
    pub ignore_config_warnings: Option<bool>,
    #[serde(default)]
    pub extra_config: HashMap<String, String>,
}

/// Native LXMF `FIELD_AUDIO` payload for chat voice memos (Ratspeak parity).
#[derive(Debug, Clone, Deserialize)]
pub struct LxmfAudioRequest {
    /// LXMF audio mode (`AM_OPUS_OGG` = 0x10).
    pub mode: u8,
    pub data_base64: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LxmfSendRequest {
    pub destination_hash: String,
    pub text: String,
    #[serde(default)]
    pub reply_to_hash: Option<String>,
    #[serde(default)]
    pub reply_to_id: Option<String>,
    /// Optional UTF-8 quote snippet for LXMF `FIELD_REPLY_QUOTE` (0x31).
    #[serde(default)]
    pub reply_preview_text: Option<String>,
    /// Optional native LXMF audio field (Ogg/Opus voice memo).
    #[serde(default)]
    pub audio: Option<LxmfAudioRequest>,
}

/// Create an encrypted `lxm://` paper URI (no network send).
pub type LxmfPaperCreateRequest = LxmfSendRequest;

#[derive(Debug, Clone, Deserialize)]
pub struct LxmfPaperIngestRequest {
    pub uri: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LxmfReactionRequest {
    pub destination_hash: String,
    pub target_hash: String,
    pub emoji: String,
}

#[cfg(test)]
mod tx_queue_serde_tests {
    use super::InterfaceRow;
    use serde_json::Value;
    use std::collections::HashMap;

    fn minimal_row() -> InterfaceRow {
        InterfaceRow {
            id: "rnode-1".into(),
            name: "RNode USB".into(),
            iface_type: "rnode".into(),
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
            runtime_mode: None,
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
            ignore_config_warnings: None,
            tx_queue_used: None,
            tx_queue_max: None,
            extra_config: HashMap::default(),
        }
    }

    #[test]
    fn none_tx_queue_fields_omitted_from_serialization() {
        let row = minimal_row();
        let value = serde_json::to_value(&row).expect("serialize");
        let obj = value.as_object().expect("object");
        assert!(!obj.contains_key("tx_queue_used"));
        assert!(!obj.contains_key("tx_queue_max"));
        assert!(!obj.contains_key("runtime_mode"));
        assert!(!obj.contains_key("ignore_config_warnings"));
    }

    #[test]
    fn missing_payload_fields_deserialize_as_none() {
        let row = minimal_row();
        let value = serde_json::to_value(&row).expect("serialize");
        let obj = value.as_object().expect("object");
        assert!(!obj.contains_key("tx_queue_used"));
        assert!(!obj.contains_key("tx_queue_max"));
        let roundtrip: InterfaceRow = serde_json::from_value(value).expect("deserialize");
        assert_eq!(roundtrip.tx_queue_used, None);
        assert_eq!(roundtrip.tx_queue_max, None);
        assert_eq!(roundtrip.runtime_mode, None);
        assert_eq!(roundtrip.ignore_config_warnings, None);
    }

    #[test]
    fn online_live_stats_preserve_both_values() {
        let mut row = minimal_row();
        row.tx_queue_used = Some(64);
        row.tx_queue_max = Some(256);
        let value = serde_json::to_value(&row).expect("serialize");
        assert_eq!(value.get("tx_queue_used"), Some(&Value::from(64)));
        assert_eq!(value.get("tx_queue_max"), Some(&Value::from(256)));
        let roundtrip: InterfaceRow = serde_json::from_value(value).expect("deserialize");
        assert_eq!(roundtrip.tx_queue_used, Some(64));
        assert_eq!(roundtrip.tx_queue_max, Some(256));
    }

    #[test]
    fn runtime_mode_and_ignore_warnings_round_trip() {
        let mut row = minimal_row();
        row.runtime_mode = Some("access_point".into());
        row.ignore_config_warnings = Some(true);
        let value = serde_json::to_value(&row).expect("serialize");
        assert_eq!(
            value.get("runtime_mode"),
            Some(&Value::from("access_point"))
        );
        assert_eq!(
            value.get("ignore_config_warnings"),
            Some(&Value::Bool(true))
        );
        let roundtrip: InterfaceRow = serde_json::from_value(value).expect("deserialize");
        assert_eq!(roundtrip.runtime_mode.as_deref(), Some("access_point"));
        assert_eq!(roundtrip.ignore_config_warnings, Some(true));
    }

    #[test]
    fn offline_live_statistics_yield_none() {
        let mut row = minimal_row();
        row.status = "down".into();
        row.tx_queue_used = None;
        row.tx_queue_max = None;
        let value = serde_json::to_value(&row).expect("serialize");
        let obj = value.as_object().expect("object");
        assert!(!obj.contains_key("tx_queue_used"));
        assert!(!obj.contains_key("tx_queue_max"));
    }
}

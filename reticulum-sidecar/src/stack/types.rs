use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StackIdentity {
    pub configured: bool,
    pub identity_hash: String,
    pub lxmf_hash: String,
    pub display_name: Option<String>,
    pub mnemonic: Option<String>,
}

impl Default for StackIdentity {
    fn default() -> Self {
        Self {
            configured: false,
            identity_hash: String::new(),
            lxmf_hash: String::new(),
            display_name: None,
            mnemonic: None,
        }
    }
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
}

/// Discovery-related defaults for `InterfaceRow` struct literals outside config parse.
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

#[derive(Debug, Clone, Deserialize)]
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
}

impl Default for AddInterfaceRequest {
    fn default() -> Self {
        Self {
            iface_type: String::new(),
            name: None,
            enabled: None,
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
        }
    }
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
}

#[derive(Debug, Clone, Deserialize)]
pub struct LxmfReactionRequest {
    pub destination_hash: String,
    pub target_hash: String,
    pub emoji: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LxmfResourceRequest {
    pub destination_hash: String,
    pub file_name: String,
    pub mime_type: String,
    pub data_base64: String,
    #[serde(default)]
    pub reply_to_hash: Option<String>,
    /// Optional UTF-8 quote snippet for LXMF `FIELD_REPLY_QUOTE` (0x31).
    #[serde(default)]
    pub reply_preview_text: Option<String>,
}

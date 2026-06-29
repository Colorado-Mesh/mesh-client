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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropagationRow {
    pub id: String,
    pub name: String,
    pub hops: Option<u8>,
    pub enabled: bool,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AddInterfaceRequest {
    #[serde(rename = "type")]
    pub iface_type: String,
    pub name: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub preset: Option<String>,
    pub serial_port: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LxmfSendRequest {
    pub destination_hash: String,
    pub text: String,
    pub reply_to_hash: Option<String>,
    pub reply_to_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LxmfReactionRequest {
    pub destination_hash: String,
    pub target_hash: String,
    pub emoji: String,
}

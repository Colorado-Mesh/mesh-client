use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use uuid::Uuid;

use serde::Deserialize;

use super::types::*;
use super::via::resolve_outbound_sent_via;

const STATE_FILE: &str = "mesh_client_stack.json";

pub struct PersistedState {
    pub identity: StackIdentity,
    pub interfaces: Vec<InterfaceRow>,
    pub contacts: Vec<ContactRow>,
    pub peers: Vec<PeerRow>,
    pub propagation: Vec<PropagationRow>,
    pub messages: Vec<serde_json::Value>,
    pub rns_ready: bool,
    pub lxmf_ready: bool,
    pub preferred_propagation_id: Option<String>,
    pub propagation_sync: serde_json::Value,
    pub auto_sync_interval_sec: u32,
    pub nomad_nodes: Vec<NomadNodeRow>,
}

impl PersistedState {
    pub fn load(config_dir: &Path, storage_dir: &Path) -> Self {
        let _ = fs::create_dir_all(config_dir);
        let _ = fs::create_dir_all(storage_dir);
        let path = storage_dir.join(STATE_FILE);
        if path.exists() {
            if let Ok(raw) = fs::read_to_string(&path) {
                if let Ok(state) = serde_json::from_str::<PersistedState>(&raw) {
                    return state;
                }
            }
        }
        Self::default_empty()
    }

    fn default_empty() -> Self {
        Self {
            identity: StackIdentity::default(),
            interfaces: Vec::new(),
            contacts: Vec::new(),
            peers: Vec::new(),
            propagation: Vec::new(),
            messages: Vec::new(),
            rns_ready: false,
            lxmf_ready: false,
            preferred_propagation_id: None,
            propagation_sync: serde_json::Value::Null,
            auto_sync_interval_sec: 0,
            nomad_nodes: Vec::new(),
        }
    }

    pub fn ensure_defaults(&mut self) {
        if self.propagation.is_empty() {
            self.propagation.push(PropagationRow {
                id: "local-prop".into(),
                name: "Local propagation (offline inbox)".to_string(),
                hops: Some(0),
                enabled: false,
                status: "unknown".into(),
                destination_hash: None,
            });
        }
        self.sync_local_propagation_hash();
    }

    pub fn sync_local_propagation_hash(&mut self) {
        if !self.identity.configured {
            return;
        }
        if let Some(node) = self.propagation.iter_mut().find(|p| p.id == "local-prop") {
            node.destination_hash = Some(self.identity.lxmf_hash.clone());
        }
    }

    pub fn add_propagation_node(
        &mut self,
        destination_hash: &str,
        name: Option<String>,
    ) -> Result<PropagationRow, String> {
        let hash = destination_hash.trim().to_lowercase();
        if hash.len() != 32 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("destination_hash must be 32 hex characters".into());
        }
        if self.propagation.iter().any(|p| {
            p.destination_hash
                .as_ref()
                .map(|d| d.to_lowercase() == hash)
                .unwrap_or(false)
        }) {
            return Err("propagation node already exists".into());
        }
        let id = format!("pn-{}", &hash[..8]);
        let row = PropagationRow {
            id,
            name: name.unwrap_or_else(|| format!("Propagation node {}", &hash[..8])),
            hops: None,
            enabled: true,
            status: "known".into(),
            destination_hash: Some(hash),
        };
        self.propagation.push(row.clone());
        Ok(row)
    }

    pub fn save(&self, _config_dir: &Path, storage_dir: &Path) -> Result<(), String> {
        let path = storage_dir.join(STATE_FILE);
        let raw = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        fs::write(path, raw).map_err(|e| e.to_string())
    }

    fn now_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }

    fn random_hash() -> String {
        format!("{:032x}", Uuid::new_v4().as_u128())
    }

    pub fn generate_identity(
        &mut self,
        display_name: Option<String>,
    ) -> Result<StackIdentity, String> {
        let identity_hash = Self::random_hash();
        let lxmf_hash = Self::random_hash();
        let mnemonic = generate_mnemonic_12();
        self.identity = StackIdentity {
            configured: true,
            identity_hash,
            lxmf_hash,
            display_name,
            mnemonic: Some(mnemonic),
        };
        self.rns_ready = true;
        self.lxmf_ready = true;
        self.sync_local_propagation_hash();
        Ok(self.identity.clone())
    }

    pub fn import_identity_mnemonic(
        &mut self,
        mnemonic: &str,
        display_name: Option<String>,
    ) -> Result<StackIdentity, String> {
        let words: Vec<&str> = mnemonic.split_whitespace().collect();
        if words.len() != 12 {
            return Err("mnemonic must be 12 words".into());
        }
        let identity_hash = format!("{:032x}", stable_hash(mnemonic));
        let lxmf_hash = format!("{:032x}", stable_hash(&format!("lxmf:{mnemonic}")));
        self.identity = StackIdentity {
            configured: true,
            identity_hash,
            lxmf_hash,
            display_name,
            mnemonic: Some(mnemonic.to_string()),
        };
        self.rns_ready = true;
        self.lxmf_ready = true;
        self.sync_local_propagation_hash();
        Ok(self.identity.clone())
    }

    pub fn export_identity_backup(&self, passphrase: &str) -> Result<serde_json::Value, String> {
        if !self.identity.configured {
            return Err("no identity configured".into());
        }
        let _ = passphrase;
        Ok(serde_json::json!({
            "format": "mesh-client.identity.v1",
            "identity_hash": self.identity.identity_hash,
            "lxmf_hash": self.identity.lxmf_hash,
            "display_name": self.identity.display_name,
            "exported_at": Self::now_secs()
        }))
    }

    pub fn import_identity_backup(
        &mut self,
        backup: serde_json::Value,
        passphrase: &str,
    ) -> Result<StackIdentity, String> {
        let _ = passphrase;
        let format = backup.get("format").and_then(|v| v.as_str()).unwrap_or("");
        if format != "mesh-client.identity.v1" && format != "ratspeak.identity.v2" {
            return Err("unsupported backup format".into());
        }
        let identity_hash = backup
            .get("identity_hash")
            .and_then(|v| v.as_str())
            .ok_or("missing identity_hash")?
            .to_string();
        let lxmf_hash = backup
            .get("lxmf_hash")
            .and_then(|v| v.as_str())
            .ok_or("missing lxmf_hash")?
            .to_string();
        let display_name = backup
            .get("display_name")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        self.identity = StackIdentity {
            configured: true,
            identity_hash,
            lxmf_hash,
            display_name,
            mnemonic: None,
        };
        self.rns_ready = true;
        self.lxmf_ready = true;
        self.sync_local_propagation_hash();
        Ok(self.identity.clone())
    }

    pub fn add_interface(&mut self, req: AddInterfaceRequest) -> Result<InterfaceRow, String> {
        if !self.identity.configured {
            return Err("identity not configured".into());
        }
        let id = Uuid::new_v4().to_string();
        let name = req
            .name
            .unwrap_or_else(|| format!("{}-{}", req.iface_type, &id[..8]));
        let row = InterfaceRow {
            id: id.clone(),
            name,
            iface_type: req.iface_type.clone(),
            enabled: true,
            status: "pending".into(),
            host: req.host,
            port: req.port,
            preset: req.preset,
            serial_port: req.serial_port,
            frequency: req.frequency,
            bandwidth: req.bandwidth,
            txpower: req.txpower,
            spreading_factor: req.spreading_factor,
            coding_rate: req.coding_rate,
            callsign: req.callsign,
            id_interval: req.id_interval,
            mode: req.mode,
        };
        self.interfaces.push(row.clone());
        self.rns_ready = true;
        Ok(row)
    }

    pub fn set_interface_enabled(&mut self, id: &str, enabled: bool) -> Result<(), String> {
        let iface = self
            .interfaces
            .iter_mut()
            .find(|i| i.id == id)
            .ok_or_else(|| format!("interface not found: {id}"))?;
        iface.enabled = enabled;
        iface.status = if enabled { "up" } else { "down" }.into();
        Ok(())
    }

    pub fn set_propagation_enabled(&mut self, id: &str, enabled: bool) -> Result<(), String> {
        let node = self
            .propagation
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| format!("propagation node not found: {id}"))?;
        node.enabled = enabled;
        node.status = if enabled { "active" } else { "idle" }.into();
        Ok(())
    }

    pub fn set_preferred_propagation(&mut self, id: &str) -> Result<(), String> {
        if !self.propagation.iter().any(|p| p.id == id) {
            return Err(format!("propagation node not found: {id}"));
        }
        self.preferred_propagation_id = Some(id.to_string());
        Ok(())
    }

    pub fn start_propagation_sync(&mut self, propagation_id: &str) -> Result<(), String> {
        if !self.propagation.iter().any(|p| p.id == propagation_id) {
            return Err(format!("propagation node not found: {propagation_id}"));
        }
        self.propagation_sync = serde_json::json!({
            "active": true,
            "progress": 0,
            "message": null,
            "propagation_id": propagation_id,
        });
        Ok(())
    }

    pub fn cancel_propagation_sync(&mut self) {
        self.propagation_sync = serde_json::json!({
            "active": false,
            "progress": 0,
            "message": null,
        });
    }

    pub fn upsert_nomad_node(
        &mut self,
        hash: &str,
        display_name: Option<String>,
        hops: Option<u8>,
    ) {
        let key = hash.to_lowercase();
        let now = Self::now_secs();
        if let Some(node) = self
            .nomad_nodes
            .iter_mut()
            .find(|n| n.destination_hash.to_lowercase() == key)
        {
            if display_name.is_some() {
                node.display_name = display_name;
            }
            if hops.is_some() {
                node.hops = hops;
            }
            node.last_seen = Some(now);
            node.status = Some("online".into());
            return;
        }
        self.nomad_nodes.push(NomadNodeRow {
            destination_hash: hash.to_string(),
            display_name,
            last_seen: Some(now),
            favorited: false,
            hops,
            status: Some("online".into()),
        });
    }

    pub fn set_nomad_favorite(&mut self, hash: &str, favorited: bool) {
        let key = hash.to_lowercase();
        if let Some(node) = self
            .nomad_nodes
            .iter_mut()
            .find(|n| n.destination_hash.to_lowercase() == key)
        {
            node.favorited = favorited;
            return;
        }
        self.nomad_nodes.push(NomadNodeRow {
            destination_hash: hash.to_string(),
            display_name: None,
            last_seen: Some(Self::now_secs()),
            favorited,
            hops: None,
            status: Some("unknown".into()),
        });
    }

    pub fn clear_peers(&mut self) {
        self.peers.clear();
    }

    pub fn upsert_contact(&mut self, hash: &str, name: Option<String>) {
        if let Some(c) = self
            .contacts
            .iter_mut()
            .find(|c| c.destination_hash == hash)
        {
            if name.is_some() {
                c.display_name = name;
            }
            c.last_heard = Some(Self::now_secs());
            return;
        }
        self.contacts.push(ContactRow {
            destination_hash: hash.to_string(),
            display_name: name,
            last_heard: Some(Self::now_secs()),
            favorited: false,
        });
    }

    pub fn send_lxmf_local(&mut self, req: &LxmfSendRequest) -> Result<serde_json::Value, String> {
        if !self.identity.configured {
            return Err("identity not configured".into());
        }
        let ts = Self::now_secs();
        self.upsert_contact(&req.destination_hash, None);
        let sent_via = resolve_outbound_sent_via(&self.interfaces);
        let mut payload = serde_json::json!({
            "sender_hash": self.identity.lxmf_hash,
            "sender_name": self.identity.display_name.clone().unwrap_or_else(|| "Self".into()),
            "text": req.text,
            "timestamp": ts * 1000,
            "to_hash": req.destination_hash,
            "reply_to_hash": req.reply_to_hash,
            "reply_to_id": req.reply_to_id,
            "direction": "outbound",
            "sent_via": sent_via,
            "received_via": sent_via
        });
        let hash_input = format!(
            "{}:{}:{}",
            payload["sender_hash"].as_str().unwrap_or_default(),
            payload["timestamp"].as_i64().unwrap_or(0),
            payload["text"].as_str().unwrap_or_default()
        );
        if let Some(obj) = payload.as_object_mut() {
            obj.insert(
                "message_hash".into(),
                serde_json::Value::String(format!("{:032x}", stable_hash(&hash_input))),
            );
        }
        self.messages.push(payload.clone());
        Ok(payload)
    }

    pub fn send_reaction(
        &mut self,
        req: &LxmfReactionRequest,
    ) -> Result<serde_json::Value, String> {
        let ts = Self::now_secs();
        Ok(serde_json::json!({
            "sender_hash": self.identity.lxmf_hash,
            "sender_name": self.identity.display_name.clone().unwrap_or_else(|| "Self".into()),
            "text": req.emoji,
            "timestamp": ts * 1000,
            "to_hash": req.destination_hash,
            "reaction_target": req.target_hash,
            "direction": "outbound"
        }))
    }

    pub fn factory_reset_state(&mut self) -> Result<(), String> {
        let interfaces = self.interfaces.clone();
        *self = Self::default_empty();
        self.interfaces = interfaces;
        self.ensure_defaults();
        Ok(())
    }

    pub fn send_resource_local(
        &mut self,
        req: &LxmfResourceRequest,
    ) -> Result<serde_json::Value, String> {
        if !self.identity.configured {
            return Err("identity not configured".into());
        }
        let ts = Self::now_secs();
        self.upsert_contact(&req.destination_hash, None);
        let text = format!("[file:{}:{}]", req.file_name, req.mime_type);
        let mut payload = serde_json::json!({
            "sender_hash": self.identity.lxmf_hash,
            "sender_name": self.identity.display_name.clone().unwrap_or_else(|| "Self".into()),
            "text": text,
            "timestamp": ts * 1000,
            "to_hash": req.destination_hash,
            "reply_to_hash": req.reply_to_hash,
            "direction": "outbound",
            "attachment": {
                "file_name": req.file_name,
                "mime_type": req.mime_type,
                "size_bytes": req.data_base64.len(),
            }
        });
        let hash_input = format!(
            "{}:{}:{}",
            payload["sender_hash"].as_str().unwrap_or_default(),
            payload["timestamp"].as_i64().unwrap_or(0),
            payload["text"].as_str().unwrap_or_default()
        );
        if let Some(obj) = payload.as_object_mut() {
            obj.insert(
                "message_hash".into(),
                serde_json::Value::String(format!("{:032x}", stable_hash(&hash_input))),
            );
        }
        self.messages.push(payload.clone());
        Ok(payload)
    }

    pub fn delete_message_by_hash(&mut self, message_hash: &str) -> Result<bool, String> {
        let before = self.messages.len();
        self.messages
            .retain(|m| m.get("message_hash").and_then(|v| v.as_str()) != Some(message_hash));
        Ok(self.messages.len() < before)
    }
}

pub(crate) fn stable_hash(s: &str) -> u128 {
    let mut h: u128 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u128;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn generate_mnemonic_12() -> String {
    const WORDS: &[&str] = &[
        "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india",
        "juliet", "kilo", "lima", "mike", "november", "oscar", "papa", "quebec", "romeo", "sierra",
        "tango", "uniform", "victor", "whiskey", "xray", "yankee", "zulu",
    ];
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut picked = Vec::new();
    for i in 0..12 {
        let mut hasher = DefaultHasher::new();
        seed.hash(&mut hasher);
        i.hash(&mut hasher);
        let idx = (hasher.finish() as usize) % WORDS.len();
        picked.push(WORDS[idx]);
    }
    picked.join(" ")
}

impl serde::Serialize for PersistedState {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("PersistedState", 12)?;
        s.serialize_field("identity", &self.identity)?;
        s.serialize_field("interfaces", &self.interfaces)?;
        s.serialize_field("contacts", &self.contacts)?;
        s.serialize_field("peers", &self.peers)?;
        s.serialize_field("propagation", &self.propagation)?;
        s.serialize_field("messages", &self.messages)?;
        s.serialize_field("rns_ready", &self.rns_ready)?;
        s.serialize_field("lxmf_ready", &self.lxmf_ready)?;
        s.serialize_field("preferred_propagation_id", &self.preferred_propagation_id)?;
        s.serialize_field("propagation_sync", &self.propagation_sync)?;
        s.serialize_field("auto_sync_interval_sec", &self.auto_sync_interval_sec)?;
        s.serialize_field("nomad_nodes", &self.nomad_nodes)?;
        s.end()
    }
}

impl<'de> serde::Deserialize<'de> for PersistedState {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct Raw {
            identity: StackIdentity,
            interfaces: Vec<InterfaceRow>,
            contacts: Vec<ContactRow>,
            peers: Vec<PeerRow>,
            propagation: Vec<PropagationRow>,
            messages: Vec<serde_json::Value>,
            rns_ready: bool,
            lxmf_ready: bool,
            #[serde(default)]
            preferred_propagation_id: Option<String>,
            #[serde(default)]
            propagation_sync: serde_json::Value,
            #[serde(default)]
            auto_sync_interval_sec: u32,
            #[serde(default)]
            nomad_nodes: Vec<NomadNodeRow>,
        }
        let raw = Raw::deserialize(deserializer)?;
        Ok(Self {
            identity: raw.identity,
            interfaces: raw.interfaces,
            contacts: raw.contacts,
            peers: raw.peers,
            propagation: raw.propagation,
            messages: raw.messages,
            rns_ready: raw.rns_ready,
            lxmf_ready: raw.lxmf_ready,
            preferred_propagation_id: raw.preferred_propagation_id,
            propagation_sync: if raw.propagation_sync.is_null() {
                serde_json::Value::Null
            } else {
                raw.propagation_sync
            },
            auto_sync_interval_sec: raw.auto_sync_interval_sec,
            nomad_nodes: raw.nomad_nodes,
        })
    }
}

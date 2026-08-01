use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use uuid::Uuid;

use serde::Deserialize;

use super::path_medium::{PathMediumPreferenceSetting, PathMediumSetting, PeerMediumPins};
use super::pn_hosting_policy::PnHostingPolicy;
use super::types::{
    AddInterfaceRequest, ContactRow, InterfaceRow, LxmfReactionRequest, LxmfSendRequest,
    NomadNodeRow, PeerRow, PropagationRow, RrcHubRow, StackIdentity,
};
use super::via::resolve_outbound_sent_via;

const STATE_FILE: &str = "mesh_client_stack.json";

#[allow(clippy::struct_excessive_bools)] // persisted flags mirror independent user prefs
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
    pub primary_local_serial_interface_id: Option<String>,
    pub propagation_sync: serde_json::Value,
    pub auto_sync_interval_sec: u32,
    /// LXMF local PN hosting / peering policy (defaults match rsLXMF / lxmd).
    pub pn_hosting_policy: PnHostingPolicy,
    pub nomad_nodes: Vec<NomadNodeRow>,
    pub rrc_hubs: Vec<RrcHubRow>,
    /// User preference: start Nomad page hosting when the live stack is up.
    pub nomad_serving_enabled: bool,
    /// Display name announced for the local Nomad node (falls back to identity name).
    pub nomad_serving_display_name: Option<String>,
    /// Absolute path to an external Nomad content folder (site root or pages dir).
    pub nomad_serving_content_source: Option<String>,
    /// User preference: restart the inbound rncp listener when the live stack is up.
    pub rncp_listener_enabled: bool,
    /// Inbound rncp save directory; `None` falls back to `<storage>/rncp_inbox`.
    pub rncp_listener_save_dir: Option<String>,
    pub rncp_listener_allow_fetch: bool,
    pub rncp_listener_fetch_jail: Option<String>,
    pub rncp_listener_overwrite: bool,
    /// Identity hashes for `allow_all_listed` policy; empty means `ask` mode.
    pub rncp_listener_allowed: Vec<String>,
    pub rncp_listener_blocked: Vec<String>,
    /// Global transport bias for the active path slot (rsReticulum `PathMediumPreference`).
    pub path_medium_preference: PathMediumPreferenceSetting,
    /// Per-destination medium pins that override the global preference.
    pub peer_medium_pins: PeerMediumPins,
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

    pub(crate) fn default_empty() -> Self {
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
            primary_local_serial_interface_id: None,
            propagation_sync: serde_json::Value::Null,
            auto_sync_interval_sec: 3600,
            pn_hosting_policy: PnHostingPolicy::default(),
            nomad_nodes: Vec::new(),
            rrc_hubs: Vec::new(),
            nomad_serving_enabled: false,
            nomad_serving_display_name: None,
            nomad_serving_content_source: None,
            rncp_listener_enabled: false,
            rncp_listener_save_dir: None,
            rncp_listener_allow_fetch: false,
            rncp_listener_fetch_jail: None,
            rncp_listener_overwrite: false,
            rncp_listener_allowed: Vec::new(),
            rncp_listener_blocked: Vec::new(),
            path_medium_preference: PathMediumPreferenceSetting::default(),
            peer_medium_pins: PeerMediumPins::default(),
        }
    }

    pub fn ensure_defaults(&mut self) {
        if self.propagation.is_empty() {
            self.propagation.push(PropagationRow {
                id: "local-prop".into(),
                name: "Local propagation node".to_string(),
                hops: Some(0),
                enabled: false,
                status: "unknown".into(),
                destination_hash: None,
                public_key: None,
                identity_hash: None,
            });
        }
        self.sync_local_propagation_hash();
        self.seed_rrc_default_hubs();
    }

    /// No-op: curated RRC hub catalog is empty (Favourites are user-starred only).
    #[allow(clippy::unused_self)] // method slot on PersistedState for future default seeding
    pub fn seed_rrc_default_hubs(&mut self) {
        let _ = super::rrc_defaults::RRC_DEFAULT_HUBS;
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
            public_key: None,
            identity_hash: None,
        };
        self.propagation.push(row.clone());
        Ok(row)
    }

    pub fn remove_propagation_node(&mut self, id: &str) -> Result<(), String> {
        if id == "local-prop" {
            return Err("cannot remove local propagation node".into());
        }
        if !id
            .strip_prefix("pn-")
            .is_some_and(|rest| rest.len() == 8 && rest.chars().all(|c| c.is_ascii_hexdigit()))
        {
            return Err(format!("invalid propagation node id: {id}"));
        }
        let idx = self
            .propagation
            .iter()
            .position(|p| p.id == id)
            .ok_or_else(|| format!("propagation node not found: {id}"))?;
        self.propagation.remove(idx);
        if self.preferred_propagation_id.as_deref() == Some(id) {
            self.preferred_propagation_id = None;
        }
        let syncing = self
            .propagation_sync
            .get("active")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
            && self
                .propagation_sync
                .get("propagation_id")
                .and_then(|v| v.as_str())
                == Some(id);
        if syncing {
            self.cancel_propagation_sync();
        }
        Ok(())
    }

    pub fn rename_propagation_node(&mut self, id: &str, name: &str) -> Result<(), String> {
        if id == "local-prop" {
            return Err("cannot rename local propagation node".into());
        }
        if !id
            .strip_prefix("pn-")
            .is_some_and(|rest| rest.len() == 8 && rest.chars().all(|c| c.is_ascii_hexdigit()))
        {
            return Err(format!("invalid propagation node id: {id}"));
        }
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("name must not be empty".into());
        }
        if trimmed.chars().any(char::is_control) {
            return Err("name must not contain control characters".into());
        }
        if trimmed.chars().count() > 128 {
            return Err("name too long (max 128)".into());
        }
        let node = self
            .propagation
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| format!("propagation node not found: {id}"))?;
        node.name = trimmed.to_string();
        Ok(())
    }

    pub fn save(&self, _config_dir: &Path, storage_dir: &Path) -> Result<(), String> {
        let path = storage_dir.join(STATE_FILE);
        let mut value = serde_json::to_value(self).map_err(|e| e.to_string())?;
        if let Some(identity) = value.get_mut("identity").and_then(|v| v.as_object_mut()) {
            identity.remove("mnemonic");
        }
        let raw = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
        fs::write(path, raw).map_err(|e| e.to_string())
    }

    fn now_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
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

    #[allow(clippy::needless_pass_by_value)] // backup JSON is consumed by format-specific import paths
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

    /// Stub-stack interface CRUD (live stack uses config file writes).
    #[allow(dead_code)]
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
            seed_addresses: req.seed_addresses,
            discoverable: req.discoverable,
            latitude: req.latitude,
            longitude: req.longitude,
            height: req.height,
            discovery_name: req.discovery_name,
            announce_interval_min: req.announce_interval_min,
            connectable: req.connectable,
            reachable_on: req.reachable_on,
            network_name: req.network_name,
            passphrase: req.passphrase,
            extra_config: req.extra_config,
        };
        self.interfaces.push(row.clone());
        self.rns_ready = true;
        Ok(row)
    }

    #[allow(dead_code)]
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

    pub fn set_auto_sync_interval_sec(&mut self, sec: u32) {
        self.auto_sync_interval_sec = sec;
    }

    pub fn set_pn_hosting_policy(&mut self, policy: PnHostingPolicy) -> Result<(), String> {
        let policy = policy.sanitized()?;
        self.pn_hosting_policy = policy;
        Ok(())
    }

    pub fn set_path_medium_preference(&mut self, preference: PathMediumPreferenceSetting) {
        self.path_medium_preference = preference;
    }

    /// Set (`Some`) or clear (`None`) a destination's medium pin; returns the canonical hash.
    pub fn set_peer_medium_pin(
        &mut self,
        hash: &str,
        pin: Option<PathMediumSetting>,
    ) -> Result<String, String> {
        self.peer_medium_pins.set(hash, pin)
    }

    pub fn upsert_nomad_node(
        &mut self,
        hash: &str,
        identity_hash: Option<String>,
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
            if identity_hash.is_some() {
                node.identity_hash = identity_hash;
            }
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
            identity_hash,
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
            identity_hash: None,
            display_name: None,
            last_seen: Some(Self::now_secs()),
            favorited,
            hops: None,
            status: Some("unknown".into()),
        });
    }

    pub fn upsert_rrc_hub(
        &mut self,
        hash: &str,
        identity_hash: Option<String>,
        display_name: Option<String>,
        hops: Option<u8>,
        source: &str,
    ) {
        self.upsert_rrc_hub_named(hash, identity_hash, display_name, hops, source, None);
    }

    /// `name_source`: recommended | welcome | manual | announce (defaults from `source`).
    pub fn upsert_rrc_hub_named(
        &mut self,
        hash: &str,
        identity_hash: Option<String>,
        display_name: Option<String>,
        hops: Option<u8>,
        source: &str,
        name_source: Option<&str>,
    ) {
        let key = hash.to_lowercase();
        let now = Self::now_secs();
        let recommended = super::rrc_defaults::RRC_DEFAULT_HUBS
            .iter()
            .any(|h| h.destination_hash.eq_ignore_ascii_case(&key));
        let incoming_name_source = name_source.unwrap_or(match source {
            "recommended" => "recommended",
            "manual" => "manual",
            "welcome" => "welcome",
            _ => "announce",
        });
        let name_pri = |s: &str| -> u8 {
            match s {
                "recommended" => 40,
                "welcome" => 30,
                "manual" => 20,
                _ => 10,
            }
        };
        if let Some(hub) = self
            .rrc_hubs
            .iter_mut()
            .find(|h| h.destination_hash.to_lowercase() == key)
        {
            if identity_hash.is_some() {
                hub.identity_hash = identity_hash;
            }
            if let Some(ref name) = display_name {
                let prev_src = hub.name_source.as_deref().unwrap_or(if hub.recommended {
                    "recommended"
                } else {
                    "announce"
                });
                let allow = name_pri(incoming_name_source) >= name_pri(prev_src)
                    || hub.display_name.is_none();
                // Never let announce clobber a curated recommended label.
                let block_announce_on_recommended =
                    hub.recommended && incoming_name_source == "announce";
                if allow && !block_announce_on_recommended {
                    hub.display_name = Some(name.clone());
                    hub.name_source = Some(incoming_name_source.into());
                }
            }
            if hops.is_some() {
                hub.hops = hops;
            }
            if source == "discovered" || (source == "manual" && hub.source != "recommended") {
                if hub.source == "recommended" && source == "discovered" {
                    hub.source = "discovered".into();
                } else if hub.source != "discovered" {
                    hub.source = source.into();
                }
            }
            hub.recommended = hub.recommended || recommended;
            hub.last_seen = Some(now);
            hub.status = Some("online".into());
            return;
        }
        self.rrc_hubs.push(RrcHubRow {
            destination_hash: hash.to_string(),
            identity_hash,
            display_name,
            name_source: Some(incoming_name_source.into()),
            last_seen: Some(now),
            favorited: false,
            hops,
            status: Some("online".into()),
            source: if recommended && source != "manual" {
                "recommended".into()
            } else {
                source.into()
            },
            recommended,
        });
    }

    pub fn set_rrc_favorite(&mut self, hash: &str, favorited: bool) {
        let key = hash.to_lowercase();
        if let Some(hub) = self
            .rrc_hubs
            .iter_mut()
            .find(|h| h.destination_hash.to_lowercase() == key)
        {
            hub.favorited = favorited;
            return;
        }
        let recommended = super::rrc_defaults::RRC_DEFAULT_HUBS
            .iter()
            .any(|h| h.destination_hash.eq_ignore_ascii_case(&key));
        self.rrc_hubs.push(RrcHubRow {
            destination_hash: hash.to_string(),
            identity_hash: None,
            display_name: None,
            name_source: None,
            last_seen: Some(Self::now_secs()),
            favorited,
            hops: None,
            status: Some("unknown".into()),
            source: "manual".into(),
            recommended,
        });
    }

    pub fn clear_peers(&mut self) {
        self.peers.clear();
    }

    pub fn clear_contacts(&mut self) {
        self.contacts.clear();
    }

    /// Move LXMF contacts into the peer cache (keep display names on Peers after contact wipe).
    pub fn demote_contacts_to_peers(&mut self) {
        for contact in self.contacts.clone() {
            let hash = contact.destination_hash;
            if let Some(peer) = self
                .peers
                .iter_mut()
                .find(|p| p.destination_hash.eq_ignore_ascii_case(&hash))
            {
                if peer.display_name.as_ref().is_none_or(String::is_empty) {
                    if let Some(name) = contact.display_name.filter(|n| !n.is_empty()) {
                        peer.display_name = Some(name);
                    }
                }
                if peer.last_seen.is_none() {
                    peer.last_seen = contact.last_heard;
                }
                continue;
            }
            self.peers.push(PeerRow {
                destination_hash: hash,
                display_name: contact.display_name,
                hops: None,
                last_seen: contact.last_heard,
                interface: None,
                path_hash: None,
                via_hash: None,
            });
        }
    }

    pub fn upsert_contact(&mut self, hash: &str, name: Option<String>) {
        let hash = super::topology::canonicalize_destination_hash(hash)
            .unwrap_or_else(|| hash.trim().to_ascii_lowercase());
        // Reject hash-prefix placeholders so LXMF sender aliases cannot wipe announce names.
        let name = name.and_then(|n| {
            let trimmed = n.trim().to_string();
            if trimmed.is_empty() || super::topology::is_hash_prefix_alias(&hash, &trimmed) {
                None
            } else {
                Some(trimmed)
            }
        });
        if let Some(c) = self
            .contacts
            .iter_mut()
            .find(|c| c.destination_hash.eq_ignore_ascii_case(&hash))
        {
            if c.destination_hash != hash {
                c.destination_hash = hash.clone();
            }
            if let Some(new_name) = name {
                c.display_name = Some(new_name);
            }
            // nameless upserts leave an existing real/empty name alone.
            c.last_heard = Some(Self::now_secs());
            return;
        }
        self.contacts.push(ContactRow {
            destination_hash: hash,
            display_name: name,
            last_heard: Some(Self::now_secs()),
            favorited: false,
        });
    }

    /// Upsert a contact, filling a missing name from announce/peer cache when needed.
    pub fn upsert_contact_with_name_cache(
        &mut self,
        hash: &str,
        name: Option<&str>,
        name_cache: &std::collections::HashMap<String, String>,
    ) {
        let hash = super::topology::canonicalize_destination_hash(hash)
            .unwrap_or_else(|| hash.trim().to_ascii_lowercase());
        let stored = self
            .contacts
            .iter()
            .find(|c| c.destination_hash.eq_ignore_ascii_case(&hash))
            .and_then(|c| c.display_name.clone());
        let cache = name_cache
            .get(&hash)
            .or_else(|| {
                name_cache
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case(&hash))
                    .map(|(_, v)| v)
            })
            .map(String::as_str);
        let resolved = super::topology::resolve_contact_name_for_upsert(
            &hash,
            name.or(stored.as_deref()),
            cache,
        );
        self.upsert_contact(&hash, resolved);
    }

    pub fn send_lxmf_local(&mut self, req: &LxmfSendRequest) -> Result<serde_json::Value, String> {
        if !self.identity.configured {
            return Err("identity not configured".into());
        }
        let ts = Self::now_secs();
        let peer_names = super::topology::build_topology_name_map(
            &self.peers,
            &self.contacts,
            &self.nomad_nodes,
        );
        self.upsert_contact_with_name_cache(&req.destination_hash, None, &peer_names);
        let sent_via = resolve_outbound_sent_via(&self.interfaces);
        let mut payload = serde_json::json!({
            "sender_hash": self.identity.lxmf_hash,
            "sender_name": self.identity.display_name.clone().unwrap_or_else(|| "Self".into()),
            "text": req.text,
            "timestamp": ts * 1000,
            "to_hash": req.destination_hash,
            "reply_to_hash": req.reply_to_hash,
            "reply_to_id": req.reply_to_id,
            "reply_preview_text": req.reply_preview_text,
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

    #[allow(clippy::unnecessary_wraps)] // Result matches other LXMF send helpers for uniform ? handling
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

    #[allow(clippy::unnecessary_wraps)] // Result matches factory_reset callers that use ?
    pub fn factory_reset_state(&mut self) -> Result<(), String> {
        let interfaces = self.interfaces.clone();
        *self = Self::default_empty();
        self.interfaces = interfaces;
        self.ensure_defaults();
        Ok(())
    }

    #[allow(clippy::unnecessary_wraps)] // Result matches delete_message_by_hash callers that use ?
    pub fn delete_message_by_hash(&mut self, message_hash: &str) -> Result<bool, String> {
        let before = self.messages.len();
        self.messages
            .retain(|m| m.get("message_hash").and_then(|v| v.as_str()) != Some(message_hash));
        Ok(self.messages.len() < before)
    }
}

pub(crate) fn stable_hash(s: &str) -> u128 {
    let mut h: u128 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        h ^= b as u128;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

impl serde::Serialize for PersistedState {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("PersistedState", 27)?;
        s.serialize_field("identity", &self.identity)?;
        s.serialize_field("interfaces", &self.interfaces)?;
        s.serialize_field("contacts", &self.contacts)?;
        s.serialize_field("peers", &self.peers)?;
        s.serialize_field("propagation", &self.propagation)?;
        s.serialize_field("messages", &self.messages)?;
        s.serialize_field("rns_ready", &self.rns_ready)?;
        s.serialize_field("lxmf_ready", &self.lxmf_ready)?;
        s.serialize_field("preferred_propagation_id", &self.preferred_propagation_id)?;
        s.serialize_field(
            "primary_local_serial_interface_id",
            &self.primary_local_serial_interface_id,
        )?;
        s.serialize_field("propagation_sync", &self.propagation_sync)?;
        s.serialize_field("auto_sync_interval_sec", &self.auto_sync_interval_sec)?;
        s.serialize_field("pn_hosting_policy", &self.pn_hosting_policy)?;
        s.serialize_field("nomad_nodes", &self.nomad_nodes)?;
        s.serialize_field("rrc_hubs", &self.rrc_hubs)?;
        s.serialize_field("nomad_serving_enabled", &self.nomad_serving_enabled)?;
        s.serialize_field(
            "nomad_serving_display_name",
            &self.nomad_serving_display_name,
        )?;
        s.serialize_field(
            "nomad_serving_content_source",
            &self.nomad_serving_content_source,
        )?;
        s.serialize_field("rncp_listener_enabled", &self.rncp_listener_enabled)?;
        s.serialize_field("rncp_listener_save_dir", &self.rncp_listener_save_dir)?;
        s.serialize_field("rncp_listener_allow_fetch", &self.rncp_listener_allow_fetch)?;
        s.serialize_field("rncp_listener_fetch_jail", &self.rncp_listener_fetch_jail)?;
        s.serialize_field("rncp_listener_overwrite", &self.rncp_listener_overwrite)?;
        s.serialize_field("rncp_listener_allowed", &self.rncp_listener_allowed)?;
        s.serialize_field("rncp_listener_blocked", &self.rncp_listener_blocked)?;
        s.serialize_field("path_medium_preference", &self.path_medium_preference)?;
        s.serialize_field("peer_medium_pins", &self.peer_medium_pins)?;
        s.end()
    }
}

impl<'de> serde::Deserialize<'de> for PersistedState {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[allow(clippy::struct_excessive_bools)] // mirrors PersistedState field-for-field
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
            primary_local_serial_interface_id: Option<String>,
            #[serde(default)]
            propagation_sync: serde_json::Value,
            #[serde(default)]
            auto_sync_interval_sec: u32,
            #[serde(default)]
            pn_hosting_policy: PnHostingPolicy,
            #[serde(default)]
            nomad_nodes: Vec<NomadNodeRow>,
            #[serde(default)]
            rrc_hubs: Vec<RrcHubRow>,
            #[serde(default)]
            nomad_serving_enabled: bool,
            #[serde(default)]
            nomad_serving_display_name: Option<String>,
            #[serde(default)]
            nomad_serving_content_source: Option<String>,
            #[serde(default)]
            rncp_listener_enabled: bool,
            #[serde(default)]
            rncp_listener_save_dir: Option<String>,
            #[serde(default)]
            rncp_listener_allow_fetch: bool,
            #[serde(default)]
            rncp_listener_fetch_jail: Option<String>,
            #[serde(default)]
            rncp_listener_overwrite: bool,
            #[serde(default)]
            rncp_listener_allowed: Vec<String>,
            #[serde(default)]
            rncp_listener_blocked: Vec<String>,
            #[serde(default)]
            path_medium_preference: PathMediumPreferenceSetting,
            #[serde(default)]
            peer_medium_pins: PeerMediumPins,
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
            primary_local_serial_interface_id: raw.primary_local_serial_interface_id,
            propagation_sync: if raw.propagation_sync.is_null() {
                serde_json::Value::Null
            } else {
                raw.propagation_sync
            },
            auto_sync_interval_sec: raw.auto_sync_interval_sec,
            pn_hosting_policy: raw.pn_hosting_policy,
            nomad_nodes: raw.nomad_nodes,
            rrc_hubs: raw.rrc_hubs,
            nomad_serving_enabled: raw.nomad_serving_enabled,
            nomad_serving_display_name: raw.nomad_serving_display_name,
            nomad_serving_content_source: raw.nomad_serving_content_source,
            rncp_listener_enabled: raw.rncp_listener_enabled,
            rncp_listener_save_dir: raw.rncp_listener_save_dir,
            rncp_listener_allow_fetch: raw.rncp_listener_allow_fetch,
            rncp_listener_fetch_jail: raw.rncp_listener_fetch_jail,
            rncp_listener_overwrite: raw.rncp_listener_overwrite,
            rncp_listener_allowed: raw.rncp_listener_allowed,
            rncp_listener_blocked: raw.rncp_listener_blocked,
            path_medium_preference: raw.path_medium_preference,
            peer_medium_pins: raw.peer_medium_pins,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn peer(hash: &str, name: &str) -> PeerRow {
        PeerRow {
            destination_hash: hash.into(),
            display_name: Some(name.into()),
            hops: Some(1),
            last_seen: Some(1),
            interface: None,
            path_hash: None,
            via_hash: None,
        }
    }

    #[test]
    fn upsert_contact_with_name_cache_fills_from_peer_announce() {
        let hash = "aabbccddeeff00112233445566778899";
        let mut state = PersistedState::default_empty();
        state.peers.push(peer(hash, "Hub Peer"));
        let cache = super::super::topology::build_topology_name_map(
            &state.peers,
            &state.contacts,
            &state.nomad_nodes,
        );
        state.upsert_contact_with_name_cache(hash, None, &cache);
        assert_eq!(state.contacts.len(), 1);
        assert_eq!(state.contacts[0].destination_hash, hash);
        assert_eq!(state.contacts[0].display_name.as_deref(), Some("Hub Peer"));
    }

    #[test]
    fn upsert_contact_keeps_real_name_over_hash_prefix() {
        let hash = "deadbeefcafebabe0123456789abcdef";
        let mut state = PersistedState::default_empty();
        state.upsert_contact(hash, Some("Alice".into()));
        state.upsert_contact(hash, Some("deadbeefcafe".into()));
        assert_eq!(state.contacts.len(), 1);
        assert_eq!(state.contacts[0].display_name.as_deref(), Some("Alice"));
    }

    #[test]
    fn upsert_contact_with_name_cache_replaces_hash_prefix_placeholder() {
        let hash = "aabbccddeeff00112233445566778899";
        let mut state = PersistedState::default_empty();
        state.upsert_contact(hash, Some("aabbccddeeff".into()));
        assert!(state.contacts[0].display_name.is_none());
        state.upsert_contact(hash, Some("aabbccddeeff".into()));
        let mut cache = HashMap::new();
        cache.insert(hash.into(), "Cached Alias".into());
        state.upsert_contact_with_name_cache(hash, Some("aabbccddeeff"), &cache);
        assert_eq!(
            state.contacts[0].display_name.as_deref(),
            Some("Cached Alias")
        );
    }

    #[test]
    fn upsert_contact_canonicalizes_uppercase_hash() {
        let upper = "AABBCCDDEEFF00112233445566778899";
        let lower = "aabbccddeeff00112233445566778899";
        let mut state = PersistedState::default_empty();
        state.upsert_contact(upper, Some("Named".into()));
        state.upsert_contact(lower, None);
        assert_eq!(state.contacts.len(), 1);
        assert_eq!(state.contacts[0].destination_hash, lower);
        assert_eq!(state.contacts[0].display_name.as_deref(), Some("Named"));
    }

    #[test]
    fn add_propagation_node_preserves_optional_identity_fields_on_mutate() {
        let mut state = PersistedState::default_empty();
        state.ensure_defaults();
        let mut row = state
            .add_propagation_node("aabbccddeeff00112233445566778899", Some("Remote".into()))
            .expect("add");
        row.public_key = Some("ab".repeat(64));
        row.identity_hash = Some("cd".repeat(16));
        if let Some(node) = state.propagation.iter_mut().find(|p| p.id == row.id) {
            node.public_key = row.public_key.clone();
            node.identity_hash = row.identity_hash.clone();
        }
        let json = serde_json::to_value(&state).expect("serialize");
        let restored: PersistedState = serde_json::from_value(json).expect("deserialize");
        let node = restored
            .propagation
            .iter()
            .find(|p| p.id == row.id)
            .expect("row");
        assert_eq!(
            node.public_key.as_deref(),
            Some(row.public_key.as_deref().unwrap())
        );
        assert_eq!(
            node.identity_hash.as_deref(),
            Some(row.identity_hash.as_deref().unwrap())
        );
    }

    #[test]
    fn remove_propagation_node_rejects_local_prop() {
        let mut state = PersistedState::default_empty();
        state.ensure_defaults();
        assert!(state.remove_propagation_node("local-prop").is_err());
        assert!(state.propagation.iter().any(|p| p.id == "local-prop"));
    }

    #[test]
    fn remove_propagation_node_clears_preferred_and_sync() {
        let mut state = PersistedState::default_empty();
        let row = state
            .add_propagation_node("aabbccddeeff00112233445566778899", Some("Remote".into()))
            .expect("add");
        state.preferred_propagation_id = Some(row.id.clone());
        state.start_propagation_sync(&row.id).expect("start sync");
        state.remove_propagation_node(&row.id).expect("remove");
        assert!(!state.propagation.iter().any(|p| p.id == row.id));
        assert!(state.preferred_propagation_id.is_none());
        assert_eq!(
            state
                .propagation_sync
                .get("active")
                .and_then(serde_json::Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn rename_propagation_node_updates_name() {
        let mut state = PersistedState::default_empty();
        let row = state
            .add_propagation_node("deadbeefcafebabe0123456789abcdef", None)
            .expect("add");
        state
            .rename_propagation_node(&row.id, "  Hub PN  ")
            .expect("rename");
        assert_eq!(
            state
                .propagation
                .iter()
                .find(|p| p.id == row.id)
                .map(|p| p.name.as_str()),
            Some("Hub PN")
        );
        assert!(state.rename_propagation_node("local-prop", "Nope").is_err());
        assert!(state.rename_propagation_node(&row.id, "   ").is_err());
        assert!(state.rename_propagation_node("not-a-pn", "Nope").is_err());
        assert!(
            state
                .rename_propagation_node(&row.id, "bad\u{0001}name")
                .is_err()
        );
        assert!(
            state
                .rename_propagation_node(&row.id, &"x".repeat(129))
                .is_err()
        );
    }

    #[test]
    fn remove_propagation_node_rejects_invalid_id() {
        let mut state = PersistedState::default_empty();
        assert!(state.remove_propagation_node("pn-short").is_err());
        assert!(state.remove_propagation_node("evil-id").is_err());
    }

    #[test]
    fn nomad_serving_fields_round_trip_and_default_when_absent() {
        let mut state = PersistedState::default_empty();
        state.nomad_serving_enabled = true;
        state.nomad_serving_display_name = Some("Home".into());
        state.nomad_serving_content_source = Some("/tmp/nomad-page".into());
        let json = serde_json::to_string(&state).expect("serialize");
        let loaded: PersistedState = serde_json::from_str(&json).expect("deserialize");
        assert!(loaded.nomad_serving_enabled);
        assert_eq!(loaded.nomad_serving_display_name.as_deref(), Some("Home"));
        assert_eq!(
            loaded.nomad_serving_content_source.as_deref(),
            Some("/tmp/nomad-page")
        );

        // Strip the new keys from a valid serialized document (older clients).
        let mut value: serde_json::Value = serde_json::from_str(&json).expect("value");
        let obj = value.as_object_mut().expect("object");
        obj.remove("nomad_serving_enabled");
        obj.remove("nomad_serving_display_name");
        obj.remove("nomad_serving_content_source");
        let legacy_state: PersistedState =
            serde_json::from_value(value).expect("legacy without serving keys");
        assert!(!legacy_state.nomad_serving_enabled);
        assert!(legacy_state.nomad_serving_display_name.is_none());
        assert!(legacy_state.nomad_serving_content_source.is_none());
    }

    #[test]
    fn pn_hosting_policy_round_trip_and_default_when_absent() {
        let mut state = PersistedState::default_empty();
        let policy = PnHostingPolicy {
            peering_cost: 20,
            max_peering_cost: 26,
            node_name: Some("Test PN".into()),
            static_peers: vec!["aabbccddeeff00112233445566778899".into()],
            ..PnHostingPolicy::default()
        };
        state
            .set_pn_hosting_policy(policy.clone())
            .expect("set valid policy");
        let json = serde_json::to_string(&state).expect("serialize");
        let loaded: PersistedState = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(loaded.pn_hosting_policy.peering_cost, 20);
        assert_eq!(
            loaded.pn_hosting_policy.node_name.as_deref(),
            Some("Test PN")
        );
        assert_eq!(
            loaded.pn_hosting_policy.static_peers,
            vec!["aabbccddeeff00112233445566778899"]
        );

        let mut value: serde_json::Value = serde_json::from_str(&json).expect("value");
        let obj = value.as_object_mut().expect("object");
        obj.remove("pn_hosting_policy");
        let legacy_state: PersistedState =
            serde_json::from_value(value).expect("legacy without pn_hosting_policy");
        assert_eq!(legacy_state.pn_hosting_policy, PnHostingPolicy::default());
    }

    #[test]
    fn set_pn_hosting_policy_rejects_invalid() {
        let mut state = PersistedState::default_empty();
        let before = state.pn_hosting_policy.clone();
        let bad = PnHostingPolicy {
            peering_cost: 30,
            max_peering_cost: 26,
            ..PnHostingPolicy::default()
        };
        assert_eq!(
            state.set_pn_hosting_policy(bad).unwrap_err(),
            "peering_cost_exceeds_max"
        );
        assert_eq!(state.pn_hosting_policy, before);
    }

    #[test]
    fn path_medium_defaults_to_lowest_with_no_pins() {
        let state = PersistedState::default_empty();
        assert_eq!(
            state.path_medium_preference,
            PathMediumPreferenceSetting::Lowest
        );
        assert!(state.peer_medium_pins.is_empty());
    }

    #[test]
    fn path_medium_fields_round_trip_and_default_when_absent() {
        let hash = "aabbccddeeff00112233445566778899";
        let mut state = PersistedState::default_empty();
        state.set_path_medium_preference(PathMediumPreferenceSetting::Rf);
        state
            .set_peer_medium_pin(hash, Some(PathMediumSetting::Network))
            .expect("pin");
        let json = serde_json::to_string(&state).expect("serialize");
        let loaded: PersistedState = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(
            loaded.path_medium_preference,
            PathMediumPreferenceSetting::Rf
        );
        assert_eq!(
            loaded.peer_medium_pins.get(hash),
            Some(PathMediumSetting::Network)
        );

        // Strip the new keys from a valid serialized document (older clients).
        let mut value: serde_json::Value = serde_json::from_str(&json).expect("value");
        let obj = value.as_object_mut().expect("object");
        obj.remove("path_medium_preference");
        obj.remove("peer_medium_pins");
        let legacy_state: PersistedState =
            serde_json::from_value(value).expect("legacy without path medium keys");
        assert_eq!(
            legacy_state.path_medium_preference,
            PathMediumPreferenceSetting::Lowest
        );
        assert!(legacy_state.peer_medium_pins.is_empty());
    }

    #[test]
    fn set_peer_medium_pin_updates_and_clears() {
        let hash = "deadbeefcafebabe0123456789abcdef";
        let mut state = PersistedState::default_empty();
        let canonical = state
            .set_peer_medium_pin(&hash.to_ascii_uppercase(), Some(PathMediumSetting::Rf))
            .expect("pin");
        assert_eq!(canonical, hash);
        assert_eq!(
            state.peer_medium_pins.get(hash),
            Some(PathMediumSetting::Rf)
        );
        state
            .set_peer_medium_pin(hash, None)
            .expect("clear existing pin");
        assert!(state.peer_medium_pins.get(hash).is_none());
        assert!(
            state
                .set_peer_medium_pin("nothex", Some(PathMediumSetting::Rf))
                .is_err()
        );
    }

    #[test]
    fn corrupt_path_medium_values_do_not_reset_state_file() {
        let mut state = PersistedState::default_empty();
        state.set_path_medium_preference(PathMediumPreferenceSetting::Network);
        let json = serde_json::to_string(&state).expect("serialize");
        let mut value: serde_json::Value = serde_json::from_str(&json).expect("value");
        let obj = value.as_object_mut().expect("object");
        obj.insert("path_medium_preference".into(), serde_json::json!("bogus"));
        obj.insert(
            "peer_medium_pins".into(),
            serde_json::json!({ "nothex": "rf" }),
        );
        let loaded: PersistedState = serde_json::from_value(value).expect("tolerant load");
        assert_eq!(
            loaded.path_medium_preference,
            PathMediumPreferenceSetting::Lowest
        );
        assert!(loaded.peer_medium_pins.is_empty());
    }

    #[test]
    fn rncp_listener_fields_round_trip_and_default_when_absent() {
        let mut state = PersistedState::default_empty();
        state.rncp_listener_enabled = true;
        state.rncp_listener_save_dir = Some("/tmp/rncp-inbox".into());
        state.rncp_listener_allow_fetch = true;
        state.rncp_listener_fetch_jail = Some("/tmp/rncp-jail".into());
        state.rncp_listener_overwrite = true;
        state.rncp_listener_allowed = vec!["aa".repeat(16)];
        state.rncp_listener_blocked = vec!["bb".repeat(16)];
        let json = serde_json::to_string(&state).expect("serialize");
        let loaded: PersistedState = serde_json::from_str(&json).expect("deserialize");
        assert!(loaded.rncp_listener_enabled);
        assert_eq!(
            loaded.rncp_listener_save_dir.as_deref(),
            Some("/tmp/rncp-inbox")
        );
        assert!(loaded.rncp_listener_allow_fetch);
        assert_eq!(
            loaded.rncp_listener_fetch_jail.as_deref(),
            Some("/tmp/rncp-jail")
        );
        assert!(loaded.rncp_listener_overwrite);
        assert_eq!(loaded.rncp_listener_allowed, vec!["aa".repeat(16)]);
        assert_eq!(loaded.rncp_listener_blocked, vec!["bb".repeat(16)]);

        // Strip the new keys from a valid serialized document (older clients).
        let mut value: serde_json::Value = serde_json::from_str(&json).expect("value");
        let obj = value.as_object_mut().expect("object");
        for key in [
            "rncp_listener_enabled",
            "rncp_listener_save_dir",
            "rncp_listener_allow_fetch",
            "rncp_listener_fetch_jail",
            "rncp_listener_overwrite",
            "rncp_listener_allowed",
            "rncp_listener_blocked",
        ] {
            obj.remove(key);
        }
        let legacy_state: PersistedState =
            serde_json::from_value(value).expect("legacy without rncp listener keys");
        assert!(!legacy_state.rncp_listener_enabled);
        assert!(legacy_state.rncp_listener_save_dir.is_none());
        assert!(legacy_state.rncp_listener_allowed.is_empty());
    }
}

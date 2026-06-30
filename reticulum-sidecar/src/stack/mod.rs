//! Persistent stack state + optional live RNS/LXMF bridge.

pub mod config;
mod persistence;
mod types;

#[cfg(feature = "rns-stack")]
mod live;

use std::path::PathBuf;
use std::sync::Arc;

pub use config::{ImportMode, ImportResult, StackSettings, UpdateInterfacePatch};
use persistence::PersistedState;
use tokio::sync::{RwLock, broadcast};
pub use types::{
    AddInterfaceRequest, ContactRow, InterfaceRow, LxmfReactionRequest, LxmfResourceRequest,
    LxmfSendRequest, PeerRow, PropagationRow, StackIdentity,
};

pub struct StackHandle {
    pub config_dir: PathBuf,
    pub storage_dir: PathBuf,
    inner: Arc<RwLock<PersistedState>>,
    event_tx: broadcast::Sender<String>,
    #[cfg(feature = "rns-stack")]
    live: Option<Arc<live::LiveBridge>>,
}

impl StackHandle {
    pub async fn bootstrap(
        config_dir: PathBuf,
        storage_dir: PathBuf,
        event_tx: broadcast::Sender<String>,
    ) -> Self {
        if !config::config_path(&config_dir).exists() {
            if let Ok(content) = config::read_config(&config_dir) {
                let _ = config::write_config(&config_dir, &content);
            }
        }

        let mut persisted = PersistedState::load(&config_dir, &storage_dir);
        persisted.ensure_defaults();
        if let Ok(ifaces) = config::interfaces_from_config_dir(&config_dir) {
            persisted.interfaces = ifaces;
        }

        #[cfg(feature = "rns-stack")]
        let live = match live::LiveBridge::spawn(
            config_dir.clone(),
            storage_dir.clone(),
            event_tx.clone(),
            &mut persisted,
        )
        .await
        {
            Ok(bridge) => Some(Arc::new(bridge)),
            Err(e) => {
                tracing::warn!("live RNS bridge unavailable, using local stack: {e}");
                None
            }
        };

        let inner = Arc::new(RwLock::new(persisted));
        let handle = Self {
            config_dir,
            storage_dir,
            inner,
            event_tx,
            #[cfg(feature = "rns-stack")]
            live,
        };
        handle.emit_stats().await;
        handle
    }

    fn emit_event(&self, event_type: &str, payload: serde_json::Value) {
        let msg = serde_json::json!({ "type": event_type, "payload": payload });
        let _ = self.event_tx.send(msg.to_string());
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<String> {
        self.event_tx.subscribe()
    }

    async fn sync_interfaces_from_config(&self) {
        if let Ok(ifaces) = config::interfaces_from_config_dir(&self.config_dir) {
            let mut inner = self.inner.write().await;
            inner.interfaces = ifaces;
        }
    }

    pub async fn emit_stats(&self) {
        let inner = self.inner.read().await;
        self.emit_event(
            "stats_update",
            serde_json::json!({
                "rns_ready": inner.rns_ready,
                "lxmf_ready": inner.lxmf_ready,
                "interface_count": inner.interfaces.len(),
                "contact_count": inner.contacts.len(),
                "peer_count": inner.peers.len(),
            }),
        );
    }

    pub async fn identity_status(&self) -> StackIdentity {
        self.inner.read().await.identity.clone()
    }

    pub async fn identity_generate(
        &self,
        display_name: Option<String>,
    ) -> Result<StackIdentity, String> {
        let mut inner = self.inner.write().await;
        let identity = inner.generate_identity(display_name)?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        Ok(identity)
    }

    pub async fn identity_import(
        &self,
        mnemonic: &str,
        display_name: Option<String>,
    ) -> Result<StackIdentity, String> {
        let mut inner = self.inner.write().await;
        let identity = inner.import_identity_mnemonic(mnemonic, display_name)?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        Ok(identity)
    }

    pub async fn identity_export_backup(
        &self,
        passphrase: &str,
    ) -> Result<serde_json::Value, String> {
        let inner = self.inner.read().await;
        inner.export_identity_backup(passphrase)
    }

    pub async fn identity_import_backup(
        &self,
        backup: serde_json::Value,
        passphrase: &str,
    ) -> Result<StackIdentity, String> {
        let mut inner = self.inner.write().await;
        let identity = inner.import_identity_backup(backup, passphrase)?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        Ok(identity)
    }

    pub async fn set_display_name(&self, name: &str) -> Result<(), String> {
        let mut inner = self.inner.write().await;
        inner.identity.display_name = Some(name.to_string());
        inner.save(&self.config_dir, &self.storage_dir)?;
        Ok(())
    }

    pub async fn list_interfaces(&self) -> Vec<InterfaceRow> {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            if let Ok(rows) = live.fetch_interfaces().await {
                if !rows.is_empty() {
                    return rows;
                }
            }
        }
        match config::interfaces_from_config_dir(&self.config_dir) {
            Ok(rows) => rows,
            Err(_) => self.inner.read().await.interfaces.clone(),
        }
    }

    pub async fn add_interface(&self, req: AddInterfaceRequest) -> Result<InterfaceRow, String> {
        {
            let inner = self.inner.read().await;
            if !inner.identity.configured {
                return Err("identity not configured".into());
            }
        }
        let row = config::add_interface_to_config(&self.config_dir, &req)?;
        self.sync_interfaces_from_config().await;
        self.emit_event("interface.state", serde_json::json!({ "action": "added" }));
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            let _ = live.apply_interfaces(self).await;
        }
        Ok(row)
    }

    pub async fn update_interface(
        &self,
        id: &str,
        patch: UpdateInterfacePatch,
    ) -> Result<InterfaceRow, String> {
        let row = config::update_interface_in_config(&self.config_dir, id, &patch)?;
        self.sync_interfaces_from_config().await;
        self.emit_event(
            "interface.state",
            serde_json::json!({ "id": id, "action": "updated" }),
        );
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            let _ = live.apply_interfaces(self).await;
        }
        Ok(row)
    }

    pub async fn delete_interface(&self, id: &str) -> Result<(), String> {
        config::delete_interface_from_config(&self.config_dir, id)?;
        self.sync_interfaces_from_config().await;
        self.emit_event(
            "interface.state",
            serde_json::json!({ "id": id, "action": "deleted" }),
        );
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            let _ = live.apply_interfaces(self).await;
        }
        Ok(())
    }

    pub async fn set_interface_enabled(&self, id: &str, enabled: bool) -> Result<(), String> {
        config::set_interface_enabled_in_config(&self.config_dir, id, enabled)?;
        self.sync_interfaces_from_config().await;
        self.emit_event(
            "interface.state",
            serde_json::json!({ "id": id, "enabled": enabled }),
        );
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            let _ = live.apply_interfaces(self).await;
        }
        Ok(())
    }

    pub async fn put_config_content(&self, content: &str) -> Result<(), String> {
        config::write_config(&self.config_dir, content)?;
        self.sync_interfaces_from_config().await;
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            let _ = live.apply_interfaces(self).await;
        }
        Ok(())
    }

    pub async fn import_config(
        &self,
        content: &str,
        mode: ImportMode,
    ) -> Result<ImportResult, String> {
        let result = config::import_config(&self.config_dir, content, mode)?;
        self.sync_interfaces_from_config().await;
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            let _ = live.apply_interfaces(self).await;
        }
        Ok(result)
    }

    pub async fn set_stack_settings(&self, settings: &StackSettings) -> Result<(), String> {
        config::set_stack_settings(&self.config_dir, settings)
    }

    pub async fn list_contacts(&self) -> Vec<ContactRow> {
        self.inner.read().await.contacts.clone()
    }

    pub async fn list_peers(&self) -> Vec<PeerRow> {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            if let Ok(peers) = live.fetch_peers().await {
                if !peers.is_empty() {
                    return peers;
                }
            }
        }
        self.inner.read().await.peers.clone()
    }

    pub async fn request_peer_path(&self, hash: &str) -> Result<(), String> {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.request_path(hash).await;
        }
        let _ = hash;
        Ok(())
    }

    pub async fn probe_peer(&self, hash: &str) -> Result<serde_json::Value, String> {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.probe_peer(hash).await;
        }
        Ok(serde_json::json!({ "ok": true, "mode": "local", "hash": hash }))
    }

    pub async fn list_propagation(&self) -> Vec<PropagationRow> {
        self.inner.read().await.propagation.clone()
    }

    pub async fn set_propagation_enabled(&self, id: &str, enabled: bool) -> Result<(), String> {
        let mut inner = self.inner.write().await;
        inner.set_propagation_enabled(id, enabled)?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        Ok(())
    }

    pub async fn lxmf_send(&self, req: LxmfSendRequest) -> Result<serde_json::Value, String> {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            if let Ok(res) = live.send_lxmf(&req).await {
                return Ok(res);
            }
        }
        let mut inner = self.inner.write().await;
        let res = inner.send_lxmf_local(&req)?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        let payload = res.clone();
        drop(inner);
        self.emit_event("lxmf_message", payload);
        Ok(res)
    }

    pub async fn lxmf_reaction(
        &self,
        req: LxmfReactionRequest,
    ) -> Result<serde_json::Value, String> {
        let mut inner = self.inner.write().await;
        let res = inner.send_reaction(&req)?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        drop(inner);
        self.emit_event("lxmf_message", res.clone());
        Ok(res)
    }

    pub async fn rnode_presets(&self) -> serde_json::Value {
        serde_json::json!({
            "presets": [
                { "id": "rnode_generic", "label": "Generic RNode", "frequency": 915000000, "bandwidth": 125000, "spreading_factor": 8, "coding_rate": 5 },
                { "id": "rnode_eu868", "label": "EU868", "frequency": 868000000, "bandwidth": 125000, "spreading_factor": 8, "coding_rate": 5 },
                { "id": "rnode_us915", "label": "US915", "frequency": 915000000, "bandwidth": 125000, "spreading_factor": 8, "coding_rate": 5 }
            ]
        })
    }

    pub async fn serial_ports(&self) -> serde_json::Value {
        serde_json::json!({ "ports": enumerate_serial_ports() })
    }

    pub async fn ble_availability(&self) -> serde_json::Value {
        serde_json::json!({
            "available": cfg!(feature = "rns-ble"),
            "missing": [],
            "permissions_granted": true,
            "probe_failed": false
        })
    }

    pub async fn lxmf_send_resource(
        &self,
        req: LxmfResourceRequest,
    ) -> Result<serde_json::Value, String> {
        let mut inner = self.inner.write().await;
        let res = inner.send_resource_local(&req)?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        let payload = res.clone();
        drop(inner);
        self.emit_event("resource.received", payload.clone());
        self.emit_event("lxmf_message", payload.clone());
        Ok(payload)
    }

    pub async fn lxmf_delete_message(&self, message_hash: &str) -> Result<bool, String> {
        let mut inner = self.inner.write().await;
        let removed = inner.delete_message_by_hash(message_hash)?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        Ok(removed)
    }

    pub async fn request_stack_restart(&self) -> Result<(), String> {
        self.emit_event("stack_restart_requested", serde_json::json!({ "ok": true }));
        Ok(())
    }

    pub async fn factory_reset(&self) -> Result<(), String> {
        let mut inner = self.inner.write().await;
        inner.factory_reset_state()?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        self.emit_stats().await;
        Ok(())
    }

    pub async fn diagnostics_snapshot(&self) -> serde_json::Value {
        let inner = self.inner.read().await;
        let interfaces: Vec<serde_json::Value> = inner
            .interfaces
            .iter()
            .map(|i| {
                serde_json::json!({
                    "id": i.id,
                    "name": i.name,
                    "type": i.iface_type,
                    "enabled": i.enabled,
                    "status": i.status,
                })
            })
            .collect();
        serde_json::json!({
            "rns_ready": inner.rns_ready,
            "lxmf_ready": inner.lxmf_ready,
            "interface_count": inner.interfaces.len(),
            "contact_count": inner.contacts.len(),
            "peer_count": inner.peers.len(),
            "message_count": inner.messages.len(),
            "interfaces": interfaces,
        })
    }

    pub async fn voice_status(&self) -> serde_json::Value {
        serde_json::json!({
            "available": cfg!(feature = "rns-stack"),
            "enabled": false,
            "codec": "opus",
            "reason": "LXST voice pipeline pending rsLXST integration"
        })
    }

    pub async fn games_status(&self) -> serde_json::Value {
        serde_json::json!({
            "available": true,
            "enabled": false,
            "reason": "LRGP games pending lrgp-rs integration"
        })
    }

    pub async fn list_identities(&self) -> serde_json::Value {
        let identity = self.inner.read().await.identity.clone();
        serde_json::json!({
            "identities": [{
                "id": "default",
                "display_name": identity.display_name,
                "identity_hash": identity.identity_hash,
                "lxmf_hash": identity.lxmf_hash,
                "active": true,
                "configured": identity.configured,
            }]
        })
    }

    pub async fn switch_identity(&self, identity_id: &str) -> Result<(), String> {
        if identity_id != "default" {
            return Err("only default identity is available in this build".into());
        }
        Ok(())
    }

    pub async fn rns_ready(&self) -> bool {
        self.inner.read().await.rns_ready
    }

    pub async fn lxmf_ready(&self) -> bool {
        self.inner.read().await.lxmf_ready
    }

    pub fn rns_version(&self) -> Option<String> {
        #[cfg(feature = "rns-stack")]
        {
            Some("rsReticulum".into())
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            None
        }
    }

    pub fn lxmf_version(&self) -> Option<String> {
        #[cfg(feature = "rns-stack")]
        {
            Some("rsLXMF".into())
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            None
        }
    }
}

fn enumerate_serial_ports() -> Vec<serde_json::Value> {
    let mut ports: Vec<serde_json::Value> = Vec::new();

    #[cfg(target_os = "macos")]
    {
        if let Ok(entries) = std::fs::read_dir("/dev") {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.starts_with("cu.") {
                    let path = format!("/dev/{name}");
                    ports.push(serde_json::json!({ "path": path, "label": name }));
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(entries) = std::fs::read_dir("/dev") {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.starts_with("ttyUSB") || name.starts_with("ttyACM") {
                    let path = format!("/dev/{name}");
                    ports.push(serde_json::json!({ "path": path, "label": name }));
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // No std library serial enumeration; users enter COM ports manually.
    }

    ports.sort_by(|a, b| {
        a.get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .cmp(b.get("path").and_then(|v| v.as_str()).unwrap_or(""))
    });
    ports
}

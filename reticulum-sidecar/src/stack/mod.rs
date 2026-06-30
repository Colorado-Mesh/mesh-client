//! Persistent stack state + optional live RNS/LXMF bridge.

pub mod config;
mod persistence;
mod types;
mod via;

#[cfg(feature = "rns-stack")]
mod live;

use std::path::PathBuf;
use std::sync::Arc;

pub use config::{ImportMode, ImportResult, StackSettings, UpdateInterfacePatch};
use persistence::PersistedState;
use tokio::sync::{RwLock, broadcast};
pub use types::{
    AddInterfaceRequest, ContactRow, InterfaceRow, LxmfReactionRequest, LxmfResourceRequest,
    LxmfSendRequest, NomadNodeRow, PeerRow, StackIdentity,
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
        let config_rows = match config::interfaces_from_config_dir(&self.config_dir) {
            Ok(rows) => rows,
            Err(_) => self.inner.read().await.interfaces.clone(),
        };

        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            if let Ok(rows) = live.fetch_interfaces().await {
                if !rows.is_empty() {
                    return rows;
                }
            }
        }
        config_rows
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
            let fetched = live.fetch_peers().await;
            let mut inner = self.inner.write().await;
            return merge_live_peer_fetch(&mut inner.peers, fetched);
        }
        self.inner.read().await.peers.clone()
    }

    pub async fn request_peer_path(&self, hash: &str) -> Result<(), String> {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            let res = live.request_path(hash).await;
            if res.is_ok() {
                self.emit_event("peers_updated", serde_json::json!({ "hash": hash }));
            }
            return res;
        }
        let _ = hash;
        Ok(())
    }

    pub async fn probe_peer(&self, hash: &str) -> Result<serde_json::Value, String> {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            let res = live.probe_peer(hash).await;
            if res.is_ok() {
                self.emit_event("peers_updated", serde_json::json!({ "hash": hash }));
            }
            return res;
        }
        let res = Ok(serde_json::json!({ "ok": true, "mode": "local", "hash": hash }));
        if res.is_ok() {
            self.emit_event("peers_updated", serde_json::json!({ "hash": hash }));
        }
        res
    }

    pub async fn list_propagation(&self) -> serde_json::Value {
        let inner = self.inner.read().await;
        let preferred_id = inner.preferred_propagation_id.clone();
        let auto_sync_interval_sec = inner.auto_sync_interval_sec;
        let propagation: Vec<serde_json::Value> = inner
            .propagation
            .iter()
            .map(|p| {
                let preferred = preferred_id.as_deref() == Some(p.id.as_str());
                serde_json::json!({
                    "id": p.id,
                    "name": p.name,
                    "hops": p.hops,
                    "enabled": p.enabled,
                    "status": p.status,
                    "preferred": preferred,
                })
            })
            .collect();
        serde_json::json!({
            "propagation": propagation,
            "preferred_id": preferred_id,
            "auto_sync_interval_sec": auto_sync_interval_sec,
        })
    }

    pub async fn set_preferred_propagation(&self, id: &str) -> Result<(), String> {
        let mut inner = self.inner.write().await;
        inner.set_preferred_propagation(id)?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        Ok(())
    }

    pub async fn start_propagation_sync(&self, propagation_id: &str) -> Result<(), String> {
        let mut inner = self.inner.write().await;
        inner.start_propagation_sync(propagation_id)?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        self.emit_event(
            "propagation_sync",
            inner.propagation_sync.clone(),
        );
        Ok(())
    }

    pub async fn cancel_propagation_sync(&self) -> Result<(), String> {
        let mut inner = self.inner.write().await;
        inner.cancel_propagation_sync();
        inner.save(&self.config_dir, &self.storage_dir)?;
        self.emit_event(
            "propagation_sync",
            inner.propagation_sync.clone(),
        );
        Ok(())
    }

    pub async fn set_propagation_enabled(&self, id: &str, enabled: bool) -> Result<(), String> {
        let mut inner = self.inner.write().await;
        inner.set_propagation_enabled(id, enabled)?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        Ok(())
    }

    pub async fn ping_destination(&self, destination_hash: &str) -> Result<serde_json::Value, String> {
        let started = std::time::Instant::now();
        let probe = self.probe_peer(destination_hash).await?;
        let rtt_ms = started.elapsed().as_millis() as u64;
        let ok = probe.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        Ok(serde_json::json!({ "ok": ok, "rtt_ms": rtt_ms }))
    }

    pub async fn topology_snapshot(&self) -> serde_json::Value {
        let peers = self.list_peers().await;
        serde_json::json!({ "nodes": peers, "edges": [] })
    }

    pub async fn clear_announces(&self) -> Result<(), String> {
        let mut inner = self.inner.write().await;
        inner.clear_peers();
        inner.save(&self.config_dir, &self.storage_dir)?;
        self.emit_event("peers_updated", serde_json::json!({ "cleared": true }));
        Ok(())
    }

    pub async fn list_nomad_nodes(&self) -> Vec<NomadNodeRow> {
        self.inner.read().await.nomad_nodes.clone()
    }

    pub async fn set_nomad_favorite(&self, hash: &str, favorited: bool) -> Result<(), String> {
        let mut inner = self.inner.write().await;
        inner.set_nomad_favorite(hash, favorited);
        inner.save(&self.config_dir, &self.storage_dir)?;
        Ok(())
    }

    pub async fn nomad_page(&self, _hash: &str, _path: &str) -> serde_json::Value {
        serde_json::json!({
            "ok": false,
            "error": "nomad page fetch not implemented in stub stack"
        })
    }

    pub async fn nomad_file(&self, _hash: &str) -> serde_json::Value {
        serde_json::json!({
            "ok": false,
            "error": "nomad file fetch not implemented in stub stack"
        })
    }

    pub async fn lxmf_send(&self, req: LxmfSendRequest) -> Result<serde_json::Value, String> {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            let res = live.send_lxmf(&req).await?;
            let payload = res.get("message").cloned().unwrap_or(res.clone());
            if payload.get("text").is_some() {
                self.emit_event("lxmf_message", payload.clone());
            }
            return Ok(serde_json::json!({
                "ok": true,
                "message": payload,
                "sent_via": res.get("sent_via"),
            }));
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

/// Replaces the in-memory peer cache with a live path-table fetch result.
fn sync_live_peer_cache(cache: &mut Vec<PeerRow>, fetched: Vec<PeerRow>) -> Vec<PeerRow> {
    let merged: Vec<PeerRow> = fetched
        .into_iter()
        .map(|mut peer| {
            if peer.display_name.is_none() {
                if let Some(prev) = cache
                    .iter()
                    .find(|p| p.destination_hash == peer.destination_hash)
                {
                    peer.display_name = prev.display_name.clone();
                }
            }
            peer
        })
        .collect();
    *cache = merged.clone();
    merged
}

/// Apply a live path-table fetch: update cache only when non-empty; otherwise keep last known peers.
fn merge_live_peer_fetch(
    cache: &mut Vec<PeerRow>,
    fetched: Result<Vec<PeerRow>, String>,
) -> Vec<PeerRow> {
    match fetched {
        Ok(peers) if !peers.is_empty() => sync_live_peer_cache(cache, peers),
        Ok(_) => {
            tracing::debug!("live fetch_peers returned empty path table, using cache");
            cache.clone()
        }
        Err(e) => {
            tracing::debug!("live fetch_peers failed: {e}");
            cache.clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::broadcast;
    use uuid::Uuid;

    fn temp_stack_dirs() -> (PathBuf, PathBuf) {
        let id = Uuid::new_v4();
        let config = std::env::temp_dir().join(format!("mesh_reticulum_cfg_{id}"));
        let storage = std::env::temp_dir().join(format!("mesh_reticulum_store_{id}"));
        std::fs::create_dir_all(&config).expect("config dir");
        std::fs::create_dir_all(&storage).expect("storage dir");
        (config, storage)
    }

    #[test]
    fn merge_live_peer_fetch_preserves_cache_on_empty_or_error() {
        let mut cache = vec![PeerRow {
            destination_hash: "abc".into(),
            display_name: None,
            hops: Some(1),
            last_seen: None,
            interface: None,
            path_hash: None,
        }];
        let empty = merge_live_peer_fetch(&mut cache, Ok(vec![]));
        assert_eq!(empty.len(), 1);
        assert_eq!(cache.len(), 1);

        let err = merge_live_peer_fetch(&mut cache, Err("path table query unavailable".into()));
        assert_eq!(err.len(), 1);
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn merge_live_peer_fetch_replaces_cache_when_non_empty() {
        let mut cache = Vec::new();
        let row = PeerRow {
            destination_hash: "deadbeef".into(),
            display_name: Some("peer".into()),
            hops: Some(2),
            last_seen: Some(1),
            interface: Some("tcp".into()),
            path_hash: None,
        };
        let fetched = merge_live_peer_fetch(&mut cache, Ok(vec![row.clone()]));
        assert_eq!(fetched.len(), 1);
        assert_eq!(cache.len(), 1);
        assert_eq!(cache[0].destination_hash, row.destination_hash);
    }

    #[test]
    fn sync_live_peer_cache_replaces_including_empty() {
        let mut cache = vec![PeerRow {
            destination_hash: "abc".into(),
            display_name: None,
            hops: Some(1),
            last_seen: None,
            interface: None,
            path_hash: None,
        }];
        let fetched = sync_live_peer_cache(&mut cache, vec![]);
        assert!(fetched.is_empty());
        assert!(cache.is_empty());
    }

    #[test]
    fn sync_live_peer_cache_updates_non_empty() {
        let mut cache = Vec::new();
        let row = PeerRow {
            destination_hash: "deadbeef".into(),
            display_name: Some("peer".into()),
            hops: Some(2),
            last_seen: Some(1),
            interface: Some("tcp".into()),
            path_hash: None,
        };
        let fetched = sync_live_peer_cache(&mut cache, vec![row.clone()]);
        assert_eq!(fetched.len(), 1);
        assert_eq!(cache.len(), 1);
        assert_eq!(cache[0].destination_hash, row.destination_hash);
    }

    #[tokio::test]
    async fn list_peers_stub_empty_after_clear_announces() {
        let (config_dir, storage_dir) = temp_stack_dirs();
        let (tx, _) = broadcast::channel(8);
        let handle = StackHandle::bootstrap(config_dir.clone(), storage_dir.clone(), tx).await;
        handle.clear_announces().await.expect("clear announces");
        assert!(handle.list_peers().await.is_empty());
        let _ = std::fs::remove_dir_all(config_dir);
        let _ = std::fs::remove_dir_all(storage_dir);
    }
}

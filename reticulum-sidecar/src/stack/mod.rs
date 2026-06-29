//! Persistent stack state + optional live RNS/LXMF bridge.

mod persistence;
mod types;

#[cfg(feature = "rns-stack")]
mod live;

use std::path::PathBuf;
use std::sync::Arc;

use persistence::PersistedState;
use tokio::sync::{broadcast, RwLock};

pub use types::{
    AddInterfaceRequest, ContactRow, InterfaceRow, LxmfReactionRequest, LxmfSendRequest, PeerRow,
    PropagationRow, StackIdentity,
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
        let mut persisted = PersistedState::load(&config_dir, &storage_dir);
        persisted.ensure_defaults();

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

    pub async fn identity_generate(&self, display_name: Option<String>) -> Result<StackIdentity, String> {
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

    pub async fn identity_export_backup(&self, passphrase: &str) -> Result<serde_json::Value, String> {
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
        self.inner.read().await.interfaces.clone()
    }

    pub async fn add_interface(&self, req: AddInterfaceRequest) -> Result<InterfaceRow, String> {
        let mut inner = self.inner.write().await;
        let row = inner.add_interface(req)?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        drop(inner);
        self.emit_event("interface.state", serde_json::json!({ "action": "added" }));
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            let _ = live.apply_interfaces(self).await;
        }
        Ok(row)
    }

    pub async fn set_interface_enabled(&self, id: &str, enabled: bool) -> Result<(), String> {
        let mut inner = self.inner.write().await;
        inner.set_interface_enabled(id, enabled)?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        drop(inner);
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

    pub async fn lxmf_reaction(&self, req: LxmfReactionRequest) -> Result<serde_json::Value, String> {
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
        serde_json::json!({ "ports": [] })
    }

    pub async fn ble_availability(&self) -> serde_json::Value {
        serde_json::json!({
            "available": cfg!(feature = "rns-ble"),
            "missing": [],
            "permissions_granted": true,
            "probe_failed": false
        })
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

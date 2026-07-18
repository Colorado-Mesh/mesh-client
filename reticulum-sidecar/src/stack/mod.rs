//! Persistent stack state + optional live RNS/LXMF bridge.

mod ble;
pub mod config;
pub mod config_audit;
mod identity_apply;
mod identity_import;
mod identity_slots;
mod local_rnode_primary;
mod nomad_content_source;
mod nomad_file;
mod nomad_link_errors;
#[cfg(feature = "rns-stack")]
mod nomad_request_payload;
mod nomad_timeouts;
mod packet_log;
mod path_speed;
mod persistence;
pub mod rf_profiles;
mod rmap_discovery;
mod rrc_codec;
mod rrc_defaults;
mod topology;
mod types;
mod via;

#[cfg(feature = "rns-stack")]
mod link_task;
#[cfg(feature = "rns-stack")]
mod live;
#[cfg(feature = "rns-stack")]
mod lxmf_delivery;
#[cfg(feature = "rns-stack")]
mod nomad_server;
#[cfg(feature = "rns-stack")]
mod propagation_bridge;
#[cfg(feature = "rns-stack")]
mod rncp_transfer;
#[cfg(feature = "rns-stack")]
mod rnsh_session;
#[cfg(feature = "rns-stack")]
mod rrc_link;
#[cfg(feature = "rns-stack")]
mod rrc_session;

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

pub use config::{ImportMode, ImportResult, StackSettings, UpdateInterfacePatch};
use packet_log::{MAX_WIRE_PACKET_LOG, PacketLogBuffer, WirePacketRow};
use persistence::PersistedState;
use tokio::sync::{Mutex, RwLock, broadcast};
pub use types::{
    AddInterfaceRequest, ContactRow, InterfaceRow, LxmfReactionRequest, LxmfSendRequest,
    NomadNodeRow, NomadServingStatus, PeerRow, RrcHubRow, StackIdentity,
};

#[cfg(not(feature = "rns-stack"))]
const NOMAD_REQUIRES_STACK: &str = "Nomad serving requires an rns-stack sidecar build";
const NOMAD_DISPLAY_NAME_MAX_CHARS: usize = 128;

/// Trim, reject control characters, and cap length for announce/UI display names.
fn sanitize_nomad_display_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.chars().any(char::is_control) {
        return Err("display_name_invalid".into());
    }
    if trimmed.chars().count() > NOMAD_DISPLAY_NAME_MAX_CHARS {
        return Err("display_name_too_long".into());
    }
    Ok(trimmed.to_string())
}

pub struct StackHandle {
    pub config_dir: PathBuf,
    pub storage_dir: PathBuf,
    inner: Arc<RwLock<PersistedState>>,
    event_tx: broadcast::Sender<String>,
    packet_log: Arc<PacketLogBuffer>,
    /// When true, `list_contacts` must retry persisting contact name overlays after a prior save failure.
    contact_name_persist_dirty: std::sync::atomic::AtomicBool,
    /// Serializes create / switch / delete so on-disk slot state cannot interleave.
    identity_op_lock: Mutex<()>,
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

        if let Err(e) = config::ensure_discover_interfaces_enabled(&config_dir) {
            tracing::warn!("failed to enable discover_interfaces in config: {e}");
        }

        if let Err(e) = config::ensure_announce_interval_sec_default(&config_dir) {
            tracing::warn!("failed to set default announce_interval_sec in config: {e}");
        }

        if let Err(e) = config::ensure_share_instance_defaults(&config_dir) {
            tracing::warn!("failed to set share_instance / instance_name defaults: {e}");
        }

        match config::ensure_decommissioned_hubs_disabled(&config_dir) {
            Ok(disabled) if !disabled.is_empty() => {
                tracing::info!(
                    "disabled decommissioned testnet hubs: {}",
                    disabled.join(", ")
                );
            }
            Ok(_) => {}
            Err(e) => {
                tracing::warn!("failed to disable decommissioned testnet hubs: {e}");
            }
        }

        if let Err(e) = config::repair_rnode_radio_fields_in_config(&config_dir) {
            tracing::warn!("failed to repair RNode radio fields in config: {e}");
        }

        let mut persisted = PersistedState::load(&config_dir, &storage_dir);
        persisted.ensure_defaults();
        if let Ok(ifaces) = config::interfaces_from_config_dir(&config_dir) {
            persisted.interfaces = ifaces;
        }

        #[cfg(feature = "rns-stack")]
        {
            if let Err(e) = identity_slots::ensure_slot_layout(&config_dir) {
                tracing::warn!("identity slot layout on bootstrap failed: {e}");
            }
            if let Err(e) = identity_apply::reconcile_persisted_identity_from_file(
                &mut persisted,
                &config_dir,
                &storage_dir,
            ) {
                tracing::warn!("identity reconcile on bootstrap failed: {e}");
            }
            if persisted.identity.configured {
                if let Err(e) = identity_slots::sync_active_slot_from_working(
                    &config_dir,
                    persisted.identity.display_name.as_deref(),
                    Some(persisted.identity.identity_hash.as_str()),
                    Some(persisted.identity.lxmf_hash.as_str()),
                ) {
                    tracing::warn!("identity slot sync on bootstrap failed: {e}");
                }
            }
        }

        let inner = Arc::new(RwLock::new(persisted));

        #[cfg(feature = "rns-stack")]
        let packet_log = Arc::new(PacketLogBuffer::new(MAX_WIRE_PACKET_LOG));
        #[cfg(feature = "rns-stack")]
        let live = match live::LiveBridge::spawn(
            config_dir.clone(),
            storage_dir.clone(),
            event_tx.clone(),
            packet_log.clone(),
            inner.clone(),
        )
        .await
        {
            Ok(bridge) => {
                let bridge = Arc::new(bridge);
                {
                    let mut inner_guard = inner.write().await;
                    if let Err(e) = identity_apply::reconcile_persisted_identity_from_file(
                        &mut inner_guard,
                        &config_dir,
                        &storage_dir,
                    ) {
                        tracing::warn!("identity reconcile after live spawn failed: {e}");
                    }
                }
                Some(bridge)
            }
            Err(e) => {
                tracing::warn!("live RNS bridge unavailable, using local stack: {e}");
                None
            }
        };

        #[cfg(feature = "rns-stack")]
        let handle = Self {
            config_dir,
            storage_dir,
            inner,
            event_tx: event_tx.clone(),
            packet_log,
            contact_name_persist_dirty: std::sync::atomic::AtomicBool::new(false),
            identity_op_lock: Mutex::new(()),
            live,
        };
        #[cfg(not(feature = "rns-stack"))]
        let handle = Self {
            config_dir,
            storage_dir,
            inner,
            event_tx,
            packet_log: Arc::new(PacketLogBuffer::new(MAX_WIRE_PACKET_LOG)),
            contact_name_persist_dirty: std::sync::atomic::AtomicBool::new(false),
            identity_op_lock: Mutex::new(()),
        };
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &handle.live {
            live.register_nomad_announce_handler(
                handle.inner.clone(),
                handle.config_dir.clone(),
                handle.storage_dir.clone(),
            );
            live.register_rrc_announce_handler(
                handle.inner.clone(),
                handle.config_dir.clone(),
                handle.storage_dir.clone(),
            );
            live.register_lxmf_identity_announce_handler();
            live.register_rmap_discovery_watcher(event_tx.clone());
        }
        handle.emit_stats().await;
        handle
    }

    #[allow(clippy::needless_pass_by_value)] // payload is moved into the broadcast frame
    fn emit_event(&self, event_type: &str, payload: serde_json::Value) {
        let msg = serde_json::json!({ "type": event_type, "payload": payload });
        let _ = self.event_tx.send(msg.to_string());
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<String> {
        self.event_tx.subscribe()
    }

    pub fn list_packets(&self, limit: usize) -> Vec<WirePacketRow> {
        self.packet_log.snapshot(limit)
    }

    pub fn clear_packets(&self) {
        self.packet_log.clear();
    }

    async fn sync_interfaces_from_config(&self) {
        if let Ok(ifaces) = config::interfaces_from_config_dir(&self.config_dir) {
            let mut inner = self.inner.write().await;
            inner.interfaces = ifaces;
            drop(inner);
        }
        if let Err(e) = self.ensure_primary_local_serial_order().await {
            tracing::warn!("primary local serial order sync failed: {e}");
        }
    }

    async fn ensure_primary_local_serial_order(&self) -> Result<(), String> {
        let interfaces = match config::interfaces_from_config_dir(&self.config_dir) {
            Ok(rows) => rows,
            Err(e) => return Err(e),
        };
        let stored = {
            let inner = self.inner.read().await;
            inner.primary_local_serial_interface_id.clone()
        };
        let effective = local_rnode_primary::resolve_effective_primary_local_serial_interface_id(
            &interfaces,
            stored.as_deref(),
        );
        if let Some(effective_id) = effective {
            if let Err(e) = local_rnode_primary::ensure_primary_local_serial_order(
                &self.config_dir,
                &effective_id,
            ) {
                tracing::warn!(
                    interface_id = %effective_id,
                    "primary local serial reorder failed: {e}"
                );
            }
        }
        Ok(())
    }

    async fn reconcile_primary_after_interface_change(&self) {
        let Ok(interfaces) = config::interfaces_from_config_dir(&self.config_dir) else {
            return;
        };
        let stored = {
            let inner = self.inner.read().await;
            inner.primary_local_serial_interface_id.clone()
        };
        let effective = local_rnode_primary::resolve_effective_primary_local_serial_interface_id(
            &interfaces,
            stored.as_deref(),
        );
        let mut inner = self.inner.write().await;
        inner.primary_local_serial_interface_id = effective.clone();
        if let Err(e) = inner.save(&self.config_dir, &self.storage_dir) {
            tracing::warn!("failed to save stack config after primary reconcile: {e}");
        }
        drop(inner);
        if let Some(effective_id) = effective {
            if let Err(e) = local_rnode_primary::ensure_primary_local_serial_order(
                &self.config_dir,
                &effective_id,
            ) {
                tracing::warn!(
                    interface_id = %effective_id,
                    "primary local serial reorder failed: {e}"
                );
            }
        }
    }

    pub async fn primary_local_serial_interface_ids(&self) -> (Option<String>, Option<String>) {
        let interfaces = match config::interfaces_from_config_dir(&self.config_dir) {
            Ok(rows) => rows,
            Err(_) => self.inner.read().await.interfaces.clone(),
        };
        let stored = self
            .inner
            .read()
            .await
            .primary_local_serial_interface_id
            .clone();
        let effective = local_rnode_primary::resolve_effective_primary_local_serial_interface_id(
            &interfaces,
            stored.as_deref(),
        );
        (stored, effective)
    }

    /// Public API for outbound transport resolution from enabled interfaces.
    #[allow(dead_code)] // renderer IPC may call before all call sites are wired
    pub async fn resolve_outbound_sent_via_for_interfaces(
        &self,
        interfaces: &[InterfaceRow],
    ) -> &'static str {
        let (_, effective) = self.primary_local_serial_interface_ids().await;
        via::resolve_outbound_sent_via_with_primary(interfaces, effective.as_deref())
    }

    pub async fn set_primary_local_serial_interface(
        &self,
        id: &str,
    ) -> Result<(bool, Option<String>), String> {
        let interfaces = match config::interfaces_from_config_dir(&self.config_dir) {
            Ok(rows) => rows,
            Err(e) => return Err(e),
        };
        let row = interfaces
            .iter()
            .find(|row| row.id == id)
            .ok_or_else(|| format!("interface not found: {id}"))?;
        if !row.enabled {
            return Err("primary interface must be enabled".into());
        }
        if !local_rnode_primary::is_locally_connected_serial_interface(row) {
            return Err("interface is not a locally connected serial interface".into());
        }
        let reordered =
            local_rnode_primary::reorder_primary_local_serial_interface(&self.config_dir, id)?;
        {
            let mut inner = self.inner.write().await;
            inner.primary_local_serial_interface_id = Some(id.to_string());
            inner.save(&self.config_dir, &self.storage_dir)?;
        }
        self.sync_interfaces_from_config().await;
        Ok((reordered, Some(id.to_string())))
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
        #[cfg(feature = "rns-stack")]
        {
            let mut inner = self.inner.write().await;
            if let Err(e) = identity_apply::reconcile_persisted_identity_from_file(
                &mut inner,
                &self.config_dir,
                &self.storage_dir,
            ) {
                tracing::debug!("identity status reconcile skipped: {e}");
            }
            inner.identity.clone()
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            self.inner.read().await.identity.clone()
        }
    }

    async fn ensure_identity_replace_allowed(&self, replace: bool) -> Result<(), String> {
        let configured = self.inner.read().await.identity.configured;
        if configured && !replace {
            return Err("identity_already_configured".into());
        }
        Ok(())
    }

    pub async fn identity_generate(
        &self,
        display_name: Option<String>,
        replace: bool,
    ) -> Result<StackIdentity, String> {
        identity_apply::identity_requires_rns_stack()?;
        self.ensure_identity_replace_allowed(replace).await?;
        #[cfg(feature = "rns-stack")]
        {
            let (rns_identity, mnemonic) = identity_apply::generate_identity_with_mnemonic()?;
            let mut inner = self.inner.write().await;
            let identity = identity_apply::apply_unified_identity(
                &mut inner,
                &self.config_dir,
                &self.storage_dir,
                &rns_identity,
                display_name,
                Some(mnemonic),
            )?;
            drop(inner);
            self.maybe_emit_identity_restart();
            Ok(identity)
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            Err("identity operations require an rns-stack sidecar build".into())
        }
    }

    pub async fn identity_import(
        &self,
        mnemonic: &str,
        display_name: Option<String>,
        replace: bool,
    ) -> Result<StackIdentity, String> {
        identity_apply::identity_requires_rns_stack()?;
        self.ensure_identity_replace_allowed(replace).await?;
        #[cfg(feature = "rns-stack")]
        {
            let (rns_identity, normalized) = identity_apply::identity_from_mnemonic(mnemonic)?;
            let mut inner = self.inner.write().await;
            let identity = identity_apply::apply_unified_identity(
                &mut inner,
                &self.config_dir,
                &self.storage_dir,
                &rns_identity,
                display_name,
                Some(normalized),
            )?;
            drop(inner);
            self.maybe_emit_identity_restart();
            Ok(identity)
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            Err("identity operations require an rns-stack sidecar build".into())
        }
    }

    pub async fn identity_import_private(
        &self,
        private_key: &str,
        display_name: Option<String>,
        replace: bool,
    ) -> Result<StackIdentity, String> {
        identity_apply::identity_requires_rns_stack()?;
        self.ensure_identity_replace_allowed(replace).await?;
        #[cfg(feature = "rns-stack")]
        {
            let bytes = identity_import::decode_private_key_input(private_key)?;
            let rns_identity = identity_apply::identity_from_private_bytes(&bytes)?;
            let mut inner = self.inner.write().await;
            let identity = identity_apply::apply_unified_identity(
                &mut inner,
                &self.config_dir,
                &self.storage_dir,
                &rns_identity,
                display_name,
                None,
            )?;
            drop(inner);
            self.maybe_emit_identity_restart();
            Ok(identity)
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            Err("identity operations require an rns-stack sidecar build".into())
        }
    }

    /// Binary private-key import (file picker / IPC).
    #[allow(dead_code)] // public identity API; not all builds expose the route yet
    pub async fn identity_import_private_bytes(
        &self,
        bytes: &[u8],
        display_name: Option<String>,
        replace: bool,
    ) -> Result<StackIdentity, String> {
        identity_apply::identity_requires_rns_stack()?;
        self.ensure_identity_replace_allowed(replace).await?;
        #[cfg(feature = "rns-stack")]
        {
            let key = identity_import::decode_private_key_bytes(bytes)?;
            let rns_identity = identity_apply::identity_from_private_bytes(&key)?;
            let mut inner = self.inner.write().await;
            let identity = identity_apply::apply_unified_identity(
                &mut inner,
                &self.config_dir,
                &self.storage_dir,
                &rns_identity,
                display_name,
                None,
            )?;
            drop(inner);
            self.maybe_emit_identity_restart();
            Ok(identity)
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            Err("identity operations require an rns-stack sidecar build".into())
        }
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
        display_name: Option<String>,
        replace: bool,
    ) -> Result<StackIdentity, String> {
        if self.inner.read().await.identity.configured && !replace {
            return Err("identity_already_configured".into());
        }

        let format = backup.get("format").and_then(|v| v.as_str()).unwrap_or("");
        if format != "mesh-client.identity.v1" && format != "ratspeak.identity.v2" {
            return Err("unsupported backup format".into());
        }
        let backup_identity_hash = backup
            .get("identity_hash")
            .and_then(|v| v.as_str())
            .ok_or("missing identity_hash")?;
        let backup_lxmf_hash = backup
            .get("lxmf_hash")
            .and_then(|v| v.as_str())
            .ok_or("missing lxmf_hash")?;

        #[cfg(feature = "rns-stack")]
        if identity_apply::backup_conflicts_with_file(
            &self.config_dir,
            backup_identity_hash,
            backup_lxmf_hash,
        )? {
            return Err("backup_hash_mismatch_with_identity_file".into());
        }

        let mut inner = self.inner.write().await;
        let mut identity = inner.import_identity_backup(backup, passphrase)?;
        if let Some(name) = display_name {
            identity.display_name = Some(name.clone());
            inner.identity.display_name = Some(name);
        }
        inner.save(&self.config_dir, &self.storage_dir)?;
        drop(inner);
        self.maybe_emit_identity_restart();
        Ok(identity)
    }

    pub async fn set_display_name(&self, name: &str) -> Result<(), String> {
        let mut inner = self.inner.write().await;
        inner.identity.display_name = Some(name.to_string());
        inner.save(&self.config_dir, &self.storage_dir)?;
        let active = identity_slots::read_active_id(&self.config_dir);
        let _ = identity_slots::write_slot_meta(
            &self.config_dir,
            &active,
            Some(name),
            if inner.identity.configured {
                Some(inner.identity.identity_hash.as_str())
            } else {
                None
            },
            if inner.identity.configured {
                Some(inner.identity.lxmf_hash.as_str())
            } else {
                None
            },
        );
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
        self.reconcile_primary_after_interface_change().await;
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
        self.reconcile_primary_after_interface_change().await;
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

    #[allow(clippy::unused_async)] // async matches StackHandle settings API awaited by HTTP handlers
    pub async fn set_stack_settings(&self, settings: &StackSettings) -> Result<(), String> {
        config::set_stack_settings(&self.config_dir, settings)
    }

    pub async fn list_contacts(&self) -> Vec<ContactRow> {
        #[cfg(feature = "rns-stack")]
        let announce_labels = self
            .live
            .as_ref()
            .map(|live| live.display_name_snapshot())
            .unwrap_or_default();
        #[cfg(not(feature = "rns-stack"))]
        let announce_labels: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();

        let mut inner = self.inner.write().await;
        let mut name_by_hash =
            topology::build_topology_name_map(&inner.peers, &[], &inner.nomad_nodes);
        topology::extend_name_map_with_announce_labels(&mut name_by_hash, &announce_labels);
        let changed = topology::overlay_contact_display_names(&mut inner.contacts, &name_by_hash);
        if changed > 0 {
            self.contact_name_persist_dirty
                .store(true, std::sync::atomic::Ordering::Relaxed);
        }
        // Failure point: contacts.json write fails after in-memory overlay. Fallback: keep
        // overlay for this process and retry persist on the next list_contacts call.
        if self
            .contact_name_persist_dirty
            .load(std::sync::atomic::Ordering::Relaxed)
        {
            match inner.save(&self.config_dir, &self.storage_dir) {
                Ok(()) => self
                    .contact_name_persist_dirty
                    .store(false, std::sync::atomic::Ordering::Relaxed),
                Err(e) => {
                    tracing::warn!("contact name persist after list_contacts failed: {e}");
                }
            }
        }
        inner.contacts.clone()
    }

    pub async fn clear_contacts(&self) -> Result<usize, String> {
        let mut inner = self.inner.write().await;
        let cleared = inner.contacts.len();
        // Announced / messaged destinations often live only in contacts; demote them to
        // peers so Clear Contacts does not empty the Peers tab.
        inner.demote_contacts_to_peers();
        inner.clear_contacts();
        inner.save(&self.config_dir, &self.storage_dir)?;
        self.emit_event(
            "contacts_updated",
            serde_json::json!({ "cleared": cleared }),
        );
        self.emit_event(
            "peers_updated",
            serde_json::json!({ "demoted_from_contacts": cleared }),
        );
        Ok(cleared)
    }

    /// List path-table peers. When `force_refresh` is true, always query live transport;
    /// otherwise the live bridge may serve a short-TTL maintained cache.
    pub async fn list_peers(&self) -> Vec<PeerRow> {
        self.list_peers_with_refresh(false).await
    }

    pub async fn list_peers_with_refresh(&self, force_refresh: bool) -> Vec<PeerRow> {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            let announce_labels = live.display_name_snapshot();
            let fetched = live.fetch_peers(force_refresh).await;
            let mut inner = self.inner.write().await;
            let mut peers = merge_live_peer_fetch(&mut inner.peers, fetched);
            let mut name_by_hash = topology::build_topology_name_map(
                &inner.peers,
                &inner.contacts,
                &inner.nomad_nodes,
            );
            topology::extend_name_map_with_announce_labels(&mut name_by_hash, &announce_labels);
            topology::overlay_peer_display_names(&mut peers, &name_by_hash);
            return peers;
        }
        let _ = force_refresh;
        let inner = self.inner.read().await;
        let mut peers = inner.peers.clone();
        let name_by_hash =
            topology::build_topology_name_map(&inner.peers, &inner.contacts, &inner.nomad_nodes);
        topology::overlay_peer_display_names(&mut peers, &name_by_hash);
        peers
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
        #[cfg(feature = "rns-stack")]
        let local_stats = if let Some(live) = &self.live {
            let (count, bytes) = live.propagation_local_stats();
            let serving = live.propagation_is_local_serving();
            Some((count, bytes, serving, live.propagation_local_hash()))
        } else {
            None
        };
        let propagation: Vec<serde_json::Value> = inner
            .propagation
            .iter()
            .map(|p| {
                let preferred = preferred_id.as_deref() == Some(p.id.as_str());
                let mut row = serde_json::json!({
                    "id": p.id,
                    "name": p.name,
                    "hops": p.hops,
                    "enabled": p.enabled,
                    "status": p.status,
                    "preferred": preferred,
                    "destination_hash": p.destination_hash,
                });
                #[cfg(feature = "rns-stack")]
                if p.id == "local-prop" {
                    if let Some((count, bytes, serving, hash)) = &local_stats {
                        if let Some(obj) = row.as_object_mut() {
                            obj.insert(
                                "message_count".into(),
                                serde_json::Value::Number((*count).into()),
                            );
                            obj.insert(
                                "storage_bytes".into(),
                                serde_json::Value::Number((*bytes).into()),
                            );
                            obj.insert("enabled".into(), serde_json::Value::Bool(*serving));
                            obj.insert(
                                "status".into(),
                                if *serving {
                                    serde_json::Value::String("active".into())
                                } else {
                                    serde_json::Value::String("idle".into())
                                },
                            );
                            obj.insert(
                                "destination_hash".into(),
                                serde_json::Value::String(hash.clone()),
                            );
                        }
                    }
                }
                row
            })
            .collect();
        serde_json::json!({
            "propagation": propagation,
            "preferred_id": preferred_id,
            "auto_sync_interval_sec": auto_sync_interval_sec,
        })
    }

    pub async fn set_preferred_propagation(&self, id: &str) -> Result<(), String> {
        let prop_hash = {
            let mut inner = self.inner.write().await;
            inner.set_preferred_propagation(id)?;
            let hash = inner
                .propagation
                .iter()
                .find(|p| p.id == id)
                .and_then(|p| p.destination_hash.clone());
            inner.save(&self.config_dir, &self.storage_dir)?;
            hash
        };
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            live.set_outbound_propagation_node(prop_hash.as_deref())
                .await;
        }
        Ok(())
    }

    pub async fn set_propagation_auto_sync_interval(&self, sec: u32) -> Result<(), String> {
        let mut inner = self.inner.write().await;
        inner.set_auto_sync_interval_sec(sec);
        inner.save(&self.config_dir, &self.storage_dir)?;
        Ok(())
    }

    pub async fn start_propagation_sync(&self, propagation_id: &str) -> Result<(), String> {
        let prop_hash = {
            let inner = self.inner.read().await;
            inner
                .propagation
                .iter()
                .find(|p| p.id == propagation_id)
                .and_then(|p| p.destination_hash.clone())
                .ok_or_else(|| format!("propagation node not found: {propagation_id}"))?
        };
        let lxmf = {
            let inner = self.inner.read().await;
            inner.identity.lxmf_hash.clone()
        };
        let is_local = propagation_id == "local-prop";
        let local_prop_hash = {
            #[cfg(feature = "rns-stack")]
            {
                self.live
                    .as_ref()
                    .map(|live| live.propagation_local_hash())
                    .unwrap_or_default()
            }
            #[cfg(not(feature = "rns-stack"))]
            {
                String::new()
            }
        };
        let sync_self = is_local
            || prop_hash.eq_ignore_ascii_case(&lxmf)
            || (!local_prop_hash.is_empty() && prop_hash.eq_ignore_ascii_case(&local_prop_hash));
        // Local inbox lives in this process — settle without a self LinkRequest.
        if is_local {
            self.emit_event(
                "propagation_sync",
                serde_json::json!({
                    "active": false,
                    "progress": 100.0,
                    "message": null,
                }),
            );
            return Ok(());
        }
        // Remote row pointing at our own hashes would still try a self-link.
        if sync_self {
            return Err("LOCAL_PROPAGATION_SYNC_UNSUPPORTED".into());
        }
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            live.start_propagation_sync(&prop_hash).await?;
            return Ok(());
        }
        let mut inner = self.inner.write().await;
        inner.start_propagation_sync(propagation_id)?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        self.emit_event("propagation_sync", inner.propagation_sync.clone());
        Ok(())
    }

    pub async fn cancel_propagation_sync(&self) -> Result<(), String> {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            live.cancel_propagation_sync().await;
            return Ok(());
        }
        let mut inner = self.inner.write().await;
        inner.cancel_propagation_sync();
        inner.save(&self.config_dir, &self.storage_dir)?;
        self.emit_event("propagation_sync", inner.propagation_sync.clone());
        Ok(())
    }

    pub async fn set_propagation_enabled(&self, id: &str, enabled: bool) -> Result<(), String> {
        if id == "local-prop" {
            #[cfg(feature = "rns-stack")]
            if let Some(live) = &self.live {
                live.set_local_propagation_serving(enabled).await;
            }
        }
        let mut inner = self.inner.write().await;
        inner.set_propagation_enabled(id, enabled)?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        Ok(())
    }

    pub async fn add_propagation_node(
        &self,
        destination_hash: &str,
        name: Option<String>,
    ) -> Result<serde_json::Value, String> {
        let mut inner = self.inner.write().await;
        let row = inner.add_propagation_node(destination_hash, name)?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        Ok(serde_json::json!({ "ok": true, "node": row }))
    }

    pub async fn remove_propagation_node(&self, id: &str) -> Result<(), String> {
        // Live sync tracks progress in PropagationBridge, not persisted flags — always
        // cancel before mutating so RF/`/offer` work cannot outlive a deleted node.
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            live.cancel_propagation_sync().await;
            self.emit_event(
                "propagation_sync",
                serde_json::json!({
                    "active": false,
                    "progress": 0.0,
                    "message": "propagation sync cancelled",
                }),
            );
        }
        let cleared_preferred = {
            let mut inner = self.inner.write().await;
            let was_preferred = inner.preferred_propagation_id.as_deref() == Some(id);
            // Snapshot for rollback if durable save fails after in-memory mutate.
            let snapshot = serde_json::to_value(&*inner).ok();
            inner.remove_propagation_node(id)?;
            if let Err(e) = inner.save(&self.config_dir, &self.storage_dir) {
                if let Some(snap) = snapshot {
                    if let Ok(restored) = serde_json::from_value::<PersistedState>(snap) {
                        *inner = restored;
                    }
                }
                return Err(e);
            }
            was_preferred
        };
        if cleared_preferred {
            #[cfg(feature = "rns-stack")]
            if let Some(live) = &self.live {
                live.set_outbound_propagation_node(None).await;
            }
        }
        Ok(())
    }

    pub async fn rename_propagation_node(&self, id: &str, name: &str) -> Result<(), String> {
        let mut inner = self.inner.write().await;
        let snapshot = serde_json::to_value(&*inner).ok();
        inner.rename_propagation_node(id, name)?;
        if let Err(e) = inner.save(&self.config_dir, &self.storage_dir) {
            if let Some(snap) = snapshot {
                if let Ok(restored) = serde_json::from_value::<PersistedState>(snap) {
                    *inner = restored;
                }
            }
            return Err(e);
        }
        Ok(())
    }

    pub async fn ping_destination(
        &self,
        destination_hash: &str,
    ) -> Result<serde_json::Value, String> {
        let started = std::time::Instant::now();
        let probe = self.probe_peer(destination_hash).await?;
        let rtt_ms = started.elapsed().as_millis() as u64;
        let ok = probe
            .get("ok")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        Ok(serde_json::json!({ "ok": ok, "rtt_ms": rtt_ms }))
    }

    pub async fn list_rmap_discovered(&self) -> Vec<rmap_discovery::RmapDiscoveredWireRow> {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.fetch_rmap_discovered().await;
        }
        #[cfg(not(feature = "rns-stack"))]
        let _ = self;
        Vec::new()
    }

    pub async fn topology_snapshot(&self) -> serde_json::Value {
        let peers = self.list_peers().await;
        let (selected, total) =
            topology::select_peers_for_topology(&peers, topology::TOPOLOGY_PEER_CAP);
        let truncated = total > selected.len();
        let (mut nodes, edges) = topology::build_topology(&selected);
        let inner = self.inner.read().await;
        let mut name_by_hash =
            topology::build_topology_name_map(&inner.peers, &inner.contacts, &inner.nomad_nodes);
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            topology::extend_name_map_with_announce_labels(
                &mut name_by_hash,
                &live.display_name_snapshot(),
            );
        }
        topology::merge_topology_display_names(&mut nodes, &name_by_hash);
        serde_json::json!({
            "nodes": nodes,
            "edges": edges,
            "total": total,
            "shown": nodes.len(),
            "truncated": truncated,
        })
    }

    pub async fn clear_announces(&self) -> Result<(), String> {
        let mut inner = self.inner.write().await;
        inner.clear_peers();
        inner.save(&self.config_dir, &self.storage_dir)?;
        self.emit_event("peers_updated", serde_json::json!({ "cleared": true }));
        Ok(())
    }

    /// Send an LXMF delivery announce immediately (live stack only).
    pub async fn announce_now(&self) -> Result<(), String> {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.announce_lxmf_now().await;
        }
        #[cfg(feature = "rns-stack")]
        {
            Err("live RNS bridge unavailable; start stack with identity configured".into())
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            Err("announce requires an rns-stack sidecar build".into())
        }
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

    #[cfg(feature = "rns-stack")]
    fn require_live(&self) -> Result<&Arc<live::LiveBridge>, String> {
        self.live
            .as_ref()
            .ok_or_else(|| "Nomad serving requires a live RNS stack".into())
    }

    pub async fn nomad_serving_status(&self) -> NomadServingStatus {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.nomad_serving_status().await;
        }
        let inner = self.inner.read().await;
        NomadServingStatus {
            enabled: inner.nomad_serving_enabled,
            running: false,
            destination_hash: None,
            identity_hash: None,
            display_name: inner
                .nomad_serving_display_name
                .clone()
                .unwrap_or_else(|| "Nomad node".into()),
            page_count: 0,
            file_count: 0,
            stats: types::NomadServeStatsRow::default(),
            content_root: String::new(),
            content_source: inner.nomad_serving_content_source.clone(),
            content_layout: inner
                .nomad_serving_content_source
                .as_ref()
                .map(|_| "site_root".into()),
            watcher_status: Some("ok".into()),
            last_error: if inner.nomad_serving_content_source.is_none()
                && inner.nomad_serving_enabled
            {
                Some("content_source_required".into())
            } else {
                None
            },
        }
    }

    pub async fn set_nomad_content_source(
        &self,
        path: String,
    ) -> Result<NomadServingStatus, String> {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return Err("content_source_required".into());
        }
        #[cfg(feature = "rns-stack")]
        {
            let live = self.require_live()?;
            let path_buf = std::path::PathBuf::from(trimmed);
            let previous_source = {
                let inner = self.inner.read().await;
                inner.nomad_serving_content_source.clone()
            };
            // Validate before persisting.
            let resolved = live
                .nomad_server()
                .set_content_source_path(path_buf)
                .await?;
            {
                let mut inner = self.inner.write().await;
                inner.nomad_serving_content_source =
                    Some(resolved.content_source.display().to_string());
                if let Err(e) = inner.save(&self.config_dir, &self.storage_dir) {
                    // Roll back in-memory content source to match disk.
                    if let Some(prev) = previous_source.as_ref() {
                        let _ = live
                            .nomad_server()
                            .set_content_source_path(std::path::PathBuf::from(prev))
                            .await;
                    } else {
                        live.nomad_server().load_content_source_path(None).await;
                    }
                    return Err(e);
                }
            }
            // Restart host if running so the store opens under the new roots.
            if live.nomad_server().is_running().await {
                let name = {
                    let inner = self.inner.read().await;
                    inner
                        .nomad_serving_display_name
                        .clone()
                        .filter(|n| !n.trim().is_empty())
                        .unwrap_or_else(|| "Nomad node".into())
                };
                live.stop_nomad_serving().await?;
                if let Err(e) = live.start_nomad_serving(name).await {
                    // Restore previous content source preference after a failed restart.
                    if let Some(prev) = previous_source.as_ref() {
                        let _ = live
                            .nomad_server()
                            .set_content_source_path(std::path::PathBuf::from(prev))
                            .await;
                    } else {
                        live.nomad_server().load_content_source_path(None).await;
                    }
                    {
                        let mut inner = self.inner.write().await;
                        inner.nomad_serving_content_source = previous_source;
                        if let Err(save_err) = inner.save(&self.config_dir, &self.storage_dir) {
                            tracing::warn!(
                                "nomad content-source rollback persist failed: {save_err}"
                            );
                        }
                    }
                    return Err(e);
                }
            }
            return Ok(live.nomad_serving_status().await);
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            let _ = trimmed;
            Err(NOMAD_REQUIRES_STACK.into())
        }
    }

    pub async fn set_nomad_serving(
        &self,
        enabled: bool,
        display_name: Option<String>,
    ) -> Result<NomadServingStatus, String> {
        // Persist display-name preference immediately; persist `enabled` only after
        // start/stop succeeds so a failed start cannot leave a sticky enabled=true.
        {
            let mut inner = self.inner.write().await;
            if let Some(name) = display_name {
                let trimmed = sanitize_nomad_display_name(&name)?;
                if trimmed.is_empty() {
                    inner.nomad_serving_display_name = None;
                } else {
                    inner.nomad_serving_display_name = Some(trimmed);
                }
                inner.save(&self.config_dir, &self.storage_dir)?;
            }
        }

        #[cfg(feature = "rns-stack")]
        {
            let live = self.require_live()?;
            if enabled {
                let name = {
                    let inner = self.inner.read().await;
                    inner
                        .nomad_serving_display_name
                        .clone()
                        .filter(|n| !n.trim().is_empty())
                        .or_else(|| {
                            inner
                                .identity
                                .display_name
                                .clone()
                                .filter(|n| !n.trim().is_empty() && n != "Self")
                        })
                        .unwrap_or_else(|| "Nomad node".into())
                };
                if live.nomad_server().is_running().await {
                    live.nomad_server().set_display_name(&name).await;
                    if let Err(e) = live.nomad_server().announce_now().await {
                        tracing::warn!("nomad re-announce failed: {e}");
                    }
                } else {
                    live.start_nomad_serving(name).await?;
                }
                // Refresh local host row when already running (start path upserts on spawn).
                let status = live.nomad_serving_status().await;
                if let (Some(dest), Some(id_hash)) = (
                    status.destination_hash.as_ref(),
                    status.identity_hash.as_ref(),
                ) {
                    let mut inner = self.inner.write().await;
                    inner.upsert_nomad_node(
                        dest,
                        Some(id_hash.clone()),
                        Some(status.display_name.clone()),
                        Some(0),
                    );
                    if let Err(e) = inner.save(&self.config_dir, &self.storage_dir) {
                        tracing::warn!("nomad local host persist failed: {e}");
                    }
                }
            } else {
                // If stop fails, skip persisting enabled=false — leave sticky true
                // so restart can retry disable (mirrors enable-after-start-success).
                live.stop_nomad_serving().await?;
            }
            {
                let mut inner = self.inner.write().await;
                inner.nomad_serving_enabled = enabled;
                inner.save(&self.config_dir, &self.storage_dir)?;
            }
            return Ok(live.nomad_serving_status().await);
        }

        #[cfg(not(feature = "rns-stack"))]
        {
            if enabled {
                return Err(NOMAD_REQUIRES_STACK.into());
            }
            {
                let mut inner = self.inner.write().await;
                inner.nomad_serving_enabled = false;
                inner.save(&self.config_dir, &self.storage_dir)?;
            }
            Ok(self.nomad_serving_status().await)
        }
    }

    pub async fn list_nomad_serving_pages(&self) -> Result<Vec<serde_json::Value>, String> {
        #[cfg(feature = "rns-stack")]
        {
            let pages = self.require_live()?.nomad_server().list_pages().await?;
            Ok(pages.into_iter().map(|e| serving_entry_json(&e)).collect())
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            Err(NOMAD_REQUIRES_STACK.into())
        }
    }

    pub async fn read_nomad_serving_page(&self, path: &str) -> Result<String, String> {
        #[cfg(feature = "rns-stack")]
        {
            return self.require_live()?.nomad_server().read_page(path).await;
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            let _ = path;
            Err(NOMAD_REQUIRES_STACK.into())
        }
    }

    pub async fn write_nomad_serving_page(&self, path: &str, content: &str) -> Result<(), String> {
        #[cfg(feature = "rns-stack")]
        {
            return self
                .require_live()?
                .nomad_server()
                .write_page(path, content)
                .await;
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            let _ = (path, content);
            Err(NOMAD_REQUIRES_STACK.into())
        }
    }

    pub async fn delete_nomad_serving_page(&self, path: &str) -> Result<(), String> {
        #[cfg(feature = "rns-stack")]
        {
            return self.require_live()?.nomad_server().delete_page(path).await;
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            let _ = path;
            Err(NOMAD_REQUIRES_STACK.into())
        }
    }

    pub async fn list_nomad_serving_files(&self) -> Result<Vec<serde_json::Value>, String> {
        #[cfg(feature = "rns-stack")]
        {
            let files = self.require_live()?.nomad_server().list_files().await?;
            Ok(files.into_iter().map(|e| serving_entry_json(&e)).collect())
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            Err(NOMAD_REQUIRES_STACK.into())
        }
    }

    pub async fn write_nomad_serving_file(
        &self,
        path: &str,
        content_base64: &str,
    ) -> Result<(), String> {
        #[cfg(feature = "rns-stack")]
        {
            return self
                .require_live()?
                .nomad_server()
                .write_file_base64(path, content_base64)
                .await;
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            let _ = (path, content_base64);
            Err(NOMAD_REQUIRES_STACK.into())
        }
    }

    pub async fn delete_nomad_serving_file(&self, path: &str) -> Result<(), String> {
        #[cfg(feature = "rns-stack")]
        {
            return self.require_live()?.nomad_server().delete_file(path).await;
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            let _ = path;
            Err(NOMAD_REQUIRES_STACK.into())
        }
    }

    pub async fn list_rrc_hubs(&self) -> Vec<RrcHubRow> {
        let mut inner = self.inner.write().await;
        inner.seed_rrc_default_hubs();
        inner.rrc_hubs.clone()
    }

    pub async fn upsert_rrc_hub(
        &self,
        hash: &str,
        label: Option<String>,
        favorited: Option<bool>,
    ) -> Result<RrcHubRow, String> {
        let clean = hash.trim().to_lowercase().replace(':', "");
        if clean.len() != 32 || !clean.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("dest_hash must be 32 hex characters".into());
        }
        let mut inner = self.inner.write().await;
        inner.upsert_rrc_hub_named(
            &clean,
            None,
            label.clone(),
            None,
            "manual",
            label.as_deref().map(|_| "manual"),
        );
        if let Some(fav) = favorited {
            inner.set_rrc_favorite(&clean, fav);
        }
        inner.save(&self.config_dir, &self.storage_dir)?;
        let hub = inner
            .rrc_hubs
            .iter()
            .find(|h| h.destination_hash.eq_ignore_ascii_case(&clean))
            .cloned()
            .ok_or_else(|| "hub upsert failed".to_string())?;
        Ok(hub)
    }

    pub async fn set_rrc_favorite(&self, hash: &str, favorited: bool) -> Result<(), String> {
        let clean = hash.trim().to_lowercase().replace(':', "");
        if clean.len() != 32 || !clean.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("dest_hash must be 32 hex characters".into());
        }
        let mut inner = self.inner.write().await;
        inner.set_rrc_favorite(&clean, favorited);
        inner.save(&self.config_dir, &self.storage_dir)?;
        Ok(())
    }

    pub async fn rrc_connect(
        &self,
        dest_hash: &str,
        nickname: Option<String>,
    ) -> serde_json::Value {
        let clean = dest_hash.trim().to_lowercase().replace(':', "");
        if clean.len() != 32 || !clean.chars().all(|c| c.is_ascii_hexdigit()) {
            return serde_json::json!({ "ok": false, "error": "dest_hash must be 32 hex characters" });
        }
        let bytes = match hex::decode(&clean) {
            Ok(b) if b.len() == 16 => {
                let mut arr = [0u8; 16];
                arr.copy_from_slice(&b);
                arr
            }
            _ => {
                return serde_json::json!({ "ok": false, "error": "invalid dest_hash" });
            }
        };
        let nick = nickname
            .map(|n| n.trim().to_string())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| "mesh-client".into());
        let hops = {
            let inner = self.inner.read().await;
            inner
                .rrc_hubs
                .iter()
                .find(|h| h.destination_hash.eq_ignore_ascii_case(&clean))
                .and_then(|h| h.hops)
                .unwrap_or(8)
        };
        {
            let mut inner = self.inner.write().await;
            inner.upsert_rrc_hub(&clean, None, None, Some(hops), "manual");
            let _ = inner.save(&self.config_dir, &self.storage_dir);
        }
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.rrc_connect(bytes, clean, hops, nick).await;
        }
        let _ = (bytes, nick, hops);
        serde_json::json!({
            "ok": false,
            "error": "rrc connect requires live rns-stack sidecar"
        })
    }

    pub async fn rrc_disconnect(&self, dest_hash_hex: Option<&str>) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.rrc_disconnect(dest_hash_hex).await;
        }
        let _ = dest_hash_hex;
        serde_json::json!({ "ok": true })
    }

    pub async fn rrc_status(&self) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.rrc_status().await;
        }
        serde_json::json!({
            "sessions": [],
            "identity_hash": null,
        })
    }

    pub async fn rrc_join(
        &self,
        hub_dest_hash: &str,
        room: &str,
        key: Option<&str>,
    ) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.rrc_join(hub_dest_hash, room, key).await;
        }
        let _ = (hub_dest_hash, room, key);
        serde_json::json!({ "ok": false, "error": "rrc requires live rns-stack sidecar" })
    }

    pub async fn rrc_part(&self, hub_dest_hash: &str, room: &str) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.rrc_part(hub_dest_hash, room).await;
        }
        let _ = (hub_dest_hash, room);
        serde_json::json!({ "ok": false, "error": "rrc requires live rns-stack sidecar" })
    }

    pub async fn rrc_send(
        &self,
        hub_dest_hash: &str,
        room: Option<&str>,
        body: &str,
        kind: Option<&str>,
        dst_hash: Option<&str>,
    ) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live
                .rrc_send(hub_dest_hash, room, body, kind.unwrap_or("msg"), dst_hash)
                .await;
        }
        let _ = (hub_dest_hash, room, body, kind, dst_hash);
        serde_json::json!({ "ok": false, "error": "rrc requires live rns-stack sidecar" })
    }

    pub async fn rrc_set_nick(
        &self,
        hub_dest_hash: Option<&str>,
        nickname: &str,
    ) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.rrc_set_nick(hub_dest_hash, nickname).await;
        }
        let _ = (hub_dest_hash, nickname);
        serde_json::json!({ "ok": false, "error": "rrc requires live rns-stack sidecar" })
    }

    pub async fn rrc_rooms(&self, hub_dest_hash: Option<&str>) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.rrc_rooms(hub_dest_hash).await;
        }
        let _ = hub_dest_hash;
        serde_json::json!({ "rooms": [] })
    }

    pub async fn rnsh_connect(&self, destination_hash: &str) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.rnsh_connect(destination_hash).await;
        }
        let _ = destination_hash;
        serde_json::json!({ "ok": false, "error": "rnsh requires live rns-stack sidecar" })
    }

    pub async fn rnsh_input(&self, session_id: &str, data: Vec<u8>) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.rnsh_input(session_id, data).await;
        }
        let _ = (session_id, data);
        serde_json::json!({ "ok": false, "error": "rnsh requires live rns-stack sidecar" })
    }

    pub async fn rnsh_resize(
        &self,
        session_id: &str,
        rows: Option<u32>,
        cols: Option<u32>,
    ) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.rnsh_resize(session_id, rows, cols).await;
        }
        let _ = (session_id, rows, cols);
        serde_json::json!({ "ok": false, "error": "rnsh requires live rns-stack sidecar" })
    }

    pub async fn rnsh_disconnect(&self, session_id: &str) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.rnsh_disconnect(session_id).await;
        }
        let _ = session_id;
        serde_json::json!({ "ok": false, "error": "rnsh requires live rns-stack sidecar" })
    }

    pub async fn rnsh_status(&self) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.rnsh_status().await;
        }
        serde_json::json!({ "sessions": [] })
    }

    pub async fn rncp_send(&self, destination_hash: &str, path: &str) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.rncp_send(destination_hash, path).await;
        }
        let _ = (destination_hash, path);
        serde_json::json!({ "ok": false, "error": "rncp requires live rns-stack sidecar" })
    }

    pub async fn rncp_fetch(
        &self,
        destination_hash: &str,
        remote_path: &str,
        save_path: Option<String>,
    ) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            let save_dir = save_path
                .map(PathBuf::from)
                .unwrap_or_else(|| self.storage_dir.join("rncp_fetched"));
            return live
                .rncp_fetch(destination_hash, remote_path, save_dir)
                .await;
        }
        let _ = (destination_hash, remote_path, save_path);
        serde_json::json!({ "ok": false, "error": "rncp requires live rns-stack sidecar" })
    }

    pub async fn rncp_cancel(&self, transfer_id: &str) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.rncp_cancel(transfer_id).await;
        }
        let _ = transfer_id;
        serde_json::json!({ "ok": false, "error": "rncp requires live rns-stack sidecar" })
    }

    pub async fn rncp_accept(&self, transfer_id: &str) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.rncp_accept(transfer_id).await;
        }
        let _ = transfer_id;
        serde_json::json!({ "ok": false, "error": "rncp requires live rns-stack sidecar" })
    }

    pub async fn rncp_reject(&self, transfer_id: &str) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.rncp_reject(transfer_id).await;
        }
        let _ = transfer_id;
        serde_json::json!({ "ok": false, "error": "rncp requires live rns-stack sidecar" })
    }

    pub async fn rncp_status(&self) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.rncp_status().await;
        }
        serde_json::json!({ "transfers": [], "pending_offers": [] })
    }

    /// `enabled: false` tears down the listener and sets policy to `off`.
    /// `enabled: true` with a non-empty `allowed` list uses `allow_all_listed`
    /// policy (only those identities can complete a transfer); an empty
    /// `allowed` list uses `ask` policy (any sender's file lands as a
    /// pending offer unless separately allow-listed).
    #[allow(clippy::too_many_arguments)]
    pub async fn rncp_set_listener(
        &self,
        enabled: bool,
        save_dir: Option<String>,
        allow_fetch: bool,
        fetch_jail: Option<String>,
        overwrite: bool,
        allowed: Vec<String>,
        blocked: Vec<String>,
    ) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            if !enabled {
                live.rncp_stop_listener().await;
                let _ = live
                    .rncp_configure_policy("off", Vec::new(), Vec::new())
                    .await;
                return live.rncp_listener_status().await;
            }
            let mode = if allowed.is_empty() {
                "ask"
            } else {
                "allow_all_listed"
            };
            if let Err(e) = live.rncp_configure_policy(mode, allowed, blocked).await {
                return serde_json::json!({ "ok": false, "error": e });
            }
            let save_dir = save_dir
                .map(PathBuf::from)
                .unwrap_or_else(|| self.storage_dir.join("rncp_inbox"));
            let fetch_jail = fetch_jail.map(PathBuf::from);
            return live
                .rncp_start_listener(save_dir, allow_fetch, fetch_jail, overwrite)
                .await;
        }
        let _ = (
            enabled,
            save_dir,
            allow_fetch,
            fetch_jail,
            overwrite,
            allowed,
            blocked,
        );
        serde_json::json!({ "ok": false, "error": "rncp requires live rns-stack sidecar" })
    }

    pub async fn rncp_listener_status(&self) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.rncp_listener_status().await;
        }
        serde_json::json!({
            "enabled": false,
            "destination_hash": null,
            "inbound_mode": "off",
            "allowed": [],
            "blocked": [],
        })
    }

    pub fn path_capability(&self, destination_hash: &str) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return live.path_capability(destination_hash);
        }
        let clean = destination_hash.trim().to_lowercase();
        let cap = path_speed::path_capability_from_atoms(&clean, &[], None);
        serde_json::json!({
            "destination_hash": cap.destination_hash,
            "speed": cap.speed.as_str(),
            "via_atoms": cap.via_atoms,
            "hops": cap.hops,
            "transfer_allowed": cap.transfer_allowed,
            "shell_allowed": cap.shell_allowed,
            "reason_key": cap.reason_key,
        })
    }

    pub async fn remote_identity(&self) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            return serde_json::json!({
                "identity_hash": live.identity_hash_hex(),
                "rncp_receive_hash": live.rncp_receive_destination_hash().await,
            });
        }
        serde_json::json!({ "identity_hash": null, "rncp_receive_hash": null })
    }

    #[cfg(feature = "rns-stack")]
    async fn nomad_identity_hash_for(&self, hash: &str) -> Option<String> {
        let key = hash.to_lowercase();
        self.inner
            .read()
            .await
            .nomad_nodes
            .iter()
            .find(|n| n.destination_hash.to_lowercase() == key)
            .and_then(|n| n.identity_hash.clone())
    }

    pub async fn nomad_page(
        &self,
        hash: &str,
        path: &str,
        data_b64: Option<&str>,
    ) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            let interfaces = self.inner.read().await.interfaces.clone();
            let identity_hash = self.nomad_identity_hash_for(hash).await;
            return live
                .fetch_nomad_page(hash, identity_hash.as_deref(), path, data_b64, &interfaces)
                .await;
        }
        let _ = (hash, path, data_b64);
        serde_json::json!({
            "ok": false,
            "error": "nomad page fetch requires live rns-stack sidecar"
        })
    }

    pub async fn nomad_file(&self, hash: &str, path: &str) -> serde_json::Value {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            let interfaces = self.inner.read().await.interfaces.clone();
            let identity_hash = self.nomad_identity_hash_for(hash).await;
            return live
                .fetch_nomad_file(hash, identity_hash.as_deref(), path, &interfaces)
                .await;
        }
        let _ = (hash, path);
        serde_json::json!({
            "ok": false,
            "error": "nomad file fetch requires live rns-stack sidecar"
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

    fn maybe_emit_identity_restart(&self) {
        #[cfg(feature = "rns-stack")]
        if self.live.is_some() {
            self.emit_event("stack_restart_requested", serde_json::json!({ "ok": true }));
        }
    }

    pub async fn lxmf_reaction(
        &self,
        req: LxmfReactionRequest,
    ) -> Result<serde_json::Value, String> {
        #[cfg(feature = "rns-stack")]
        if let Some(live) = &self.live {
            let res = live.send_reaction(&req).await?;
            self.emit_event("lxmf_message", res.clone());
            return Ok(res);
        }
        let mut inner = self.inner.write().await;
        let res = inner.send_reaction(&req)?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        drop(inner);
        self.emit_event("lxmf_message", res.clone());
        Ok(res)
    }

    #[allow(clippy::unused_async)] // async matches StackHandle admin API awaited by HTTP handlers
    pub async fn rnode_presets(&self) -> serde_json::Value {
        rf_profiles::presets_wire_json()
    }

    #[allow(clippy::unused_async)] // async matches StackHandle admin API awaited by HTTP handlers
    pub async fn serial_ports(&self) -> serde_json::Value {
        serde_json::json!({ "ports": enumerate_serial_ports() })
    }

    pub async fn ble_availability(&self) -> serde_json::Value {
        ble::ble_availability().await
    }

    pub async fn ble_scan(
        &self,
        timeout_secs: u64,
        mode: &str,
    ) -> Result<serde_json::Value, String> {
        ble::ble_scan(timeout_secs, mode).await
    }

    pub async fn lxmf_delete_message(&self, message_hash: &str) -> Result<bool, String> {
        let mut inner = self.inner.write().await;
        let removed = inner.delete_message_by_hash(message_hash)?;
        inner.save(&self.config_dir, &self.storage_dir)?;
        Ok(removed)
    }

    #[allow(clippy::unused_async)] // async matches StackHandle lifecycle API awaited by HTTP handlers
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
        let live_interfaces = self.list_interfaces().await;
        let interfaces: Vec<serde_json::Value> = live_interfaces
            .iter()
            .map(|i| {
                serde_json::json!({
                    "id": i.id,
                    "name": i.name,
                    "type": i.iface_type,
                    "enabled": i.enabled,
                    "status": i.status,
                    "host": i.host,
                    "port": i.port,
                    "preset": i.preset,
                    "serial_port": i.serial_port,
                    "frequency": i.frequency,
                })
            })
            .collect();
        serde_json::json!({
            "rns_ready": inner.rns_ready,
            "lxmf_ready": inner.lxmf_ready,
            "interface_count": live_interfaces.len(),
            "contact_count": inner.contacts.len(),
            "peer_count": inner.peers.len(),
            "message_count": inner.messages.len(),
            "interfaces": interfaces,
        })
    }

    pub async fn config_audit(&self) -> Result<Vec<config_audit::ConfigAuditIssue>, String> {
        let settings = config::get_stack_settings(&self.config_dir)?;
        let live = self.list_interfaces().await;
        let inner = self.inner.read().await;
        let stack_running = inner.rns_ready;
        config_audit::audit_config(&self.config_dir, &live, &settings, stack_running)
    }

    #[allow(clippy::unused_async)] // async matches StackHandle config API awaited by HTTP handlers
    pub async fn config_repair(
        &self,
        request: config_audit::ConfigRepairRequest,
    ) -> Result<(Vec<String>, bool), String> {
        config_audit::repair_config(&self.config_dir, &request)
    }

    #[allow(clippy::unused_async)] // async matches StackHandle feature-status API awaited by HTTP handlers
    pub async fn voice_status(&self) -> serde_json::Value {
        serde_json::json!({
            "available": cfg!(feature = "rns-stack"),
            "enabled": false,
            "codec": "opus",
            "reason": "LXST voice pipeline pending rsLXST integration"
        })
    }

    #[allow(clippy::unused_async)] // async matches StackHandle feature-status API awaited by HTTP handlers
    pub async fn games_status(&self) -> serde_json::Value {
        serde_json::json!({
            "available": true,
            "enabled": false,
            "reason": "LRGP games pending lrgp-rs integration"
        })
    }

    pub async fn list_identities(&self) -> serde_json::Value {
        let identity = self.inner.read().await.identity.clone();
        let identities = identity_slots::list_slot_rows(&self.config_dir, &identity);
        serde_json::json!({ "identities": identities })
    }

    pub async fn create_identity_slot(
        &self,
        display_name: Option<String>,
    ) -> Result<serde_json::Value, String> {
        identity_apply::identity_requires_rns_stack()?;
        let display_name = match display_name {
            Some(name) => Some(sanitize_nomad_display_name(&name)?),
            None => None,
        };
        #[cfg(feature = "rns-stack")]
        {
            let _op = self.identity_op_lock.lock().await;
            let previous_active = identity_slots::read_active_id(&self.config_dir);
            let working_path = identity_slots::working_identity_path(&self.config_dir);
            let previous_working = fs::read(&working_path).ok();
            {
                let inner = self.inner.read().await;
                identity_slots::stash_working_into_active_slot(&self.config_dir, &inner.identity)?;
            }
            let new_id =
                identity_slots::create_empty_slot(&self.config_dir, display_name.as_deref())?;

            let applied = async {
                // Generate and apply into the staged slot first; commit active_identity last.
                let (rns_identity, mnemonic) = identity_apply::generate_identity_with_mnemonic()?;
                let mut inner = self.inner.write().await;
                let identity = identity_apply::apply_unified_identity_to_slot(
                    &mut inner,
                    &self.config_dir,
                    &self.storage_dir,
                    &rns_identity,
                    display_name.clone(),
                    Some(mnemonic),
                    Some(new_id.as_str()),
                )?;
                drop(inner);
                identity_slots::set_active_slot_pointer(&self.config_dir, &new_id)?;
                Ok::<_, String>(identity)
            }
            .await;

            match applied {
                Ok(identity) => {
                    self.maybe_emit_identity_restart();
                    Ok(serde_json::json!({
                        "ok": true,
                        "id": new_id,
                        "identity": identity,
                    }))
                }
                Err(e) => {
                    // Failure point: generate/apply after empty slot create.
                    // Fallback: restore prior active pointer + working key; drop staged slot.
                    if let Err(rb) =
                        identity_slots::write_active_id(&self.config_dir, &previous_active)
                    {
                        tracing::error!(
                            "create_identity_slot rollback active pointer failed: {rb} (original: {e})"
                        );
                    }
                    match &previous_working {
                        Some(bytes) => {
                            if let Err(rb) = fs::write(&working_path, bytes) {
                                tracing::error!(
                                    "create_identity_slot rollback working identity failed: {rb} (original: {e})"
                                );
                            }
                        }
                        None => {
                            let _ = fs::remove_file(&working_path);
                        }
                    }
                    if let Err(rb) =
                        identity_slots::remove_slot_dir_force(&self.config_dir, &new_id)
                    {
                        tracing::error!(
                            "create_identity_slot rollback remove slot failed: {rb} (original: {e})"
                        );
                    }
                    {
                        let mut inner = self.inner.write().await;
                        if let Err(rb) = identity_apply::reconcile_persisted_identity_from_file(
                            &mut inner,
                            &self.config_dir,
                            &self.storage_dir,
                        ) {
                            tracing::error!(
                                "create_identity_slot rollback reconcile failed: {rb} (original: {e})"
                            );
                        }
                    }
                    Err(e)
                }
            }
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            let _ = display_name;
            Err("identity operations require an rns-stack sidecar build".into())
        }
    }

    pub async fn switch_identity(&self, identity_id: &str) -> Result<(), String> {
        identity_apply::identity_requires_rns_stack()?;
        #[cfg(feature = "rns-stack")]
        {
            let _op = self.identity_op_lock.lock().await;
            let previous_active = identity_slots::read_active_id(&self.config_dir);
            if previous_active == identity_id {
                return Ok(());
            }
            let working_path = identity_slots::working_identity_path(&self.config_dir);
            let previous_working = fs::read(&working_path).ok();
            {
                let inner = self.inner.read().await;
                identity_slots::stash_working_into_active_slot(&self.config_dir, &inner.identity)?;
            }
            // Install target key first; commit active pointer only after reconcile succeeds.
            identity_slots::install_slot_to_working(&self.config_dir, identity_id)?;
            let reconciled = {
                let mut inner = self.inner.write().await;
                identity_apply::reconcile_persisted_identity_from_file(
                    &mut inner,
                    &self.config_dir,
                    &self.storage_dir,
                )
            };
            match reconciled {
                Ok(_) => {
                    identity_slots::write_active_id(&self.config_dir, identity_id)?;
                    self.maybe_emit_identity_restart();
                    Ok(())
                }
                Err(e) => {
                    if let Some(bytes) = previous_working {
                        if let Err(rb) = fs::write(&working_path, bytes) {
                            tracing::error!(
                                "switch_identity rollback working identity failed: {rb} (original: {e})"
                            );
                        }
                    }
                    {
                        let mut inner = self.inner.write().await;
                        if let Err(rb) = identity_apply::reconcile_persisted_identity_from_file(
                            &mut inner,
                            &self.config_dir,
                            &self.storage_dir,
                        ) {
                            tracing::error!(
                                "switch_identity rollback reconcile failed: {rb} (original: {e})"
                            );
                        }
                    }
                    // Pointer was never advanced; leave previous_active as-is.
                    let _ = previous_active;
                    Err(e)
                }
            }
        }
        #[cfg(not(feature = "rns-stack"))]
        {
            let _ = identity_id;
            Err("identity operations require an rns-stack sidecar build".into())
        }
    }

    #[allow(clippy::unused_async)] // async matches StackHandle identity API awaited by HTTP handlers
    pub async fn delete_identity_slot(&self, identity_id: &str) -> Result<(), String> {
        let _op = self.identity_op_lock.lock().await;
        identity_slots::delete_slot(&self.config_dir, identity_id)
    }

    pub async fn rns_ready(&self) -> bool {
        self.inner.read().await.rns_ready
    }

    pub async fn lxmf_ready(&self) -> bool {
        self.inner.read().await.lxmf_ready
    }

    #[allow(clippy::unused_self, clippy::unnecessary_wraps)] // version probes mirror StackHandle info API
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

    #[allow(clippy::unused_self, clippy::unnecessary_wraps)] // version probes mirror StackHandle info API
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

#[cfg(feature = "rns-stack")]
fn serving_entry_json(entry: &nomad_core::NomadPageEntry) -> serde_json::Value {
    serde_json::json!({
        "path": entry.path,
        "size": entry.size,
        "modified_ms": entry.modified_ms,
    })
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

/// Hard ceiling on peer rows returned / persisted after a live path-table sync.
/// Matches the renderer destination cap (`50_000` / `MAX_MESH_ENTITY_CAP` floor).
const MAX_PEER_CACHE: usize = 50_000;
/// Cap on peers retained after leaving the live path table (e.g. Clear Contacts demotions).
const MAX_ORPHAN_PEERS: usize = 5_000;
/// Drop orphaned peers with `last_seen` older than this (Unix seconds). Missing
/// `last_seen` ranks as oldest and is only kept while under the orphan cap.
const ORPHAN_PEER_MAX_AGE_SECS: u64 = 30 * 86_400;

fn peer_last_seen_or_zero(peer: &PeerRow) -> u64 {
    peer.last_seen.unwrap_or(0)
}

fn now_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Applies a live path-table fetch to the peer cache.
///
/// Empty fetch clears the cache (intentional wipe). Non-empty fetch updates path-table
/// rows while keeping a bounded set of previously cached destinations that are not in
/// the current path table (e.g. contacts demoted to peers during Clear Contacts).
fn sync_live_peer_cache(cache: &mut Vec<PeerRow>, fetched: Vec<PeerRow>) -> Vec<PeerRow> {
    if fetched.is_empty() {
        *cache = Vec::new();
        return Vec::new();
    }
    let prev_names: std::collections::HashMap<String, String> = cache
        .iter()
        .filter_map(|p| {
            let name = p.display_name.as_ref()?.clone();
            Some((p.destination_hash.to_lowercase(), name))
        })
        .collect();
    let fetched_hashes: std::collections::HashSet<String> = fetched
        .iter()
        .map(|p| p.destination_hash.to_lowercase())
        .collect();
    let now = now_unix_secs();
    let orphan_cutoff = now.saturating_sub(ORPHAN_PEER_MAX_AGE_SECS);
    let mut preserved: Vec<PeerRow> = cache
        .iter()
        .filter(|p| !fetched_hashes.contains(&p.destination_hash.to_lowercase()))
        .filter(|p| match p.last_seen {
            Some(ts) => ts >= orphan_cutoff,
            // Keep unnamed-less/nameless orphans briefly under the cap only.
            None => true,
        })
        .cloned()
        .collect();
    preserved.sort_by_key(|b| std::cmp::Reverse(peer_last_seen_or_zero(b)));
    if preserved.len() > MAX_ORPHAN_PEERS {
        tracing::debug!(
            retained = MAX_ORPHAN_PEERS,
            dropped = preserved.len() - MAX_ORPHAN_PEERS,
            "capping orphaned peer rows after path-table sync"
        );
        preserved.truncate(MAX_ORPHAN_PEERS);
    }
    let mut live_rows: Vec<PeerRow> = fetched
        .into_iter()
        .map(|mut peer| {
            if peer.display_name.is_none() {
                if let Some(name) = prev_names.get(&peer.destination_hash.to_lowercase()) {
                    peer.display_name = Some(name.clone());
                }
            }
            peer
        })
        .collect();
    if live_rows.len() > MAX_PEER_CACHE {
        live_rows.sort_by_key(|b| std::cmp::Reverse(peer_last_seen_or_zero(b)));
        live_rows.truncate(MAX_PEER_CACHE);
    }
    let orphan_budget = MAX_PEER_CACHE.saturating_sub(live_rows.len());
    if preserved.len() > orphan_budget {
        preserved.truncate(orphan_budget);
    }
    let mut merged = live_rows;
    merged.extend(preserved);
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
            via_hash: None,
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
            via_hash: None,
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
            via_hash: None,
        }];
        let fetched = sync_live_peer_cache(&mut cache, vec![]);
        assert!(fetched.is_empty());
        assert!(cache.is_empty());
    }

    #[test]
    fn sync_live_peer_cache_preserves_names_via_hashmap() {
        let mut cache = vec![PeerRow {
            destination_hash: "AaBbCcDd".into(),
            display_name: Some("Alice".into()),
            hops: Some(1),
            last_seen: None,
            interface: None,
            path_hash: None,
            via_hash: None,
        }];
        let fetched = sync_live_peer_cache(
            &mut cache,
            vec![PeerRow {
                destination_hash: "aabbccdd".into(),
                display_name: None,
                hops: Some(2),
                last_seen: Some(9),
                interface: Some("tcp".into()),
                path_hash: None,
                via_hash: None,
            }],
        );
        assert_eq!(fetched.len(), 1);
        assert_eq!(fetched[0].display_name.as_deref(), Some("Alice"));
        assert_eq!(fetched[0].hops, Some(2));
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
            via_hash: None,
        };
        let fetched = sync_live_peer_cache(&mut cache, vec![row.clone()]);
        assert_eq!(fetched.len(), 1);
        assert_eq!(cache.len(), 1);
        assert_eq!(cache[0].destination_hash, row.destination_hash);
    }

    #[test]
    fn upsert_nomad_node_updates_existing_display_name() {
        let (config_dir, storage_dir) = temp_stack_dirs();
        let mut state = PersistedState::load(&config_dir, &storage_dir);
        state.upsert_nomad_node("abc123", None, Some("Forum".into()), Some(2));
        state.upsert_nomad_node("ABC123", None, Some("Updated Forum".into()), Some(3));
        assert_eq!(state.nomad_nodes.len(), 1);
        assert_eq!(
            state.nomad_nodes[0].display_name.as_deref(),
            Some("Updated Forum")
        );
        assert_eq!(state.nomad_nodes[0].hops, Some(3));
        assert_eq!(state.nomad_nodes[0].status.as_deref(), Some("online"));
        let _ = std::fs::remove_dir_all(config_dir);
        let _ = std::fs::remove_dir_all(storage_dir);
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

    #[test]
    fn sync_live_peer_cache_keeps_demoted_peers_not_in_path_table() {
        let now = now_unix_secs();
        let mut cache = vec![PeerRow {
            destination_hash: "aabb01".into(),
            display_name: Some("Demoted".into()),
            hops: None,
            last_seen: Some(now),
            interface: None,
            path_hash: None,
            via_hash: None,
        }];
        let live = PeerRow {
            destination_hash: "ccdd02".into(),
            display_name: None,
            hops: Some(1),
            last_seen: Some(now),
            interface: Some("tcp".into()),
            path_hash: None,
            via_hash: None,
        };
        let merged = sync_live_peer_cache(&mut cache, vec![live]);
        assert_eq!(merged.len(), 2);
        assert!(merged.iter().any(|p| p.destination_hash == "aabb01"));
        assert!(merged.iter().any(|p| p.destination_hash == "ccdd02"));
    }

    #[test]
    fn sync_live_peer_cache_drops_stale_orphans_and_caps_count() {
        let now = now_unix_secs();
        let mut cache: Vec<PeerRow> = (0..MAX_ORPHAN_PEERS + 50)
            .map(|i| PeerRow {
                destination_hash: format!("{i:032x}"),
                display_name: Some(format!("orphan-{i}")),
                hops: None,
                last_seen: Some(now.saturating_sub(i as u64)),
                interface: None,
                path_hash: None,
                via_hash: None,
            })
            .collect();
        // One orphan older than TTL must be dropped even if under the count cap.
        cache.push(PeerRow {
            destination_hash: "ff".repeat(16),
            display_name: Some("ancient".into()),
            hops: None,
            last_seen: Some(now.saturating_sub(ORPHAN_PEER_MAX_AGE_SECS + 10)),
            interface: None,
            path_hash: None,
            via_hash: None,
        });
        let live = PeerRow {
            destination_hash: "aa".repeat(16),
            display_name: None,
            hops: Some(1),
            last_seen: Some(now),
            interface: Some("tcp".into()),
            path_hash: None,
            via_hash: None,
        };
        let merged = sync_live_peer_cache(&mut cache, vec![live]);
        assert!(merged.iter().any(|p| p.destination_hash == "aa".repeat(16)));
        assert!(!merged.iter().any(|p| p.destination_hash == "ff".repeat(16)));
        assert!(merged.len() <= 1 + MAX_ORPHAN_PEERS);
    }

    #[tokio::test]
    async fn clear_contacts_empties_persisted_lxmf_contacts() {
        let (config_dir, storage_dir) = temp_stack_dirs();
        let (tx, _) = broadcast::channel(8);
        let handle = StackHandle::bootstrap(config_dir.clone(), storage_dir.clone(), tx).await;
        {
            let mut inner = handle.inner.write().await;
            inner.upsert_contact("aabbccddeeff00112233445566778899", Some("Announced".into()));
            inner
                .save(&config_dir, &storage_dir)
                .expect("persist contact");
        }
        assert_eq!(handle.list_contacts().await.len(), 1);
        let cleared = handle.clear_contacts().await.expect("clear contacts");
        assert_eq!(cleared, 1);
        assert!(handle.list_contacts().await.is_empty());
        let peers = handle.list_peers().await;
        assert_eq!(peers.len(), 1);
        assert_eq!(
            peers[0].destination_hash,
            "aabbccddeeff00112233445566778899"
        );
        assert_eq!(peers[0].display_name.as_deref(), Some("Announced"));
        let _ = std::fs::remove_dir_all(config_dir);
        let _ = std::fs::remove_dir_all(storage_dir);
    }
}

//! rncp (file transfer) send/fetch driving + inbound listener policy.
//!
//! Outbound `send()` / `fetch()` each drive one `rncp_send_file` /
//! `rncp_fetch_file` call on a dedicated OS thread via [`super::link_task`]
//! (their futures are not `Send`), tracked by `transfer_id` so the HTTP
//! layer can poll progress and cancel.
//!
//! Inbound transfers use rsReticulum's pre-advertisement admission gate, then
//! hand verified bytes to the application without writing them. This module
//! owns crash-safe staging and promotion, so blocked, oversized, unidentified,
//! and over-quota transfers never reach persistent storage.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use rns_identity::destination::{DestType, Destination, Direction};
use rns_identity::identity::Identity;
use rns_runtime::rncp::{
    RncpAdmissionReason, RncpEvent, RncpFetchRequest, RncpInboundLimits, RncpListenerConfig,
    RncpListenerHandle, RncpPayloadAck, RncpReceiveMode, RncpSendRequest, default_rncp_app_name,
    rncp_fetch_file, rncp_send_file, spawn_rncp_listener,
};
use rns_transport::messages::{OutboundRequest, TransportMessage};
use serde_json::json;
use tokio::sync::{Mutex, broadcast, mpsc, oneshot};
use uuid::Uuid;

use crate::api::path_capability::ConsumedPathCapability;

use super::config::{self, DEFAULT_ANNOUNCE_INTERVAL_SEC};
use super::link_task::spawn_link_task;
use super::live::parse_hash16;
#[cfg(test)]
use super::rncp_staging::MAX_PENDING_OFFERS;
use super::rncp_staging::{RncpStaging, StoreOutcome};

/// Soft cap on concurrently *active* outbound transfers (send/fetch tasks
/// this manager is driving). Completed/failed entries are pruned on the
/// next `send()`/`fetch()` call so a burst of short transfers cannot starve
/// the cap.
const MAX_ACTIVE_RNCP_TRANSFERS: usize = 3;
/// Hard cap on file size for outbound `send()` (checked against local file
/// size before reading it into memory) and on completed inbound/fetched
/// files (checked after the fact — the underlying resource transfer has no
/// pre-flight size veto).
const MAX_RNCP_FILE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_RNCP_METADATA_BYTES: usize = 4 * 1024;
const MAX_ACTIVE_INBOUND_RNCP: usize = 3;
const MAX_ACTIVE_INBOUND_RNCP_PER_IDENTITY: usize = 1;
const MAX_RESERVED_INBOUND_RNCP_BYTES: usize =
    MAX_ACTIVE_INBOUND_RNCP * (MAX_RNCP_FILE_BYTES as usize + MAX_RNCP_METADATA_BYTES);
/// Cap on staged ask-mode inbound offers awaiting accept()/reject(); further
/// completed transfers are deleted and reported as failed until the backlog
/// drains (prevents unbounded disk growth in the hidden staging dir).
const RNCP_PATH_WAIT: Duration = Duration::from_secs(30);
/// Generous ceiling for a bounded (25 MiB) transfer over a possibly
/// RF-speed-constrained Reticulum path.
const RNCP_TRANSFER_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Brief settle before the first listen announce so TCP hubs can come up
/// (matches LXMF delivery startup announce).
const RNCP_LISTEN_ANNOUNCE_SETTLE: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InboundMode {
    Off,
    Ask,
    AllowAllListed,
}

impl InboundMode {
    fn parse(s: &str) -> Result<Self, String> {
        match s {
            "off" => Ok(Self::Off),
            "ask" => Ok(Self::Ask),
            "allow_all_listed" => Ok(Self::AllowAllListed),
            other => Err(format!(
                "invalid inbound_mode: {other} (expected off|ask|allow_all_listed)"
            )),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Ask => "ask",
            Self::AllowAllListed => "allow_all_listed",
        }
    }
}

#[derive(Clone)]
struct PolicyState {
    mode: InboundMode,
    allowed: HashSet<String>,
    blocked: HashSet<String>,
}

impl Default for PolicyState {
    fn default() -> Self {
        Self {
            mode: InboundMode::Off,
            allowed: HashSet::new(),
            blocked: HashSet::new(),
        }
    }
}

impl PolicyState {
    fn is_allowed(&self, identity_hex: &str) -> bool {
        self.allowed.contains(identity_hex)
    }

    fn is_blocked(&self, identity_hex: &str) -> bool {
        self.blocked.contains(identity_hex)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TransferKind {
    Send,
    Fetch,
}

impl TransferKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Send => "send",
            Self::Fetch => "fetch",
        }
    }
}

/// `rncp_send_file` / `rncp_fetch_file` futures are not `Send` (they hold a
/// `Link` reference across internal await points), so each active transfer
/// runs on a dedicated OS thread via [`super::link_task`] rather than a
/// `tokio::task::JoinHandle`; `cancel_tx` requests best-effort cancellation.
struct ActiveTransfer {
    kind: TransferKind,
    destination_hash: String,
    file_name: Option<String>,
    cancel_tx: Option<oneshot::Sender<()>>,
    thread: std::thread::JoinHandle<()>,
    _path_capability: Option<Arc<ConsumedPathCapability>>,
}

#[derive(Clone)]
struct PendingOffer {
    file_name: String,
    bytes: usize,
    identity_hash: Option<String>,
    overwrite: bool,
    display_save_dir: PathBuf,
    _path_capability: Option<Arc<ConsumedPathCapability>>,
}

struct ListenerState {
    handle: Option<RncpListenerHandle>,
    destination_hash: String,
    events_task: tokio::task::JoinHandle<()>,
    announce_task: Option<tokio::task::JoinHandle<()>>,
    staging: Arc<RncpStaging>,
    _path_capability: Option<Arc<ConsumedPathCapability>>,
}

struct PayloadAckGuard(Option<RncpPayloadAck>);

impl PayloadAckGuard {
    fn new(ack: RncpPayloadAck) -> Self {
        Self(Some(ack))
    }
}

impl Drop for PayloadAckGuard {
    fn drop(&mut self) {
        if let Some(ack) = self.0.take() {
            ack.finish();
        }
    }
}

fn admission_reason(reason: RncpAdmissionReason) -> &'static str {
    match reason {
        RncpAdmissionReason::IdentificationRequired => "identification_required",
        RncpAdmissionReason::NotAllowed => "not_allowed",
        RncpAdmissionReason::FileTooLarge => "file_too_large",
        RncpAdmissionReason::TooManyActive => "too_many_active",
        RncpAdmissionReason::SenderBusy => "sender_busy",
        RncpAdmissionReason::ReservedBytesExceeded => "reserved_bytes_exceeded",
        RncpAdmissionReason::DeclaredSizeMismatch => "declared_size_mismatch",
        RncpAdmissionReason::MetadataTooLarge => "metadata_too_large",
    }
}

pub struct RncpTransferManager {
    transport_tx: mpsc::Sender<TransportMessage>,
    identity: Identity,
    event_tx: broadcast::Sender<String>,
    /// rnsd config dir — used to read `announce_interval_sec` for listen announces.
    config_dir: PathBuf,
    active: Mutex<HashMap<String, ActiveTransfer>>,
    pending_offers: Arc<Mutex<HashMap<String, PendingOffer>>>,
    listener: Mutex<Option<ListenerState>>,
    staging: Mutex<Option<Arc<RncpStaging>>>,
    listener_error: Mutex<Option<String>>,
    policy: Mutex<PolicyState>,
}

impl RncpTransferManager {
    pub fn spawn(
        transport_tx: mpsc::Sender<TransportMessage>,
        identity: Identity,
        event_tx: broadcast::Sender<String>,
        config_dir: PathBuf,
    ) -> Self {
        Self {
            transport_tx,
            identity,
            event_tx,
            config_dir,
            active: Mutex::new(HashMap::new()),
            pending_offers: Arc::new(Mutex::new(HashMap::new())),
            listener: Mutex::new(None),
            staging: Mutex::new(None),
            listener_error: Mutex::new(None),
            policy: Mutex::new(PolicyState::default()),
        }
    }

    /// Reads `local_path` and drives an `rncp_send_file` task, returning the
    /// new `transfer_id` immediately (progress/terminal state arrive via
    /// `rncp.progress` / `rncp.completed` / `rncp.failed` WS events).
    pub async fn send(
        &self,
        destination_hash_hex: &str,
        data: Vec<u8>,
        display_path: String,
        capability: Option<ConsumedPathCapability>,
    ) -> Result<String, String> {
        let dest_hash = parse_hash16(destination_hash_hex)?;
        if data.len() as u64 > MAX_RNCP_FILE_BYTES {
            return Err(format!(
                "file exceeds max transfer size of {MAX_RNCP_FILE_BYTES} bytes"
            ));
        }
        let file_name = Path::new(&display_path)
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .ok_or_else(|| "path has no file name".to_string())?;
        let mut active = self.active.lock().await;
        prune_finished_transfers(&mut active);
        if active.len() >= MAX_ACTIVE_RNCP_TRANSFERS {
            return Err(format!(
                "max_transfers: maximum of {MAX_ACTIVE_RNCP_TRANSFERS} active rncp transfers"
            ));
        }

        let transfer_id = Uuid::new_v4().to_string();
        let dest_hex = destination_hash_hex.trim().to_lowercase();
        let progress_tx = self.spawn_progress_forwarder(transfer_id.clone());

        let transport_tx = self.transport_tx.clone();
        let identity = self.identity.clone();
        let event_tx = self.event_tx.clone();
        let tid = transfer_id.clone();
        let dest_hex_task = dest_hex.clone();
        let capability = capability.map(Arc::new);
        let worker_capability = capability.clone();
        // `rncp_send_file`'s future is not `Send` — build and drive it
        // entirely on the dedicated thread `spawn_link_task` gives us (see
        // that module for why).
        let (thread, cancel_tx) =
            spawn_link_task(format!("rncp-send-{transfer_id}"), move || async move {
                // Keep picker authority alive until the worker actually exits;
                // removing the status row during cancellation must not release
                // its OS handle while the transfer future is still unwinding.
                let _path_capability = worker_capability;
                let file_name = file_name;
                let result = rncp_send_file(RncpSendRequest {
                    transport_tx,
                    identity,
                    dest_hash,
                    file_name: &file_name,
                    data,
                    auto_compress: true,
                    overall_timeout: RNCP_TRANSFER_TIMEOUT,
                    path_wait: RNCP_PATH_WAIT,
                    progress_tx: Some(progress_tx),
                })
                .await;
                match result {
                    Ok(outcome) => {
                        tracing::info!(
                            kind = "send",
                            transfer_id = %tid,
                            file_name = ?outcome.file_name,
                            bytes = outcome.bytes,
                            destination_hash = %dest_hex_task,
                            "[rncp] transfer completed"
                        );
                        emit(
                            &event_tx,
                            "rncp.completed",
                            json!({
                                "transfer_id": tid,
                                "file_name": outcome.file_name,
                                "bytes": outcome.bytes,
                                "destination_hash": dest_hex_task,
                            }),
                        );
                    }
                    Err(e) => emit(
                        &event_tx,
                        "rncp.failed",
                        json!({
                            "transfer_id": tid,
                            "error": e.to_string(),
                            "destination_hash": dest_hex_task,
                        }),
                    ),
                }
            })
            .map_err(|e| format!("failed to start rncp send thread: {e}"))?;

        active.insert(
            transfer_id.clone(),
            ActiveTransfer {
                kind: TransferKind::Send,
                destination_hash: dest_hex,
                file_name: Some(local_filename(&display_path)),
                cancel_tx: Some(cancel_tx),
                thread,
                _path_capability: capability,
            },
        );
        Ok(transfer_id)
    }

    /// Drives an `rncp_fetch_file` task into `save_dir`, returning the new
    /// `transfer_id` immediately.
    pub async fn fetch(
        &self,
        destination_hash_hex: &str,
        remote_path: &str,
        save_dir: PathBuf,
        display_dir: PathBuf,
        capability: Option<ConsumedPathCapability>,
    ) -> Result<String, String> {
        let dest_hash = parse_hash16(destination_hash_hex)?;
        tokio::fs::create_dir_all(&save_dir)
            .await
            .map_err(|e| format!("create save dir {}: {e}", save_dir.display()))?;

        let mut active = self.active.lock().await;
        prune_finished_transfers(&mut active);
        if active.len() >= MAX_ACTIVE_RNCP_TRANSFERS {
            return Err(format!(
                "max_transfers: maximum of {MAX_ACTIVE_RNCP_TRANSFERS} active rncp transfers"
            ));
        }

        let transfer_id = Uuid::new_v4().to_string();
        let dest_hex = destination_hash_hex.trim().to_lowercase();
        let progress_tx = self.spawn_progress_forwarder(transfer_id.clone());

        let transport_tx = self.transport_tx.clone();
        let identity = self.identity.clone();
        let event_tx = self.event_tx.clone();
        let tid = transfer_id.clone();
        let dest_hex_task = dest_hex.clone();
        let remote_path_owned = remote_path.to_string();
        let save_dir_task = save_dir.clone();
        let display_dir_task = display_dir;
        let capability = capability.map(Arc::new);
        let worker_capability = capability.clone();
        // `rncp_fetch_file`'s future is not `Send` — see `send()` above.
        let (thread, cancel_tx) =
            spawn_link_task(format!("rncp-fetch-{transfer_id}"), move || async move {
                let _path_capability = worker_capability;
                let result = rncp_fetch_file(RncpFetchRequest {
                    receive_limits: Some(rns_runtime::rncp::RncpFetchLimits {
                        max_file_bytes: MAX_RNCP_FILE_BYTES as usize,
                        max_metadata_bytes: MAX_RNCP_METADATA_BYTES,
                    }),
                    transport_tx,
                    identity,
                    dest_hash,
                    remote_path: &remote_path_owned,
                    save_dir: &save_dir_task,
                    overwrite: false,
                    overall_timeout: RNCP_TRANSFER_TIMEOUT,
                    path_wait: RNCP_PATH_WAIT,
                    progress_tx: Some(progress_tx),
                })
                .await;
                match result {
                    Ok(outcome) => {
                        if outcome.bytes as u64 > MAX_RNCP_FILE_BYTES {
                            let _ = tokio::fs::remove_file(&outcome.saved_path).await;
                            emit(
                                &event_tx,
                                "rncp.failed",
                                json!({
                                    "transfer_id": tid,
                                    "error": "fetched file exceeded max transfer size",
                                    "destination_hash": dest_hex_task,
                                }),
                            );
                            return;
                        }
                        tracing::info!(
                            kind = "fetch",
                            transfer_id = %tid,
                            file_name = ?outcome.file_name,
                            bytes = outcome.bytes,
                            destination_hash = %dest_hex_task,
                            path = %display_dir_task.join(&outcome.file_name).display(),
                            "[rncp] transfer completed"
                        );
                        emit(
                            &event_tx,
                            "rncp.completed",
                            json!({
                                "transfer_id": tid,
                                "file_name": outcome.file_name,
                                "bytes": outcome.bytes,
                                "path": display_dir_task.join(&outcome.file_name).display().to_string(),
                                "destination_hash": dest_hex_task,
                            }),
                        );
                    }
                    Err(e) => emit(
                        &event_tx,
                        "rncp.failed",
                        json!({
                            "transfer_id": tid,
                            "error": e.to_string(),
                            "destination_hash": dest_hex_task,
                        }),
                    ),
                }
            })
            .map_err(|e| format!("failed to start rncp fetch thread: {e}"))?;

        active.insert(
            transfer_id.clone(),
            ActiveTransfer {
                kind: TransferKind::Fetch,
                destination_hash: dest_hex,
                file_name: Some(remote_path.to_string()),
                cancel_tx: Some(cancel_tx),
                thread,
                _path_capability: capability,
            },
        );
        Ok(transfer_id)
    }

    /// Cancels an active outbound transfer (best-effort: signals the driving
    /// thread's `rncp_send_file`/`rncp_fetch_file` call to stop via
    /// `cancel_tx`); if `transfer_id` instead names a pending inbound offer,
    /// treats it as a `reject()`.
    pub async fn cancel(&self, transfer_id: &str) -> Result<(), String> {
        {
            let mut active = self.active.lock().await;
            if let Some(mut t) = active.remove(transfer_id) {
                if let Some(cancel_tx) = t.cancel_tx.take() {
                    let _ = cancel_tx.send(());
                }
                emit(
                    &self.event_tx,
                    "rncp.cancelled",
                    json!({ "transfer_id": transfer_id }),
                );
                return Ok(());
            }
        }
        self.reject(transfer_id).await
    }

    /// Promotes a manifest-owned inbound offer into the listener save dir.
    pub async fn accept(&self, transfer_id: &str) -> Result<serde_json::Value, String> {
        let offer = {
            let offers = self.pending_offers.lock().await;
            offers
                .get(transfer_id)
                .cloned()
                .ok_or_else(|| "no pending rncp offer with that id".to_string())?
        };
        let staging = self
            .staging
            .lock()
            .await
            .clone()
            .ok_or_else(|| "rncp listener is not running".to_string())?;
        let promoted = staging
            .accept(transfer_id.to_string(), offer.overwrite)
            .await?;
        self.pending_offers.lock().await.remove(transfer_id);
        let display_path = offer.display_save_dir.join(&promoted.file_name);
        tracing::info!(
            kind = "accept",
            transfer_id = %transfer_id,
            file_name = ?promoted.file_name,
            bytes = promoted.bytes,
            identity_hash = %promoted.identity_hash,
            path = %display_path.display(),
            "[rncp] transfer completed"
        );
        let payload = json!({
            "transfer_id": transfer_id,
            "file_name": promoted.file_name,
            "bytes": promoted.bytes,
            "path": display_path.display().to_string(),
            "identity_hash": promoted.identity_hash,
        });
        emit(&self.event_tx, "rncp.completed", payload.clone());
        Ok(payload)
    }

    /// Deletes a staged inbound offer without saving it.
    pub async fn reject(&self, transfer_id: &str) -> Result<(), String> {
        if !self.pending_offers.lock().await.contains_key(transfer_id) {
            return Err("no pending rncp offer with that id".into());
        }
        let staging = self
            .staging
            .lock()
            .await
            .clone()
            .ok_or_else(|| "rncp listener is not running".to_string())?;
        staging.reject(transfer_id.to_string()).await?;
        self.pending_offers.lock().await.remove(transfer_id);
        emit(
            &self.event_tx,
            "rncp.cancelled",
            json!({ "transfer_id": transfer_id, "reason": "rejected" }),
        );
        Ok(())
    }

    pub async fn status(&self) -> serde_json::Value {
        let mut active = self.active.lock().await;
        prune_finished_transfers(&mut active);
        let transfers: Vec<serde_json::Value> = active
            .iter()
            .map(|(id, t)| {
                json!({
                    "transfer_id": id,
                    "kind": t.kind.as_str(),
                    "destination_hash": t.destination_hash,
                    "file_name": t.file_name,
                })
            })
            .collect();
        let offers = self.pending_offers.lock().await;
        let pending_offers: Vec<serde_json::Value> = offers
            .iter()
            .map(|(id, o)| {
                json!({
                    "transfer_id": id,
                    "file_name": o.file_name,
                    "bytes": o.bytes,
                    "identity_hash": o.identity_hash,
                })
            })
            .collect();
        json!({ "transfers": transfers, "pending_offers": pending_offers })
    }

    /// `mode`: `"off" | "ask" | "allow_all_listed"`. Takes effect on the next
    /// `start_listener()` call.
    pub async fn configure_policy(
        &self,
        mode: &str,
        allowed: Vec<String>,
        blocked: Vec<String>,
    ) -> Result<(), String> {
        let mode = InboundMode::parse(mode)?;
        let allowed: HashSet<String> = allowed
            .into_iter()
            .map(|h| h.trim().to_lowercase())
            .filter(|h| !h.is_empty())
            .collect();
        let blocked: HashSet<String> = blocked
            .into_iter()
            .map(|h| h.trim().to_lowercase())
            .filter(|h| !h.is_empty())
            .collect();
        *self.policy.lock().await = PolicyState {
            mode,
            allowed,
            blocked,
        };
        Ok(())
    }

    /// Starts (or restarts) the inbound listener with pre-advertisement
    /// identity, size, concurrency, and aggregate-byte admission.
    ///
    /// After register, starts a listen announcer (rncp-rs parity) so peers can
    /// resolve the receive destination pubkey/path — registration alone is not
    /// enough for `rncp_send`'s announce-cache lookup.
    pub async fn start_listener(
        &self,
        save_dir: PathBuf,
        display_save_dir: PathBuf,
        allow_fetch: bool,
        fetch_jail: Option<PathBuf>,
        overwrite: bool,
        capability: Option<ConsumedPathCapability>,
    ) -> Result<serde_json::Value, String> {
        self.stop_listener().await;

        if allow_fetch && fetch_jail.is_none() {
            return Err(
                "allow_fetch requires fetch_jail (refuse open fetch without a jail directory)"
                    .into(),
            );
        }

        let policy = self.policy.lock().await.clone();
        let (allow_all, allowed) = match policy.mode {
            InboundMode::Off => {
                return Err("inbound rncp transfers are disabled (policy=off)".into());
            }
            InboundMode::Ask => (true, Vec::new()),
            InboundMode::AllowAllListed => {
                let mut hashes = Vec::with_capacity(policy.allowed.len());
                for hex_str in &policy.allowed {
                    hashes.push(parse_hash16(hex_str)?);
                }
                (false, hashes)
            }
        };

        let mut blocked = Vec::with_capacity(policy.blocked.len());
        for hex_str in &policy.blocked {
            blocked.push(
                parse_hash16(hex_str)
                    .map_err(|_| format!("invalid blocked RNCP identity hash: {hex_str}"))?,
            );
        }

        tokio::fs::create_dir_all(&save_dir)
            .await
            .map_err(|e| format!("create save dir {}: {e}", save_dir.display()))?;

        let staging = Arc::new(RncpStaging::open(save_dir.clone()).await?);

        let (events_tx, events_rx) = mpsc::channel::<RncpEvent>(MAX_ACTIVE_INBOUND_RNCP.max(1));
        let listener_cfg = RncpListenerConfig {
            identity: self.identity.clone(),
            app_name: default_rncp_app_name().to_string(),
            save_dir: save_dir.clone(),
            allow_all,
            allowed,
            overwrite,
            allow_fetch,
            fetch_jail,
            fetch_auto_compress: true,
            receive_mode: RncpReceiveMode::EmitPayload,
            inbound_limits: Some(RncpInboundLimits {
                max_file_bytes: MAX_RNCP_FILE_BYTES as usize,
                max_metadata_bytes: MAX_RNCP_METADATA_BYTES,
                max_active_transfers: MAX_ACTIVE_INBOUND_RNCP,
                max_active_per_identity: MAX_ACTIVE_INBOUND_RNCP_PER_IDENTITY,
                max_reserved_bytes: MAX_RESERVED_INBOUND_RNCP_BYTES,
                require_identified_sender: true,
            }),
            blocked,
        };
        let handle =
            match spawn_rncp_listener(self.transport_tx.clone(), listener_cfg, events_tx).await {
                Ok(handle) => handle,
                Err(error) => {
                    let _ = staging.cleanup().await;
                    return Err(error.to_string());
                }
            };
        let dest_hash_bytes = handle.destination_hash();
        let destination_hash = hex::encode(dest_hash_bytes);

        let capability = capability.map(Arc::new);
        let events_task = spawn_listener_event_loop(
            self.event_tx.clone(),
            policy,
            Arc::clone(&staging),
            overwrite,
            display_save_dir.clone(),
            capability.clone(),
            Arc::clone(&self.pending_offers),
            events_rx,
        );

        let announce_task = spawn_listen_announcer(
            self.transport_tx.clone(),
            self.identity.clone(),
            dest_hash_bytes,
            self.config_dir.clone(),
        );

        *self.listener.lock().await = Some(ListenerState {
            handle: Some(handle),
            destination_hash: destination_hash.clone(),
            events_task,
            announce_task: Some(announce_task),
            staging: Arc::clone(&staging),
            _path_capability: capability,
        });
        *self.staging.lock().await = Some(staging);
        *self.listener_error.lock().await = None;

        Ok(
            json!({ "destination_hash": destination_hash, "save_dir": display_save_dir.display().to_string() }),
        )
    }

    pub async fn stop_listener(&self) {
        let mut guard = self.listener.lock().await;
        if let Some(mut state) = guard.take() {
            if let Some(announce_task) = state.announce_task.take() {
                announce_task.abort();
            }
            if let Some(handle) = state.handle.take() {
                handle.shutdown().await;
            }
            state.events_task.abort();
            let _ = state.events_task.await;
            if let Err(error) = state.staging.cleanup().await {
                tracing::warn!("rncp staging cleanup failed on stop: {error}");
            }
        }
        *self.staging.lock().await = None;
        let removed: Vec<String> = self
            .pending_offers
            .lock()
            .await
            .drain()
            .map(|(id, _)| id)
            .collect();
        for transfer_id in removed {
            emit(
                &self.event_tx,
                "rncp.cancelled",
                json!({ "transfer_id": transfer_id, "reason": "listener_stopped" }),
            );
        }
    }

    /// Queue one `rncp.receive` announce immediately (manual force / post dest-share).
    /// Failure point: listener off or identity missing private key — returns error.
    pub async fn announce_now(&self) -> Result<(), String> {
        let dest_hex = {
            let guard = self.listener.lock().await;
            let Some(state) = guard.as_ref() else {
                return Err("listener_not_enabled".into());
            };
            state.destination_hash.clone()
        };
        let dest_hash = parse_hash16(&dest_hex)?;
        send_rncp_listen_announce(&self.transport_tx, &self.identity, dest_hash).await
    }

    pub async fn listener_status(&self) -> serde_json::Value {
        let listener = self.listener.lock().await;
        let policy = self.policy.lock().await;
        let last_error = self.listener_error.lock().await.clone();
        json!({
            "enabled": listener.is_some(),
            "destination_hash": listener.as_ref().map(|s| s.destination_hash.clone()),
            "inbound_mode": policy.mode.as_str(),
            "allowed": policy.allowed.iter().cloned().collect::<Vec<_>>(),
            "blocked": policy.blocked.iter().cloned().collect::<Vec<_>>(),
            "last_error": last_error,
        })
    }

    pub async fn receive_destination_hash(&self) -> Option<String> {
        self.listener
            .lock()
            .await
            .as_ref()
            .map(|s| s.destination_hash.clone())
    }

    fn spawn_progress_forwarder(&self, transfer_id: String) -> mpsc::Sender<f32> {
        let (tx, mut rx) = mpsc::channel::<f32>(32);
        let event_tx = self.event_tx.clone();
        tokio::spawn(async move {
            while let Some(progress) = rx.recv().await {
                emit(
                    &event_tx,
                    "rncp.progress",
                    json!({ "transfer_id": transfer_id, "progress": progress }),
                );
            }
        });
        tx
    }
}

/// Build an `rncp.receive` announce packet (rncp-rs `Destination::announce_packet` shape).
pub fn build_rncp_listen_announce_packet(
    identity: &Identity,
    destination_hash: [u8; 16],
) -> Result<Vec<u8>, String> {
    let mut destination = Destination::new(
        Some(identity),
        Direction::In,
        DestType::Single,
        default_rncp_app_name(),
    )
    .map_err(|e| format!("rncp listen announce destination: {e}"))?;
    if destination.hash != destination_hash {
        return Err(format!(
            "rncp listen announce dest hash mismatch (expected {}, got {})",
            hex::encode(destination_hash),
            hex::encode(destination.hash)
        ));
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    destination
        .announce_packet(identity, None, None, false, None, now)
        .map_err(|e| format!("rncp listen announce packet: {e}"))
}

/// Queue one `rncp.receive` announce on the transport outbound channel.
pub async fn send_rncp_listen_announce(
    transport_tx: &mpsc::Sender<TransportMessage>,
    identity: &Identity,
    destination_hash: [u8; 16],
) -> Result<(), String> {
    let raw = build_rncp_listen_announce_packet(identity, destination_hash)?;
    transport_tx
        .send(TransportMessage::Outbound(OutboundRequest {
            raw: Bytes::from(raw),
            destination_hash,
        }))
        .await
        .map_err(|e| format!("Failed to send rncp listen announce: {e}"))
}

fn read_announce_interval_sec(config_dir: &Path) -> u32 {
    config::get_stack_settings(config_dir)
        .map(|s| s.announce_interval_sec)
        .unwrap_or(DEFAULT_ANNOUNCE_INTERVAL_SEC)
}

/// Startup announce (after settle) + periodic announces from stack `announce_interval_sec`.
/// When interval is `0`, only the one-shot after settle runs (rncp-rs parity).
fn spawn_listen_announcer(
    transport_tx: mpsc::Sender<TransportMessage>,
    identity: Identity,
    destination_hash: [u8; 16],
    config_dir: PathBuf,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        tokio::time::sleep(RNCP_LISTEN_ANNOUNCE_SETTLE).await;
        match send_rncp_listen_announce(&transport_tx, &identity, destination_hash).await {
            Ok(()) => tracing::info!("[rncp] listen announce sent"),
            Err(e) => tracing::warn!("[rncp] listen announce failed: {e}"),
        }

        loop {
            let interval_sec = read_announce_interval_sec(&config_dir);
            if interval_sec == 0 {
                break;
            }
            tokio::time::sleep(Duration::from_secs(u64::from(interval_sec))).await;
            match send_rncp_listen_announce(&transport_tx, &identity, destination_hash).await {
                Ok(()) => tracing::debug!(interval_sec, "[rncp] listen periodic announce sent"),
                Err(e) => tracing::warn!("[rncp] listen periodic announce failed: {e}"),
            }
        }
    })
}

/// Drives one listener's `RncpEvent` stream for the lifetime of that
/// listener. `policy` is a point-in-time snapshot taken when the listener
/// was started — sufficient for the ask-mode staging decision made per
/// verified payload (allow/blocked checks are still meaningful against a
/// slightly stale list; the underlying `allow_all_listed` Link-identify gate
/// itself only takes effect on the next `start_listener()` restart).
#[allow(clippy::too_many_arguments)] // security context and display paths stay explicit at this boundary
fn spawn_listener_event_loop(
    event_tx: broadcast::Sender<String>,
    policy: PolicyState,
    staging: Arc<RncpStaging>,
    overwrite: bool,
    display_save_dir: PathBuf,
    capability: Option<Arc<ConsumedPathCapability>>,
    pending_offers: Arc<Mutex<HashMap<String, PendingOffer>>>,
    mut events_rx: mpsc::Receiver<RncpEvent>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        while let Some(evt) = events_rx.recv().await {
            handle_rncp_event(
                &event_tx,
                &policy,
                &staging,
                overwrite,
                &display_save_dir,
                capability.as_ref(),
                &pending_offers,
                evt,
            )
            .await;
        }
    })
}

#[allow(clippy::too_many_arguments)] // security context and display paths stay explicit at this boundary
async fn handle_rncp_event(
    event_tx: &broadcast::Sender<String>,
    policy: &PolicyState,
    staging: &Arc<RncpStaging>,
    overwrite: bool,
    display_save_dir: &Path,
    capability: Option<&Arc<ConsumedPathCapability>>,
    pending_offers: &Arc<Mutex<HashMap<String, PendingOffer>>>,
    evt: RncpEvent,
) {
    match evt {
        RncpEvent::LinkEstablished { .. } => {}
        RncpEvent::SenderIdentified { identity_hash, .. } => {
            if policy.is_blocked(&hex::encode(identity_hash)) {
                tracing::debug!(
                    identity_hash = %hex::encode(identity_hash),
                    "rncp sender identified as blocked; pre-advertisement policy will reject"
                );
            }
        }
        RncpEvent::SenderDenied { .. } => {
            emit(event_tx, "rncp.failed", json!({ "reason": "not_allowed" }));
        }
        RncpEvent::AdmissionRejected {
            link_id: _,
            identity_hash,
            advertised_bytes,
            reason,
        } => {
            emit(
                event_tx,
                "rncp.failed",
                json!({
                    "reason": admission_reason(reason),
                    "bytes": advertised_bytes,
                    "identity_hash": identity_hash.map(hex::encode),
                }),
            );
        }
        RncpEvent::PayloadReady {
            link_id: _,
            resource_id,
            identity_hash,
            file_name,
            advertised_bytes: _,
            data,
            ack,
        } => {
            let _ack = PayloadAckGuard::new(ack);
            handle_verified_payload(
                event_tx,
                policy,
                staging,
                overwrite,
                display_save_dir,
                capability,
                pending_offers,
                resource_id,
                identity_hash,
                file_name,
                data,
            )
            .await;
        }
        RncpEvent::Completed {
            link_id: _,
            file_name,
            saved_path,
            bytes,
        } => {
            let _ = tokio::fs::remove_file(&saved_path).await;
            emit(
                event_tx,
                "rncp.failed",
                json!({
                    "reason": "unexpected_library_persistence",
                    "file_name": file_name,
                    "bytes": bytes,
                }),
            );
        }
        RncpEvent::WriteFailed {
            file_name, reason, ..
        } => {
            emit(
                event_tx,
                "rncp.failed",
                json!({ "file_name": file_name, "reason": reason }),
            );
        }
        RncpEvent::FetchServing {
            file_name, bytes, ..
        } => {
            tracing::debug!(file_name = ?file_name, bytes, "rncp fetch serving local file");
        }
        RncpEvent::FetchDenied { reason, .. } => {
            tracing::debug!(reason = %reason, "rncp fetch denied");
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn handle_verified_payload(
    event_tx: &broadcast::Sender<String>,
    policy: &PolicyState,
    staging: &Arc<RncpStaging>,
    overwrite: bool,
    display_save_dir: &Path,
    capability: Option<&Arc<ConsumedPathCapability>>,
    pending_offers: &Arc<Mutex<HashMap<String, PendingOffer>>>,
    resource_id: [u8; 32],
    identity_hash: [u8; 16],
    file_name: String,
    data: Arc<[u8]>,
) {
    let identity_hex = hex::encode(identity_hash);
    if policy.is_blocked(&identity_hex) {
        emit(
            event_tx,
            "rncp.failed",
            json!({
                "reason": "not_allowed",
                "file_name": file_name,
                "identity_hash": identity_hex,
            }),
        );
        return;
    }
    if data.len() as u64 > MAX_RNCP_FILE_BYTES {
        emit(
            event_tx,
            "rncp.failed",
            json!({
                "reason": "file_too_large",
                "file_name": file_name,
                "bytes": data.len(),
                "identity_hash": identity_hex,
            }),
        );
        return;
    }

    let payload_bytes = data.len();
    let pending = policy.mode == InboundMode::Ask && !policy.is_allowed(&identity_hex);
    match staging
        .store(
            resource_id,
            identity_hash,
            file_name.clone(),
            data,
            pending,
            overwrite,
        )
        .await
    {
        Ok(StoreOutcome::Pending {
            transfer_id,
            file_name,
            bytes,
            identity_hash,
        }) => {
            pending_offers.lock().await.insert(
                transfer_id.clone(),
                PendingOffer {
                    file_name: file_name.clone(),
                    bytes,
                    identity_hash: Some(identity_hash.clone()),
                    overwrite,
                    display_save_dir: display_save_dir.to_path_buf(),
                    _path_capability: capability.cloned(),
                },
            );
            emit(
                event_tx,
                "rncp.offer",
                json!({
                    "transfer_id": transfer_id,
                    "file_name": file_name,
                    "bytes": bytes,
                    "identity_hash": identity_hash,
                }),
            );
        }
        Ok(StoreOutcome::Promoted {
            file_name,
            path: _promoted_path,
            bytes,
            identity_hash,
        }) => {
            let display_path = display_save_dir.join(&file_name);
            tracing::info!(
                kind = "receive",
                file_name = ?file_name,
                bytes,
                identity_hash = %identity_hash,
                path = %display_path.display(),
                "[rncp] transfer completed"
            );
            emit(
                event_tx,
                "rncp.completed",
                json!({
                    "file_name": file_name,
                    "bytes": bytes,
                    "path": display_path.display().to_string(),
                    "identity_hash": identity_hash,
                }),
            );
        }
        Err(reason) => {
            emit(
                event_tx,
                "rncp.failed",
                json!({
                    "reason": reason,
                    "file_name": file_name,
                    "bytes": payload_bytes,
                    "identity_hash": identity_hex,
                }),
            );
        }
    }
}

fn local_filename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

fn prune_finished_transfers(active: &mut HashMap<String, ActiveTransfer>) {
    let finished: Vec<String> = active
        .iter()
        .filter(|(_, t)| t.thread.is_finished())
        .map(|(id, _)| id.clone())
        .collect();
    for id in finished {
        active.remove(&id);
    }
}

#[allow(clippy::needless_pass_by_value)] // payload is moved into the broadcast frame
fn emit(event_tx: &broadcast::Sender<String>, event_type: &str, payload: serde_json::Value) {
    let frame = json!({ "type": event_type, "payload": payload });
    let _ = event_tx.send(frame.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inbound_mode_parse() {
        assert_eq!(InboundMode::parse("off"), Ok(InboundMode::Off));
        assert_eq!(InboundMode::parse("ask"), Ok(InboundMode::Ask));
        assert_eq!(
            InboundMode::parse("allow_all_listed"),
            Ok(InboundMode::AllowAllListed)
        );
        assert!(InboundMode::parse("bogus").is_err());
        assert_eq!(InboundMode::Off.as_str(), "off");
        assert_eq!(InboundMode::Ask.as_str(), "ask");
        assert_eq!(InboundMode::AllowAllListed.as_str(), "allow_all_listed");
    }

    #[test]
    fn policy_allowed_blocked() {
        let policy = PolicyState {
            mode: InboundMode::Ask,
            allowed: HashSet::from(["aa".to_string()]),
            blocked: HashSet::from(["bb".to_string()]),
        };
        assert!(policy.is_allowed("aa"));
        assert!(!policy.is_allowed("bb"));
        assert!(policy.is_blocked("bb"));
        assert!(!policy.is_blocked("aa"));

        let default = PolicyState::default();
        assert_eq!(default.mode, InboundMode::Off);
        assert!(!default.is_allowed("aa"));
        assert!(!default.is_blocked("bb"));
    }

    #[test]
    fn max_file_bytes_is_25_mib() {
        assert_eq!(MAX_RNCP_FILE_BYTES, 25 * 1024 * 1024);
    }

    #[test]
    fn pending_offer_cap_is_bounded() {
        assert_eq!(MAX_PENDING_OFFERS, 16);
    }

    #[test]
    fn transfer_kind_as_str() {
        assert_eq!(TransferKind::Send.as_str(), "send");
        assert_eq!(TransferKind::Fetch.as_str(), "fetch");
    }

    #[test]
    fn local_filename_falls_back_to_input() {
        assert_eq!(local_filename("/a/b/c.txt"), "c.txt");
        assert_eq!(local_filename("plain.bin"), "plain.bin");
    }

    // ── manager-level tests (dead transport fails link tasks fast) ──

    const TEST_DEST: &str = "aabbccddeeff00112233445566778899";

    fn test_manager(storage_dir: &Path) -> (RncpTransferManager, broadcast::Receiver<String>) {
        let (transport_tx, transport_rx) = mpsc::channel::<TransportMessage>(8);
        drop(transport_rx);
        let (event_tx, event_rx) = broadcast::channel::<String>(64);
        (
            RncpTransferManager::spawn(
                transport_tx,
                Identity::new(),
                event_tx,
                storage_dir.to_path_buf(),
            ),
            event_rx,
        )
    }

    async fn recv_event_of_type(
        rx: &mut broadcast::Receiver<String>,
        event_type: &str,
    ) -> serde_json::Value {
        loop {
            let frame = tokio::time::timeout(Duration::from_secs(10), rx.recv())
                .await
                .expect("event before timeout")
                .expect("event channel open");
            let parsed: serde_json::Value = serde_json::from_str(&frame).expect("valid frame");
            if parsed["type"] == event_type {
                return parsed["payload"].clone();
            }
        }
    }

    #[tokio::test]
    async fn send_rejects_oversize_and_invalid_destination() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (manager, _rx) = test_manager(dir.path());

        assert!(
            manager
                .send(
                    TEST_DEST,
                    vec![0; MAX_RNCP_FILE_BYTES as usize + 1],
                    "oversize.bin".into(),
                    None,
                )
                .await
                .is_err()
        );
        assert!(
            manager
                .send("nope", Vec::new(), "x".into(), None)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn send_tracks_transfer_and_fails_on_dead_transport() {
        let dir = tempfile::tempdir().expect("tempdir");
        let local = dir.path().join("hello.txt");
        tokio::fs::write(&local, b"hello").await.expect("write");
        let (manager, mut rx) = test_manager(dir.path());

        let transfer_id = manager
            .send(
                TEST_DEST,
                b"hello".to_vec(),
                local.display().to_string(),
                None,
            )
            .await
            .expect("send starts");
        let failed = recv_event_of_type(&mut rx, "rncp.failed").await;
        assert_eq!(failed["transfer_id"], transfer_id);
        assert_eq!(failed["destination_hash"], TEST_DEST);
    }

    #[tokio::test]
    async fn fetch_tracks_transfer_and_fails_on_dead_transport() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (manager, mut rx) = test_manager(dir.path());

        assert!(
            manager
                .fetch(
                    "bad",
                    "remote.txt",
                    dir.path().join("dl"),
                    dir.path().join("dl"),
                    None,
                )
                .await
                .is_err()
        );
        let transfer_id = manager
            .fetch(
                TEST_DEST,
                "remote.txt",
                dir.path().join("dl"),
                dir.path().join("dl"),
                None,
            )
            .await
            .expect("fetch starts");
        let failed = recv_event_of_type(&mut rx, "rncp.failed").await;
        assert_eq!(failed["transfer_id"], transfer_id);
        assert_eq!(failed["destination_hash"], TEST_DEST);
    }

    #[tokio::test]
    async fn cancel_active_transfer_emits_cancelled() {
        let dir = tempfile::tempdir().expect("tempdir");
        let local = dir.path().join("hello.txt");
        tokio::fs::write(&local, b"hello").await.expect("write");
        let (manager, mut rx) = test_manager(dir.path());

        let transfer_id = manager
            .send(
                TEST_DEST,
                b"hello".to_vec(),
                local.display().to_string(),
                None,
            )
            .await
            .expect("send starts");
        manager.cancel(&transfer_id).await.expect("cancel");
        let cancelled = recv_event_of_type(&mut rx, "rncp.cancelled").await;
        assert_eq!(cancelled["transfer_id"], transfer_id);
        // Unknown id: neither active nor a pending offer.
        assert!(manager.cancel("unknown").await.is_err());
    }

    #[tokio::test]
    async fn accept_moves_staged_offer_and_reject_deletes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (manager, mut rx) = test_manager(dir.path());
        let staging = Arc::new(
            RncpStaging::open(dir.path().to_path_buf())
                .await
                .expect("staging"),
        );
        *manager.staging.lock().await = Some(Arc::clone(&staging));

        let StoreOutcome::Pending { transfer_id, .. } = staging
            .store(
                [1; 32],
                [2; 16],
                "keep.txt".into(),
                Arc::from(&b"keep.txt"[..]),
                true,
                false,
            )
            .await
            .expect("stage")
        else {
            panic!("expected pending offer")
        };
        manager.pending_offers.lock().await.insert(
            transfer_id.clone(),
            PendingOffer {
                file_name: "keep.txt".into(),
                bytes: 8,
                identity_hash: Some(hex::encode([2; 16])),
                overwrite: false,
                display_save_dir: dir.path().to_path_buf(),
                _path_capability: None,
            },
        );
        let payload = manager.accept(&transfer_id).await.expect("accept");
        assert_eq!(payload["file_name"], "keep.txt");
        let completed = recv_event_of_type(&mut rx, "rncp.completed").await;
        assert_eq!(completed["transfer_id"], transfer_id);
        let final_path = dir.path().join("keep.txt");
        assert_eq!(
            tokio::fs::read(&final_path).await.expect("accepted file"),
            b"keep.txt"
        );
        assert!(manager.accept(&transfer_id).await.is_err());

        let StoreOutcome::Pending { transfer_id, .. } = staging
            .store(
                [3; 32],
                [4; 16],
                "drop.txt".into(),
                Arc::from(&b"drop.txt"[..]),
                true,
                false,
            )
            .await
            .expect("stage")
        else {
            panic!("expected pending offer")
        };
        manager.pending_offers.lock().await.insert(
            transfer_id.clone(),
            PendingOffer {
                file_name: "drop.txt".into(),
                bytes: 8,
                identity_hash: Some(hex::encode([4; 16])),
                overwrite: false,
                display_save_dir: dir.path().to_path_buf(),
                _path_capability: None,
            },
        );
        manager.reject(&transfer_id).await.expect("reject");
        let cancelled = recv_event_of_type(&mut rx, "rncp.cancelled").await;
        assert_eq!(cancelled["reason"], "rejected");
        assert!(manager.reject(&transfer_id).await.is_err());
    }

    #[tokio::test]
    async fn configure_policy_normalizes_and_listener_status_reports() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (manager, _rx) = test_manager(dir.path());

        assert!(
            manager
                .configure_policy("bogus", vec![], vec![])
                .await
                .is_err()
        );
        manager
            .configure_policy(
                "ask",
                vec!["  AA11  ".to_string(), String::new()],
                vec!["BB22".to_string()],
            )
            .await
            .expect("policy set");
        let status = manager.listener_status().await;
        assert_eq!(status["enabled"], false);
        assert_eq!(status["inbound_mode"], "ask");
        assert_eq!(status["allowed"].as_array().expect("allowed").len(), 1);
        assert_eq!(status["allowed"][0], "aa11");
        assert_eq!(status["blocked"][0], "bb22");
        assert_eq!(manager.receive_destination_hash().await, None);
    }

    #[tokio::test]
    async fn remembered_listener_directory_resumes_without_fresh_picker_capability() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (transport_tx, _transport_rx) = mpsc::channel::<TransportMessage>(32);
        let (event_tx, _event_rx) = broadcast::channel::<String>(64);
        let manager = RncpTransferManager::spawn(
            transport_tx,
            Identity::new(),
            event_tx,
            dir.path().to_path_buf(),
        );
        manager
            .configure_policy("ask", vec![], vec![])
            .await
            .expect("policy");
        let inbox = dir.path().join("inbox");
        for _ in 0..2 {
            manager
                .start_listener(inbox.clone(), inbox.clone(), false, None, false, None)
                .await
                .expect("resume remembered directory");
            assert_eq!(manager.listener_status().await["enabled"], true);
            manager.stop_listener().await;
        }
    }

    #[tokio::test]
    async fn start_listener_rejects_off_policy_and_missing_fetch_jail() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (manager, _rx) = test_manager(dir.path());

        let err = manager
            .start_listener(
                dir.path().join("inbox"),
                dir.path().join("inbox"),
                true,
                None,
                false,
                None,
            )
            .await
            .expect_err("missing jail rejected");
        assert!(err.contains("fetch_jail"));

        let err = manager
            .start_listener(
                dir.path().join("inbox"),
                dir.path().join("inbox"),
                false,
                None,
                false,
                None,
            )
            .await
            .expect_err("off policy rejected");
        assert!(err.contains("policy=off"));
    }

    // ── listener event-loop tests ──

    struct EventLoopFixture {
        event_tx: broadcast::Sender<String>,
        event_rx: broadcast::Receiver<String>,
        policy: PolicyState,
        staging: Arc<RncpStaging>,
        overwrite: bool,
        pending_offers: Arc<Mutex<HashMap<String, PendingOffer>>>,
        dir: tempfile::TempDir,
    }

    async fn event_loop_fixture(policy: PolicyState) -> EventLoopFixture {
        let dir = tempfile::tempdir().expect("tempdir");
        let (event_tx, event_rx) = broadcast::channel::<String>(64);
        let staging = Arc::new(
            RncpStaging::open(dir.path().to_path_buf())
                .await
                .expect("staging"),
        );
        EventLoopFixture {
            event_tx,
            event_rx,
            policy,
            staging,
            overwrite: false,
            pending_offers: Arc::new(Mutex::new(HashMap::new())),
            dir,
        }
    }

    impl EventLoopFixture {
        async fn dispatch(&mut self, evt: RncpEvent) {
            handle_rncp_event(
                &self.event_tx,
                &self.policy,
                &self.staging,
                self.overwrite,
                self.dir.path(),
                None,
                &self.pending_offers,
                evt,
            )
            .await;
        }
    }

    fn ask_policy(allowed: &[&str], blocked: &[&str]) -> PolicyState {
        PolicyState {
            mode: InboundMode::Ask,
            allowed: allowed.iter().map(|s| (*s).to_string()).collect(),
            blocked: blocked.iter().map(|s| (*s).to_string()).collect(),
        }
    }

    #[tokio::test]
    async fn verified_unlisted_payload_becomes_a_manifest_owned_offer() {
        let sender = [0xAA; 16];
        let mut fx = event_loop_fixture(ask_policy(&[], &[])).await;
        handle_verified_payload(
            &fx.event_tx,
            &fx.policy,
            &fx.staging,
            false,
            fx.dir.path(),
            None,
            &fx.pending_offers,
            [1; 32],
            sender,
            "offer.txt".into(),
            Arc::from(&b"offer"[..]),
        )
        .await;

        let offer = recv_event_of_type(&mut fx.event_rx, "rncp.offer").await;
        assert_eq!(offer["file_name"], "offer.txt");
        assert_eq!(offer["identity_hash"], hex::encode(sender));
        assert_eq!(fx.pending_offers.lock().await.len(), 1);
        assert!(!fx.dir.path().join("offer.txt").exists());
    }

    #[tokio::test]
    async fn verified_allowed_payload_is_promoted_directly() {
        let sender = [0xBB; 16];
        let mut fx = event_loop_fixture(ask_policy(&[&hex::encode(sender)], &[])).await;
        handle_verified_payload(
            &fx.event_tx,
            &fx.policy,
            &fx.staging,
            false,
            fx.dir.path(),
            None,
            &fx.pending_offers,
            [2; 32],
            sender,
            "direct.txt".into(),
            Arc::from(&b"direct"[..]),
        )
        .await;

        let completed = recv_event_of_type(&mut fx.event_rx, "rncp.completed").await;
        assert_eq!(completed["file_name"], "direct.txt");
        assert_eq!(
            std::fs::read(fx.dir.path().join("direct.txt")).unwrap(),
            b"direct"
        );
        assert!(fx.pending_offers.lock().await.is_empty());
    }

    #[tokio::test]
    async fn verified_blocked_payload_is_not_persisted() {
        let sender = [0xCC; 16];
        let mut fx = event_loop_fixture(ask_policy(&[], &[&hex::encode(sender)])).await;
        handle_verified_payload(
            &fx.event_tx,
            &fx.policy,
            &fx.staging,
            false,
            fx.dir.path(),
            None,
            &fx.pending_offers,
            [3; 32],
            sender,
            "blocked.txt".into(),
            Arc::from(&b"blocked"[..]),
        )
        .await;

        let failed = recv_event_of_type(&mut fx.event_rx, "rncp.failed").await;
        assert_eq!(failed["reason"], "not_allowed");
        assert!(!fx.dir.path().join("blocked.txt").exists());
        assert!(fx.pending_offers.lock().await.is_empty());
    }

    #[tokio::test]
    async fn unexpected_library_persistence_is_removed() {
        let mut fx = event_loop_fixture(ask_policy(&[], &[])).await;
        let saved = fx.dir.path().join("unexpected.txt");
        tokio::fs::write(&saved, b"unexpected")
            .await
            .expect("write unexpected file");

        fx.dispatch(RncpEvent::Completed {
            link_id: [3; 16],
            file_name: "unexpected.txt".to_string(),
            saved_path: saved.clone(),
            bytes: 10,
        })
        .await;

        let failed = recv_event_of_type(&mut fx.event_rx, "rncp.failed").await;
        assert_eq!(failed["reason"], "unexpected_library_persistence");
        assert!(tokio::fs::metadata(saved).await.is_err());
    }

    #[tokio::test]
    async fn admission_rejection_reports_specific_reason() {
        let mut fx = event_loop_fixture(ask_policy(&[], &[])).await;
        fx.dispatch(RncpEvent::AdmissionRejected {
            link_id: [4; 16],
            identity_hash: Some([0xCC; 16]),
            advertised_bytes: (MAX_RNCP_FILE_BYTES + 1) as usize,
            reason: RncpAdmissionReason::FileTooLarge,
        })
        .await;
        let failed = recv_event_of_type(&mut fx.event_rx, "rncp.failed").await;
        assert_eq!(failed["reason"], "file_too_large");
        assert_eq!(failed["identity_hash"], hex::encode([0xCC; 16]));
    }

    #[tokio::test]
    async fn denied_and_write_failed_events_report_failures() {
        let mut fx = event_loop_fixture(ask_policy(&[], &[])).await;

        fx.dispatch(RncpEvent::SenderDenied {
            link_id: [6; 16],
            identity_hash: [0xDD; 16],
        })
        .await;
        let denied = recv_event_of_type(&mut fx.event_rx, "rncp.failed").await;
        assert_eq!(denied["reason"], "not_allowed");

        fx.dispatch(RncpEvent::WriteFailed {
            link_id: [7; 16],
            file_name: "w.txt".to_string(),
            reason: "disk full".to_string(),
        })
        .await;
        let write_failed = recv_event_of_type(&mut fx.event_rx, "rncp.failed").await;
        assert_eq!(write_failed["reason"], "disk full");

        // No-op informational events must not panic or emit failures.
        fx.dispatch(RncpEvent::LinkEstablished { link_id: [8; 16] })
            .await;
        fx.dispatch(RncpEvent::FetchServing {
            link_id: [8; 16],
            file_name: "s.txt".to_string(),
            bytes: 1,
        })
        .await;
        fx.dispatch(RncpEvent::FetchDenied {
            link_id: [8; 16],
            reason: "jail".to_string(),
        })
        .await;
    }

    #[test]
    fn prune_finished_transfers_drops_only_finished_threads() {
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let running_thread = std::thread::spawn(move || {
            let _ = release_rx.recv_timeout(Duration::from_secs(10));
        });
        let finished_thread = std::thread::spawn(|| {});
        while !finished_thread.is_finished() {
            std::thread::sleep(Duration::from_millis(5));
        }

        let make_transfer = |thread: std::thread::JoinHandle<()>| ActiveTransfer {
            kind: TransferKind::Send,
            destination_hash: TEST_DEST.to_string(),
            file_name: None,
            cancel_tx: Some(oneshot::channel::<()>().0),
            thread,
            _path_capability: None,
        };
        let mut active = HashMap::new();
        active.insert("finished".to_string(), make_transfer(finished_thread));
        active.insert("running".to_string(), make_transfer(running_thread));

        prune_finished_transfers(&mut active);
        assert!(!active.contains_key("finished"));
        assert!(active.contains_key("running"));
        release_tx.send(()).expect("release running thread");
    }

    #[test]
    fn build_rncp_listen_announce_packet_is_non_empty() {
        let identity = Identity::new();
        let dest = Destination::new(
            Some(&identity),
            Direction::In,
            DestType::Single,
            default_rncp_app_name(),
        )
        .expect("rncp dest");
        let raw = build_rncp_listen_announce_packet(&identity, dest.hash).expect("announce");
        assert!(raw.len() > 16);
    }

    #[test]
    fn listen_announce_settle_is_two_seconds() {
        assert_eq!(RNCP_LISTEN_ANNOUNCE_SETTLE, Duration::from_secs(2));
    }

    #[tokio::test]
    async fn announce_now_requires_enabled_listener() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (manager, _rx) = test_manager(dir.path());
        let err = manager.announce_now().await.expect_err("listener off");
        assert_eq!(err, "listener_not_enabled");
    }

    #[tokio::test]
    async fn announce_now_queues_outbound_when_listener_enabled() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (transport_tx, mut transport_rx) = mpsc::channel::<TransportMessage>(8);
        let (event_tx, _event_rx) = broadcast::channel::<String>(64);
        let manager = RncpTransferManager::spawn(
            transport_tx,
            Identity::new(),
            event_tx,
            dir.path().to_path_buf(),
        );
        manager
            .configure_policy("ask", vec![], vec![])
            .await
            .expect("policy");
        manager
            .start_listener(
                dir.path().join("inbox"),
                dir.path().join("inbox"),
                false,
                None,
                false,
                None,
            )
            .await
            .expect("listener start");

        manager.announce_now().await.expect("announce");

        let mut got_outbound = false;
        for _ in 0..8 {
            let msg = tokio::time::timeout(Duration::from_secs(2), transport_rx.recv())
                .await
                .expect("outbound before timeout")
                .expect("transport open");
            match msg {
                TransportMessage::Outbound(OutboundRequest {
                    raw,
                    destination_hash,
                }) => {
                    assert!(raw.len() > 16);
                    assert_eq!(
                        hex::encode(destination_hash),
                        manager.receive_destination_hash().await.expect("dest hash")
                    );
                    got_outbound = true;
                    break;
                }
                TransportMessage::RegisterDestination { .. } => {}
                other => panic!("unexpected transport message: {other:?}"),
            }
        }
        assert!(
            got_outbound,
            "expected Outbound announce after RegisterDestination"
        );

        manager.stop_listener().await;
    }

    fn write_announce_interval_config(config_dir: &Path, interval_sec: u32) {
        config::write_config(
            config_dir,
            &format!(
                r#"[reticulum]
enable_transport = No
share_instance = No
announce_interval_sec = {interval_sec}

[logging]
loglevel = 4
"#
            ),
        )
        .expect("write announce interval config");
    }

    fn count_outbound(rx: &mut mpsc::Receiver<TransportMessage>) -> usize {
        let mut n = 0;
        while let Ok(msg) = rx.try_recv() {
            if matches!(msg, TransportMessage::Outbound(_)) {
                n += 1;
            }
        }
        n
    }

    #[tokio::test(start_paused = true)]
    async fn listen_announcer_one_shot_when_interval_zero() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_announce_interval_config(dir.path(), 0);
        let (transport_tx, mut transport_rx) = mpsc::channel::<TransportMessage>(32);
        let (event_tx, _event_rx) = broadcast::channel::<String>(8);
        let manager = RncpTransferManager::spawn(
            transport_tx,
            Identity::new(),
            event_tx,
            dir.path().to_path_buf(),
        );
        manager
            .configure_policy("ask", vec![], vec![])
            .await
            .expect("policy");
        manager
            .start_listener(
                dir.path().join("inbox"),
                dir.path().join("inbox"),
                false,
                None,
                false,
                None,
            )
            .await
            .expect("listener start");

        // Let the announcer task park on settle sleep before advancing virtual time.
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
        tokio::time::advance(RNCP_LISTEN_ANNOUNCE_SETTLE + Duration::from_millis(1)).await;
        for _ in 0..16 {
            tokio::task::yield_now().await;
        }
        assert_eq!(
            count_outbound(&mut transport_rx),
            1,
            "startup announce only"
        );

        tokio::time::advance(Duration::from_secs(3_600)).await;
        for _ in 0..16 {
            tokio::task::yield_now().await;
        }
        assert_eq!(
            count_outbound(&mut transport_rx),
            0,
            "interval 0 must not re-announce"
        );

        manager.stop_listener().await;
    }

    #[tokio::test(start_paused = true)]
    async fn listen_announcer_periodic_when_interval_positive() {
        let dir = tempfile::tempdir().expect("tempdir");
        write_announce_interval_config(dir.path(), 5);
        let (transport_tx, mut transport_rx) = mpsc::channel::<TransportMessage>(32);
        let (event_tx, _event_rx) = broadcast::channel::<String>(8);
        let manager = RncpTransferManager::spawn(
            transport_tx,
            Identity::new(),
            event_tx,
            dir.path().to_path_buf(),
        );
        manager
            .configure_policy("ask", vec![], vec![])
            .await
            .expect("policy");
        manager
            .start_listener(
                dir.path().join("inbox"),
                dir.path().join("inbox"),
                false,
                None,
                false,
                None,
            )
            .await
            .expect("listener start");

        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
        tokio::time::advance(RNCP_LISTEN_ANNOUNCE_SETTLE + Duration::from_millis(1)).await;
        for _ in 0..16 {
            tokio::task::yield_now().await;
        }
        assert_eq!(count_outbound(&mut transport_rx), 1, "settle announce");

        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
        tokio::time::advance(Duration::from_secs(5) + Duration::from_millis(1)).await;
        for _ in 0..16 {
            tokio::task::yield_now().await;
        }
        assert_eq!(count_outbound(&mut transport_rx), 1, "periodic announce");

        manager.stop_listener().await;
    }
}

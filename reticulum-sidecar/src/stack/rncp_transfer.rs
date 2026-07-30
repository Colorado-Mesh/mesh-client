//! rncp (file transfer) send/fetch driving + inbound listener policy.
//!
//! Outbound `send()` / `fetch()` each drive one `rncp_send_file` /
//! `rncp_fetch_file` call on a dedicated OS thread via [`super::link_task`]
//! (their futures are not `Send`), tracked by `transfer_id` so the HTTP
//! layer can poll progress and cancel.
//!
//! Inbound transfers are more involved: `rns_runtime::rncp::spawn_rncp_listener`
//! only gates senders at Link-identify time (`allow_all` / `allowed`); once a
//! sender is let through it receives and writes the resource straight to
//! `save_dir` with no further app-level checkpoint before completion. To
//! approximate an "ask" policy (prompt before a file becomes visible) we run
//! the listener with `allow_all: true` when policy mode is `ask`, then — on
//! each `RncpEvent::Completed` — either pass allow-listed senders' files
//! straight through, or move everyone else's already-fully-received file
//! into a hidden staging subdirectory and surface it as an `rncp.offer` that
//! only becomes a real file on explicit `accept()` (`reject()` deletes the
//! staged file instead). `allow_all_listed` mode instead gates at the
//! listener's own `allow_all: false` + `allowed` check, so unlisted senders
//! never even complete a transfer.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use rns_identity::destination::{DestType, Destination, Direction};
use rns_identity::identity::Identity;
use rns_runtime::rncp::{
    RncpEvent, RncpFetchRequest, RncpListenerConfig, RncpListenerHandle, RncpSendRequest,
    default_rncp_app_name, rncp_fetch_file, rncp_send_file, spawn_rncp_listener,
};
use rns_transport::messages::{OutboundRequest, TransportMessage};
use serde_json::json;
use tokio::sync::{Mutex, broadcast, mpsc, oneshot};
use uuid::Uuid;

use super::config::{self, DEFAULT_ANNOUNCE_INTERVAL_SEC};
use super::link_task::spawn_link_task;
use super::live::parse_hash16;

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
/// Cap on staged ask-mode inbound offers awaiting accept()/reject(); further
/// completed transfers are deleted and reported as failed until the backlog
/// drains (prevents unbounded disk growth in the hidden staging dir).
const MAX_PENDING_RNCP_OFFERS: usize = 16;
const RNCP_PATH_WAIT: Duration = Duration::from_secs(30);
/// Generous ceiling for a bounded (25 MiB) transfer over a possibly
/// RF-speed-constrained Reticulum path.
const RNCP_TRANSFER_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Subdirectory (under a listener's `save_dir`) used to stage files from
/// senders that are not allow-listed until `accept()`/`reject()`.
const STAGING_DIR_NAME: &str = ".rncp-pending";
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
}

struct PendingOffer {
    staged_path: PathBuf,
    original_save_dir: PathBuf,
    file_name: String,
    bytes: usize,
    identity_hash: Option<String>,
}

struct ListenerState {
    handle: Option<RncpListenerHandle>,
    destination_hash: String,
    events_task: tokio::task::JoinHandle<()>,
    announce_task: Option<tokio::task::JoinHandle<()>>,
}

pub struct RncpTransferManager {
    transport_tx: mpsc::Sender<TransportMessage>,
    identity: Identity,
    event_tx: broadcast::Sender<String>,
    #[allow(dead_code)] // retained for future default save/fetch dir helpers
    storage_dir: PathBuf,
    /// rnsd config dir — used to read `announce_interval_sec` for listen announces.
    config_dir: PathBuf,
    active: Mutex<HashMap<String, ActiveTransfer>>,
    pending_offers: Arc<Mutex<HashMap<String, PendingOffer>>>,
    listener: Mutex<Option<ListenerState>>,
    policy: Mutex<PolicyState>,
}

impl RncpTransferManager {
    pub fn spawn(
        transport_tx: mpsc::Sender<TransportMessage>,
        identity: Identity,
        event_tx: broadcast::Sender<String>,
        storage_dir: PathBuf,
        config_dir: PathBuf,
    ) -> Self {
        Self {
            transport_tx,
            identity,
            event_tx,
            storage_dir,
            config_dir,
            active: Mutex::new(HashMap::new()),
            pending_offers: Arc::new(Mutex::new(HashMap::new())),
            listener: Mutex::new(None),
            policy: Mutex::new(PolicyState::default()),
        }
    }

    /// Reads `local_path` and drives an `rncp_send_file` task, returning the
    /// new `transfer_id` immediately (progress/terminal state arrive via
    /// `rncp.progress` / `rncp.completed` / `rncp.failed` WS events).
    pub async fn send(
        &self,
        destination_hash_hex: &str,
        local_path: &str,
    ) -> Result<String, String> {
        let dest_hash = parse_hash16(destination_hash_hex)?;
        let path = PathBuf::from(local_path);
        let metadata = tokio::fs::metadata(&path)
            .await
            .map_err(|e| format!("stat {}: {e}", path.display()))?;
        if !metadata.is_file() {
            return Err(format!("{} is not a regular file", path.display()));
        }
        if metadata.len() > MAX_RNCP_FILE_BYTES {
            return Err(format!(
                "file exceeds max transfer size of {MAX_RNCP_FILE_BYTES} bytes"
            ));
        }
        let file_name = path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .ok_or_else(|| "path has no file name".to_string())?;
        let data = tokio::fs::read(&path)
            .await
            .map_err(|e| format!("read {}: {e}", path.display()))?;

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
        // `rncp_send_file`'s future is not `Send` — build and drive it
        // entirely on the dedicated thread `spawn_link_task` gives us (see
        // that module for why).
        let (thread, cancel_tx) =
            spawn_link_task(format!("rncp-send-{transfer_id}"), move || async move {
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
                file_name: Some(local_filename(local_path)),
                cancel_tx: Some(cancel_tx),
                thread,
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
        // `rncp_fetch_file`'s future is not `Send` — see `send()` above.
        let (thread, cancel_tx) =
            spawn_link_task(format!("rncp-fetch-{transfer_id}"), move || async move {
                let result = rncp_fetch_file(RncpFetchRequest {
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
                            path = %outcome.saved_path.display(),
                            "[rncp] transfer completed"
                        );
                        emit(
                            &event_tx,
                            "rncp.completed",
                            json!({
                                "transfer_id": tid,
                                "file_name": outcome.file_name,
                                "bytes": outcome.bytes,
                                "path": outcome.saved_path.display().to_string(),
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

    /// Moves a staged inbound offer into its listener's real `save_dir`,
    /// sanitizing/deduplicating the filename.
    pub async fn accept(&self, transfer_id: &str) -> Result<serde_json::Value, String> {
        let offer = {
            let mut offers = self.pending_offers.lock().await;
            offers
                .remove(transfer_id)
                .ok_or_else(|| "no pending rncp offer with that id".to_string())?
        };
        tokio::fs::create_dir_all(&offer.original_save_dir)
            .await
            .map_err(|e| format!("create save dir: {e}"))?;
        let safe_name = sanitize_filename(&offer.file_name);
        let final_path = dedupe_path(&offer.original_save_dir, &safe_name).await;
        tokio::fs::rename(&offer.staged_path, &final_path)
            .await
            .map_err(|e| format!("accept: move staged file failed: {e}"))?;
        let final_name = final_path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or(safe_name);
        tracing::info!(
            kind = "accept",
            transfer_id = %transfer_id,
            file_name = ?final_name,
            bytes = offer.bytes,
            identity_hash = offer.identity_hash.as_deref().unwrap_or(""),
            path = %final_path.display(),
            "[rncp] transfer completed"
        );
        let payload = json!({
            "transfer_id": transfer_id,
            "file_name": final_name,
            "bytes": offer.bytes,
            "path": final_path.display().to_string(),
            "identity_hash": offer.identity_hash,
        });
        emit(&self.event_tx, "rncp.completed", payload.clone());
        Ok(payload)
    }

    /// Deletes a staged inbound offer without saving it.
    pub async fn reject(&self, transfer_id: &str) -> Result<(), String> {
        let offer = {
            let mut offers = self.pending_offers.lock().await;
            offers
                .remove(transfer_id)
                .ok_or_else(|| "no pending rncp offer with that id".to_string())?
        };
        let _ = tokio::fs::remove_file(&offer.staged_path).await;
        emit(
            &self.event_tx,
            "rncp.cancelled",
            json!({ "transfer_id": transfer_id, "reason": "rejected" }),
        );
        Ok(())
    }

    pub async fn status(&self) -> serde_json::Value {
        let active = self.active.lock().await;
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

    /// Starts (or restarts) the inbound listener using the currently
    /// configured policy: `allow_all_listed` maps to the underlying
    /// library's `allow_all: false` + `allowed` gate (unlisted senders never
    /// complete a transfer); `ask` maps to `allow_all: true` with our own
    /// staging layered on top (see module docs); `off` is rejected here —
    /// callers should `stop_listener()` instead.
    ///
    /// After register, starts a listen announcer (rncp-rs parity) so peers can
    /// resolve the receive destination pubkey/path — registration alone is not
    /// enough for `rncp_send`'s announce-cache lookup.
    pub async fn start_listener(
        &self,
        save_dir: PathBuf,
        allow_fetch: bool,
        fetch_jail: Option<PathBuf>,
        overwrite: bool,
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

        tokio::fs::create_dir_all(&save_dir)
            .await
            .map_err(|e| format!("create save dir {}: {e}", save_dir.display()))?;

        let (events_tx, events_rx) = mpsc::channel::<RncpEvent>(128);
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
        };
        let handle = spawn_rncp_listener(self.transport_tx.clone(), listener_cfg, events_tx)
            .await
            .map_err(|e| e.to_string())?;
        let dest_hash_bytes = handle.destination_hash();
        let destination_hash = hex::encode(dest_hash_bytes);

        let events_task = spawn_listener_event_loop(
            self.event_tx.clone(),
            policy,
            save_dir.clone(),
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
        });

        Ok(
            json!({ "destination_hash": destination_hash, "save_dir": save_dir.display().to_string() }),
        )
    }

    pub async fn stop_listener(&self) {
        let mut guard = self.listener.lock().await;
        if let Some(mut state) = guard.take() {
            if let Some(announce_task) = state.announce_task.take() {
                announce_task.abort();
            }
            state.events_task.abort();
            if let Some(handle) = state.handle.take() {
                handle.shutdown().await;
            }
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
        json!({
            "enabled": listener.is_some(),
            "destination_hash": listener.as_ref().map(|s| s.destination_hash.clone()),
            "inbound_mode": policy.mode.as_str(),
            "allowed": policy.allowed.iter().cloned().collect::<Vec<_>>(),
            "blocked": policy.blocked.iter().cloned().collect::<Vec<_>>(),
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
/// `Completed` event (allow/blocked checks are still meaningful against a
/// slightly stale list; the underlying `allow_all_listed` Link-identify gate
/// itself only takes effect on the next `start_listener()` restart).
fn spawn_listener_event_loop(
    event_tx: broadcast::Sender<String>,
    policy: PolicyState,
    save_dir: PathBuf,
    pending_offers: Arc<Mutex<HashMap<String, PendingOffer>>>,
    mut events_rx: mpsc::Receiver<RncpEvent>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut link_identities: HashMap<[u8; 16], [u8; 16]> = HashMap::new();
        let staging_dir = save_dir.join(STAGING_DIR_NAME);
        while let Some(evt) = events_rx.recv().await {
            handle_rncp_event(
                &event_tx,
                &policy,
                &mut link_identities,
                &staging_dir,
                &pending_offers,
                evt,
            )
            .await;
        }
    })
}

async fn handle_rncp_event(
    event_tx: &broadcast::Sender<String>,
    policy: &PolicyState,
    link_identities: &mut HashMap<[u8; 16], [u8; 16]>,
    staging_dir: &Path,
    pending_offers: &Arc<Mutex<HashMap<String, PendingOffer>>>,
    evt: RncpEvent,
) {
    match evt {
        RncpEvent::LinkEstablished { .. } => {}
        RncpEvent::SenderIdentified {
            link_id,
            identity_hash,
        } => {
            // Blocked identities are still tracked so `Completed` can clean up
            // their file — we cannot abort the link mid-transfer without
            // library support; size/block enforcement happens on Completed.
            if policy.is_blocked(&hex::encode(identity_hash)) {
                tracing::debug!(
                    identity_hash = %hex::encode(identity_hash),
                    "rncp sender identified as blocked; transfer will be discarded on completion"
                );
            }
            link_identities.insert(link_id, identity_hash);
        }
        RncpEvent::SenderDenied { link_id, .. } => {
            link_identities.remove(&link_id);
            emit(event_tx, "rncp.failed", json!({ "reason": "not_allowed" }));
        }
        RncpEvent::Completed {
            link_id,
            file_name,
            saved_path,
            bytes,
        } => {
            let original_save_dir = saved_path
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| staging_dir.to_path_buf());
            let identity_hex = link_identities.remove(&link_id).map(hex::encode);
            let is_blocked = identity_hex
                .as_deref()
                .is_some_and(|h| policy.is_blocked(h));
            let is_allowed = identity_hex
                .as_deref()
                .is_some_and(|h| policy.is_allowed(h));

            // The underlying resource transfer has no pre-flight size veto —
            // enforce the cap after the fact, before the file becomes visible
            // (directly or as an offer).
            if (bytes as u64) > MAX_RNCP_FILE_BYTES {
                if let Err(e) = tokio::fs::remove_file(&saved_path).await {
                    tracing::debug!("rncp oversize inbound remove failed: {e}");
                }
                emit(
                    event_tx,
                    "rncp.failed",
                    json!({
                        "reason": "file_too_large",
                        "file_name": file_name,
                        "bytes": bytes,
                        "identity_hash": identity_hex,
                    }),
                );
                return;
            }

            if is_blocked {
                if let Err(e) = tokio::fs::remove_file(&saved_path).await {
                    tracing::debug!("rncp blocked inbound remove failed: {e}");
                }
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

            if policy.mode != InboundMode::Ask || is_allowed {
                tracing::info!(
                    kind = "receive",
                    file_name = ?file_name,
                    bytes,
                    identity_hash = identity_hex.as_deref().unwrap_or(""),
                    path = %saved_path.display(),
                    "[rncp] transfer completed"
                );
                emit(
                    event_tx,
                    "rncp.completed",
                    json!({
                        "file_name": file_name,
                        "bytes": bytes,
                        "path": saved_path.display().to_string(),
                        "identity_hash": identity_hex,
                    }),
                );
                return;
            }

            // Ask-mode, unlisted sender: the file is already fully received
            // (see module docs) — stage it under `save_dir` so it does not
            // appear in the real inbox until accept().
            if pending_offers.lock().await.len() >= MAX_PENDING_RNCP_OFFERS {
                if let Err(e) = tokio::fs::remove_file(&saved_path).await {
                    tracing::debug!("rncp over-cap inbound remove failed: {e}");
                }
                emit(
                    event_tx,
                    "rncp.failed",
                    json!({
                        "reason": "too_many_pending",
                        "file_name": file_name,
                        "bytes": bytes,
                        "identity_hash": identity_hex,
                    }),
                );
                return;
            }
            if let Err(e) = tokio::fs::create_dir_all(staging_dir).await {
                tracing::warn!("rncp staging dir create failed: {e}");
                emit(
                    event_tx,
                    "rncp.failed",
                    json!({ "reason": "staging_failed", "file_name": file_name }),
                );
                return;
            }
            let transfer_id = Uuid::new_v4().to_string();
            let staged_path =
                staging_dir.join(format!("{transfer_id}-{}", sanitize_filename(&file_name)));
            if let Err(e) = tokio::fs::rename(&saved_path, &staged_path).await {
                tracing::warn!("rncp offer stage failed: {e}");
                emit(
                    event_tx,
                    "rncp.failed",
                    json!({ "reason": "staging_failed", "file_name": file_name }),
                );
                return;
            }
            pending_offers.lock().await.insert(
                transfer_id.clone(),
                PendingOffer {
                    staged_path,
                    original_save_dir,
                    file_name: file_name.clone(),
                    bytes,
                    identity_hash: identity_hex.clone(),
                },
            );
            emit(
                event_tx,
                "rncp.offer",
                json!({
                    "transfer_id": transfer_id,
                    "file_name": file_name,
                    "bytes": bytes,
                    "identity_hash": identity_hex,
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

fn sanitize_filename(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let trimmed = base.trim();
    if trimmed.is_empty() {
        "rncp_file".to_string()
    } else {
        trimmed.to_string()
    }
}

async fn dedupe_path(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if tokio::fs::metadata(&candidate).await.is_err() {
        return candidate;
    }
    let mut i = 1u32;
    loop {
        let alt = dir.join(format!("{file_name}.{i}"));
        if tokio::fs::metadata(&alt).await.is_err() {
            return alt;
        }
        i += 1;
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
    fn sanitize_filename_strips_path() {
        assert_eq!(sanitize_filename("/etc/passwd"), "passwd");
        assert_eq!(sanitize_filename("../x"), "x");
        assert_eq!(sanitize_filename("nested/dir/file.txt"), "file.txt");
        assert_eq!(sanitize_filename(""), "rncp_file");
        assert_eq!(sanitize_filename("   "), "rncp_file");
    }

    #[test]
    fn max_file_bytes_is_25_mib() {
        assert_eq!(MAX_RNCP_FILE_BYTES, 25 * 1024 * 1024);
    }

    #[test]
    fn pending_offer_cap_is_bounded() {
        assert_eq!(MAX_PENDING_RNCP_OFFERS, 16);
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

    #[tokio::test]
    async fn dedupe_path_appends_counter_when_taken() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert_eq!(
            dedupe_path(dir.path(), "f.txt").await,
            dir.path().join("f.txt")
        );
        tokio::fs::write(dir.path().join("f.txt"), b"x")
            .await
            .expect("write");
        assert_eq!(
            dedupe_path(dir.path(), "f.txt").await,
            dir.path().join("f.txt.1")
        );
        tokio::fs::write(dir.path().join("f.txt.1"), b"x")
            .await
            .expect("write");
        assert_eq!(
            dedupe_path(dir.path(), "f.txt").await,
            dir.path().join("f.txt.2")
        );
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
    async fn send_rejects_missing_oversize_and_non_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (manager, _rx) = test_manager(dir.path());

        let missing = dir.path().join("missing.bin");
        assert!(
            manager
                .send(TEST_DEST, missing.to_str().expect("utf8"))
                .await
                .is_err()
        );
        assert!(
            manager
                .send(TEST_DEST, dir.path().to_str().expect("utf8"))
                .await
                .expect_err("dir rejected")
                .contains("not a regular file")
        );
        assert!(manager.send("nope", "/tmp/x").await.is_err());
    }

    #[tokio::test]
    async fn send_tracks_transfer_and_fails_on_dead_transport() {
        let dir = tempfile::tempdir().expect("tempdir");
        let local = dir.path().join("hello.txt");
        tokio::fs::write(&local, b"hello").await.expect("write");
        let (manager, mut rx) = test_manager(dir.path());

        let transfer_id = manager
            .send(TEST_DEST, local.to_str().expect("utf8"))
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
                .fetch("bad", "remote.txt", dir.path().join("dl"))
                .await
                .is_err()
        );
        let transfer_id = manager
            .fetch(TEST_DEST, "remote.txt", dir.path().join("dl"))
            .await
            .expect("fetch starts");
        let status = manager.status().await;
        let transfers = status["transfers"].as_array().expect("transfers");
        assert!(
            transfers
                .iter()
                .any(|t| t["transfer_id"] == transfer_id.as_str() && t["kind"] == "fetch")
        );
        let failed = recv_event_of_type(&mut rx, "rncp.failed").await;
        assert_eq!(failed["transfer_id"], transfer_id);
    }

    #[tokio::test]
    async fn cancel_active_transfer_emits_cancelled() {
        let dir = tempfile::tempdir().expect("tempdir");
        let local = dir.path().join("hello.txt");
        tokio::fs::write(&local, b"hello").await.expect("write");
        let (manager, mut rx) = test_manager(dir.path());

        let transfer_id = manager
            .send(TEST_DEST, local.to_str().expect("utf8"))
            .await
            .expect("send starts");
        manager.cancel(&transfer_id).await.expect("cancel");
        let cancelled = recv_event_of_type(&mut rx, "rncp.cancelled").await;
        assert_eq!(cancelled["transfer_id"], transfer_id);
        // Unknown id: neither active nor a pending offer.
        assert!(manager.cancel("unknown").await.is_err());
    }

    /// Writes `name` as a staged file and returns its `PendingOffer` row.
    async fn stage_offer(staging: &Path, save_dir: &Path, name: &str) -> PendingOffer {
        let staged_path = staging.join(name);
        tokio::fs::write(&staged_path, name.as_bytes())
            .await
            .expect("stage");
        PendingOffer {
            staged_path,
            original_save_dir: save_dir.to_path_buf(),
            file_name: name.to_string(),
            bytes: name.len(),
            identity_hash: Some("aa".repeat(16)),
        }
    }

    #[tokio::test]
    async fn accept_moves_staged_offer_and_reject_deletes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (manager, mut rx) = test_manager(dir.path());
        let staging = dir.path().join(STAGING_DIR_NAME);
        tokio::fs::create_dir_all(&staging).await.expect("staging");

        let offer = stage_offer(&staging, dir.path(), "keep.txt").await;
        manager
            .pending_offers
            .lock()
            .await
            .insert("offer-1".to_string(), offer);
        let payload = manager.accept("offer-1").await.expect("accept");
        assert_eq!(payload["file_name"], "keep.txt");
        let completed = recv_event_of_type(&mut rx, "rncp.completed").await;
        assert_eq!(completed["transfer_id"], "offer-1");
        let final_path = dir.path().join("keep.txt");
        assert_eq!(
            tokio::fs::read(&final_path).await.expect("accepted file"),
            b"keep.txt"
        );
        assert!(manager.accept("offer-1").await.is_err());

        let offer = stage_offer(&staging, dir.path(), "drop.txt").await;
        let staged_path = offer.staged_path.clone();
        manager
            .pending_offers
            .lock()
            .await
            .insert("offer-2".to_string(), offer);
        manager.reject("offer-2").await.expect("reject");
        let cancelled = recv_event_of_type(&mut rx, "rncp.cancelled").await;
        assert_eq!(cancelled["reason"], "rejected");
        assert!(tokio::fs::metadata(&staged_path).await.is_err());
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
    async fn start_listener_rejects_off_policy_and_missing_fetch_jail() {
        let dir = tempfile::tempdir().expect("tempdir");
        let (manager, _rx) = test_manager(dir.path());

        let err = manager
            .start_listener(dir.path().join("inbox"), true, None, false)
            .await
            .expect_err("missing jail rejected");
        assert!(err.contains("fetch_jail"));

        let err = manager
            .start_listener(dir.path().join("inbox"), false, None, false)
            .await
            .expect_err("off policy rejected");
        assert!(err.contains("policy=off"));
    }

    // ── listener event-loop tests ──

    struct EventLoopFixture {
        event_tx: broadcast::Sender<String>,
        event_rx: broadcast::Receiver<String>,
        policy: PolicyState,
        link_identities: HashMap<[u8; 16], [u8; 16]>,
        staging_dir: PathBuf,
        pending_offers: Arc<Mutex<HashMap<String, PendingOffer>>>,
        dir: tempfile::TempDir,
    }

    fn event_loop_fixture(policy: PolicyState) -> EventLoopFixture {
        let dir = tempfile::tempdir().expect("tempdir");
        let (event_tx, event_rx) = broadcast::channel::<String>(64);
        EventLoopFixture {
            event_tx,
            event_rx,
            policy,
            link_identities: HashMap::new(),
            staging_dir: dir.path().join(STAGING_DIR_NAME),
            pending_offers: Arc::new(Mutex::new(HashMap::new())),
            dir,
        }
    }

    impl EventLoopFixture {
        async fn dispatch(&mut self, evt: RncpEvent) {
            handle_rncp_event(
                &self.event_tx,
                &self.policy,
                &mut self.link_identities,
                &self.staging_dir,
                &self.pending_offers,
                evt,
            )
            .await;
        }

        async fn write_inbound(&self, name: &str, contents: &[u8]) -> PathBuf {
            let path = self.dir.path().join(name);
            tokio::fs::write(&path, contents).await.expect("inbound");
            path
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
    async fn completed_from_allowed_sender_passes_straight_through() {
        let sender = [0xAA; 16];
        let mut fx = event_loop_fixture(ask_policy(&[&hex::encode(sender)], &[]));
        let saved = fx.write_inbound("direct.txt", b"direct").await;

        fx.dispatch(RncpEvent::SenderIdentified {
            link_id: [1; 16],
            identity_hash: sender,
        })
        .await;
        fx.dispatch(RncpEvent::Completed {
            link_id: [1; 16],
            file_name: "direct.txt".to_string(),
            saved_path: saved.clone(),
            bytes: 6,
        })
        .await;

        let completed = recv_event_of_type(&mut fx.event_rx, "rncp.completed").await;
        assert_eq!(completed["file_name"], "direct.txt");
        assert!(tokio::fs::metadata(&saved).await.is_ok());
        assert!(fx.pending_offers.lock().await.is_empty());
    }

    #[tokio::test]
    async fn completed_from_blocked_sender_deletes_file() {
        let sender = [0xBB; 16];
        let mut fx = event_loop_fixture(ask_policy(&[], &[&hex::encode(sender)]));
        let saved = fx.write_inbound("blocked.txt", b"blocked").await;

        fx.dispatch(RncpEvent::SenderIdentified {
            link_id: [2; 16],
            identity_hash: sender,
        })
        .await;
        fx.dispatch(RncpEvent::Completed {
            link_id: [2; 16],
            file_name: "blocked.txt".to_string(),
            saved_path: saved.clone(),
            bytes: 7,
        })
        .await;

        let failed = recv_event_of_type(&mut fx.event_rx, "rncp.failed").await;
        assert_eq!(failed["reason"], "not_allowed");
        assert!(tokio::fs::metadata(&saved).await.is_err());
    }

    #[tokio::test]
    async fn completed_oversize_is_deleted_and_reported() {
        let mut fx = event_loop_fixture(ask_policy(&[], &[]));
        let saved = fx.write_inbound("big.bin", b"stub").await;

        fx.dispatch(RncpEvent::Completed {
            link_id: [3; 16],
            file_name: "big.bin".to_string(),
            saved_path: saved.clone(),
            bytes: (MAX_RNCP_FILE_BYTES + 1) as usize,
        })
        .await;

        let failed = recv_event_of_type(&mut fx.event_rx, "rncp.failed").await;
        assert_eq!(failed["reason"], "file_too_large");
        assert!(tokio::fs::metadata(&saved).await.is_err());
    }

    #[tokio::test]
    async fn ask_mode_unlisted_sender_is_staged_as_offer() {
        let mut fx = event_loop_fixture(ask_policy(&[], &[]));
        let saved = fx.write_inbound("ask.txt", b"ask").await;

        fx.dispatch(RncpEvent::SenderIdentified {
            link_id: [4; 16],
            identity_hash: [0xCC; 16],
        })
        .await;
        fx.dispatch(RncpEvent::Completed {
            link_id: [4; 16],
            file_name: "ask.txt".to_string(),
            saved_path: saved.clone(),
            bytes: 3,
        })
        .await;

        let offer = recv_event_of_type(&mut fx.event_rx, "rncp.offer").await;
        assert_eq!(offer["file_name"], "ask.txt");
        assert_eq!(offer["identity_hash"], hex::encode([0xCC; 16]));
        // Original inbox path is gone; the staged copy holds the bytes.
        assert!(tokio::fs::metadata(&saved).await.is_err());
        let offers = fx.pending_offers.lock().await;
        assert_eq!(offers.len(), 1);
        let staged = offers.values().next().expect("offer");
        assert!(staged.staged_path.starts_with(&fx.staging_dir));
        assert_eq!(
            std::fs::read(&staged.staged_path).expect("staged bytes"),
            b"ask"
        );
    }

    #[tokio::test]
    async fn ask_mode_over_cap_offer_is_dropped() {
        let mut fx = event_loop_fixture(ask_policy(&[], &[]));
        {
            let mut offers = fx.pending_offers.lock().await;
            for i in 0..MAX_PENDING_RNCP_OFFERS {
                offers.insert(
                    format!("prefill-{i}"),
                    PendingOffer {
                        staged_path: fx.staging_dir.join(format!("p{i}")),
                        original_save_dir: fx.dir.path().to_path_buf(),
                        file_name: format!("p{i}"),
                        bytes: 1,
                        identity_hash: None,
                    },
                );
            }
        }
        let saved = fx.write_inbound("overflow.txt", b"x").await;
        fx.dispatch(RncpEvent::Completed {
            link_id: [5; 16],
            file_name: "overflow.txt".to_string(),
            saved_path: saved.clone(),
            bytes: 1,
        })
        .await;

        let failed = recv_event_of_type(&mut fx.event_rx, "rncp.failed").await;
        assert_eq!(failed["reason"], "too_many_pending");
        assert!(tokio::fs::metadata(&saved).await.is_err());
        assert_eq!(
            fx.pending_offers.lock().await.len(),
            MAX_PENDING_RNCP_OFFERS
        );
    }

    #[tokio::test]
    async fn denied_and_write_failed_events_report_failures() {
        let mut fx = event_loop_fixture(ask_policy(&[], &[]));

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
            dir.path().to_path_buf(),
        );
        manager
            .configure_policy("ask", vec![], vec![])
            .await
            .expect("policy");
        manager
            .start_listener(dir.path().join("inbox"), false, None, false)
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
            dir.path().to_path_buf(),
        );
        manager
            .configure_policy("ask", vec![], vec![])
            .await
            .expect("policy");
        manager
            .start_listener(dir.path().join("inbox"), false, None, false)
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
            dir.path().to_path_buf(),
        );
        manager
            .configure_policy("ask", vec![], vec![])
            .await
            .expect("policy");
        manager
            .start_listener(dir.path().join("inbox"), false, None, false)
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

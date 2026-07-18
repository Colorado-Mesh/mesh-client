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

use rns_identity::identity::Identity;
use rns_runtime::rncp::{
    RncpEvent, RncpFetchRequest, RncpListenerConfig, RncpListenerHandle, RncpSendRequest,
    default_rncp_app_name, rncp_fetch_file, rncp_send_file, spawn_rncp_listener,
};
use rns_transport::messages::TransportMessage;
use serde_json::json;
use tokio::sync::{Mutex, broadcast, mpsc, oneshot};
use uuid::Uuid;

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
}

pub struct RncpTransferManager {
    transport_tx: mpsc::Sender<TransportMessage>,
    identity: Identity,
    event_tx: broadcast::Sender<String>,
    #[allow(dead_code)] // retained for future default save/fetch dir helpers
    storage_dir: PathBuf,
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
    ) -> Self {
        Self {
            transport_tx,
            identity,
            event_tx,
            storage_dir,
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
                    Ok(outcome) => emit(
                        &event_tx,
                        "rncp.completed",
                        json!({
                            "transfer_id": tid,
                            "file_name": outcome.file_name,
                            "bytes": outcome.bytes,
                            "destination_hash": dest_hex_task,
                        }),
                    ),
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
        let payload = json!({
            "transfer_id": transfer_id,
            "file_name": final_path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or(safe_name),
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
    /// Note: `spawn_rncp_listener` registers this destination with the
    /// transport actor so incoming Links can reach it; reachability to peers
    /// that already hold (or later request) a path to it does not require a
    /// recurring manual announce call from here.
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
        let destination_hash = hex::encode(handle.destination_hash());

        let events_task = spawn_listener_event_loop(
            self.event_tx.clone(),
            policy,
            save_dir.clone(),
            Arc::clone(&self.pending_offers),
            events_rx,
        );

        *self.listener.lock().await = Some(ListenerState {
            handle: Some(handle),
            destination_hash: destination_hash.clone(),
            events_task,
        });

        Ok(
            json!({ "destination_hash": destination_hash, "save_dir": save_dir.display().to_string() }),
        )
    }

    pub async fn stop_listener(&self) {
        let mut guard = self.listener.lock().await;
        if let Some(mut state) = guard.take() {
            state.events_task.abort();
            if let Some(handle) = state.handle.take() {
                handle.shutdown().await;
            }
        }
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
            tracing::debug!(file_name = %file_name, bytes, "rncp fetch serving local file");
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
}

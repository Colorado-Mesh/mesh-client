//! Live propagation node serving and sync against remote propagation nodes.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use lxmf_core::message::LxMessage;
use lxmf_core::peer::OutboundOfferPolicy;
use lxmf_core::propagation_client::{PropagationClient, PropagationClientState};
use lxmf_core::propagation_node::{PropagationNode, PropagationNodeConfig};
use lxmf_core::propagation_sync::{
    PeerSyncTerminalResult, PeerSyncTerminalState, PropagationSyncTask, SyncTaskState,
};
use lxmf_core::router::LxmRouter;
use lxmf_core::types::PropagationTransientId;
use rns_identity::destination::Destination;
use rns_identity::identity::Identity;
use rns_transport::messages::TransportMessage;
use tokio::sync::{Notify, broadcast, mpsc};

use super::propagation_download::{ClientDownloadPoll, decode_downloaded_propagated_blob};

/// Completed host-peer peering PoW (stamp, value) awaiting apply onto `LxmPeer`.
type PeeringKeyResult = ([u8; 16], [u8; 32], u32);

/// Cap concurrent host-peer peering-key PoW jobs (CPU-heavy stamp generation).
const MAX_PEERING_KEY_JOBS: usize = 8;

pub struct PropagationBridge {
    local_dest_hash: [u8; 16],
    local_node: Arc<Mutex<PropagationNode>>,
    sync_task: Mutex<PropagationSyncTask>,
    /// Client `/get` pull for retrieving our own store-and-forward mail from a
    /// remote PN into Chat (Python `request_messages_from_propagation_node`).
    /// Distinct from `sync_task`, which is the `/offer` peer-replication path.
    client: Mutex<PropagationClient>,
    /// Local identity clone used to decrypt downloaded propagated blobs.
    identity: Identity,
    local_serving: AtomicBool,
    /// Terminal result of background `load_messagestore_from_disk` (`None` while in flight).
    messagestore_result: Mutex<Option<Result<(), String>>>,
    messagestore_notify: Notify,
    /// Serializes sync-run generation changes with emitter cancel / pin / event side effects.
    sync_lifecycle: Mutex<()>,
    /// Sticky offer failure label (rsLXMF tip keeps terminal state on the task, not these fields).
    last_offer_error: Mutex<Option<&'static str>>,
    /// Sticky establish failure label for UI / offer-probe.
    last_establish_error: Mutex<Option<&'static str>>,
    /// Sticky success/failure after Complete/Failed collapses to Idle.
    last_finished_ok: Mutex<Option<bool>>,
    /// Peak sync progress seen before tip collapses Complete/Failed → Idle.
    peak_progress: Mutex<f64>,
    /// In-flight peering-key PoW jobs for local-host outbound peer sync.
    peering_key_jobs: Mutex<HashSet<[u8; 16]>>,
    peering_key_results: Mutex<Vec<PeeringKeyResult>>,
    /// Set when inbound peer Resource accept should drain our inbox into Chat.
    inbox_drain_requested: AtomicBool,
    /// After host peer `/offer` Completes, `/get` this peer for our mail (sequenced).
    pending_post_peer_get: Mutex<Option<[u8; 16]>>,
}

impl PropagationBridge {
    pub fn new(
        transport_tx: mpsc::Sender<TransportMessage>,
        local_dest_hash: [u8; 16],
        storage_dir: PathBuf,
        identity: &Identity,
        policy: &super::pn_hosting_policy::PnHostingPolicy,
    ) -> Result<Self, String> {
        std::fs::create_dir_all(&storage_dir).map_err(|e| e.to_string())?;
        let node_config = PropagationNodeConfig {
            max_storage: policy.message_storage_limit_bytes(),
            max_message_age: lxmf_core::constants::MESSAGE_EXPIRY,
            min_stamp_cost: policy.min_stamp_cost(),
            peering_cost: policy.peering_cost,
            max_message_size: policy.propagation_limit_kb.saturating_mul(1024),
            max_offer_size: policy.sync_limit_kb.saturating_mul(1000),
        };
        // Defer messagestore scan — large local PN stores can take many seconds and must
        // not gate TCP/LXMF/RRC live attach. New writes still go to `storage_dir`.
        let local_node = Arc::new(Mutex::new(
            PropagationNode::with_storage_unloaded(node_config, local_dest_hash, storage_dir)
                .map_err(|e| format!("propagation storage init: {e}"))?,
        ));
        let mut sync_task =
            PropagationSyncTask::with_shared_node(transport_tx.clone(), local_node.clone());
        let signing_key = identity
            .get_signing_key()
            .ok_or_else(|| "propagation sync: identity has no signing key".to_string())?;
        sync_task.set_identity(identity.get_public_key(), signing_key);
        // Client `/get` pull uses the same identity to identify on the PN link
        // and to decrypt downloaded blobs addressed to our `lxmf.delivery` hash.
        let client = PropagationClient::new(
            transport_tx,
            Some(identity.get_public_key()),
            identity.get_signing_key(),
        );
        Ok(Self {
            local_dest_hash,
            local_node,
            sync_task: Mutex::new(sync_task),
            client: Mutex::new(client),
            identity: identity.clone(),
            local_serving: AtomicBool::new(false),
            messagestore_result: Mutex::new(None),
            messagestore_notify: Notify::new(),
            sync_lifecycle: Mutex::new(()),
            last_offer_error: Mutex::new(None),
            last_establish_error: Mutex::new(None),
            last_finished_ok: Mutex::new(None),
            peak_progress: Mutex::new(0.0),
            peering_key_jobs: Mutex::new(HashSet::new()),
            peering_key_results: Mutex::new(Vec::new()),
            inbox_drain_requested: AtomicBool::new(false),
            pending_post_peer_get: Mutex::new(None),
        })
    }

    /// Ask maintenance to drain our `lxmf.delivery` mail from the local PN store into Chat.
    pub fn request_inbox_drain(&self) {
        self.inbox_drain_requested.store(true, Ordering::SeqCst);
    }

    /// Consume a pending inbox-drain request (coalesced; one drain per take).
    pub fn take_inbox_drain_request(&self) -> bool {
        self.inbox_drain_requested.swap(false, Ordering::SeqCst)
    }

    /// Queue a silent client `/get` against `peer_hash` after host peer `/offer` Completes.
    pub fn queue_post_peer_get(&self, peer_hash: [u8; 16]) {
        if let Ok(mut slot) = self.pending_post_peer_get.lock() {
            *slot = Some(peer_hash);
        }
    }

    /// Take a queued post-peer `/get` target when the client is idle.
    pub fn take_pending_post_peer_get(&self) -> Option<[u8; 16]> {
        if self.client_download_active() {
            return None;
        }
        self.pending_post_peer_get
            .lock()
            .ok()
            .and_then(|mut slot| slot.take())
    }

    /// Drop a queued post-peer `/get` (user Sync cancel / supersession).
    pub fn clear_pending_post_peer_get(&self) {
        if let Ok(mut slot) = self.pending_post_peer_get.lock() {
            *slot = None;
        }
    }

    /// Load historical PN messages off the live-ready path (spawn_blocking).
    pub fn spawn_messagestore_load(self: &Arc<Self>) {
        let this = Arc::clone(self);
        let node = Arc::clone(&self.local_node);
        tokio::spawn(async move {
            let load_started = Instant::now();
            let result = tokio::task::spawn_blocking(move || {
                let mut guard = node
                    .lock()
                    .map_err(|e| format!("propagation node lock poisoned: {e}"))?;
                guard
                    .load_messagestore_from_disk()
                    .map_err(|e| e.to_string())?;
                Ok::<(), String>(())
            })
            .await;
            let terminal = match result {
                Ok(Ok(())) => {
                    tracing::info!(
                        elapsed_ms = load_started.elapsed().as_millis() as u64,
                        "propagation messagestore loaded in background"
                    );
                    Ok(())
                }
                Ok(Err(e)) => {
                    tracing::warn!(error = %e, "background propagation messagestore load failed");
                    Err(e)
                }
                Err(e) => {
                    let msg = format!("background propagation messagestore load join failed: {e}");
                    tracing::warn!(error = %e, "background propagation messagestore load join failed");
                    Err(msg)
                }
            };
            if let Ok(mut slot) = this.messagestore_result.lock() {
                *slot = Some(terminal);
            }
            this.messagestore_notify.notify_waiters();
        });
    }

    /// True while the background messagestore load has not produced a terminal result.
    /// Non-blocking counterpart of [`Self::wait_messagestore_loaded`] for status reads.
    pub fn messagestore_load_pending(&self) -> bool {
        self.messagestore_result
            .lock()
            .map(|guard| guard.is_none())
            .unwrap_or(true)
    }

    /// Wait until background messagestore load has finished; returns the stored terminal result.
    pub async fn wait_messagestore_loaded(&self) -> Result<(), String> {
        loop {
            if let Ok(guard) = self.messagestore_result.lock() {
                if let Some(result) = guard.as_ref() {
                    return result.clone();
                }
            }
            let notified = self.messagestore_notify.notified();
            if let Ok(guard) = self.messagestore_result.lock() {
                if let Some(result) = guard.as_ref() {
                    return result.clone();
                }
            }
            notified.await;
        }
    }

    pub fn peering_key_job_inflight(&self, peer_hash: &[u8; 16]) -> bool {
        self.peering_key_jobs
            .lock()
            .map(|jobs| jobs.contains(peer_hash))
            .unwrap_or(false)
    }

    pub fn spawn_peering_key_job(
        self: &Arc<Self>,
        peer_hash: [u8; 16],
        peering_cost: u8,
        peer_identity_hash: [u8; 16],
        local_identity_hash: [u8; 16],
    ) {
        {
            let Ok(mut jobs) = self.peering_key_jobs.lock() else {
                return;
            };
            if jobs.len() >= MAX_PEERING_KEY_JOBS {
                return;
            }
            if !jobs.insert(peer_hash) {
                return;
            }
        }
        let bridge = Arc::clone(self);
        tokio::spawn(async move {
            let result = tokio::task::spawn_blocking(move || {
                let mut peering_id = Vec::with_capacity(32);
                peering_id.extend_from_slice(&peer_identity_hash);
                peering_id.extend_from_slice(&local_identity_hash);
                lxmf_core::stamper::generate_stamp(
                    &peering_id,
                    peering_cost,
                    lxmf_core::constants::STAMP_WORKBLOCK_EXPAND_ROUNDS_PEERING,
                )
                .map(|(stamp, value)| (peer_hash, stamp, value))
            })
            .await
            .ok()
            .flatten();
            if let Ok(mut jobs) = bridge.peering_key_jobs.lock() {
                jobs.remove(&peer_hash);
            }
            if let Some(result) = result {
                if let Ok(mut slot) = bridge.peering_key_results.lock() {
                    slot.push(result);
                }
            } else {
                tracing::warn!(
                    target: "propagation-sync",
                    peer = %hex::encode(peer_hash),
                    peering_cost,
                    "host peer peering-key PoW failed"
                );
            }
        });
    }

    pub fn drain_peering_key_results(&self, router: &mut LxmRouter) {
        let results = self
            .peering_key_results
            .lock()
            .map(|mut slot| std::mem::take(&mut *slot))
            .unwrap_or_default();
        for (peer_hash, stamp, value) in results {
            if let Some(peer) = router.peers.get_mut(&peer_hash) {
                peer.peering_key = Some((stamp, value));
                tracing::info!(
                    target: "propagation-sync",
                    peer = %hex::encode(peer_hash),
                    value,
                    "host peer peering key ready"
                );
            }
        }
    }

    /// Map rsLXMF sync-task state to UI / probe progress (single source of truth).
    pub fn progress_for_state(state: SyncTaskState) -> f64 {
        match state {
            SyncTaskState::Establishing => 10.0,
            SyncTaskState::Offering => 25.0,
            SyncTaskState::AwaitingResponse => 40.0,
            SyncTaskState::Transferring => 70.0,
            SyncTaskState::Complete => 100.0,
            SyncTaskState::Idle | SyncTaskState::Failed => 0.0,
        }
    }

    pub fn local_node(&self) -> Arc<Mutex<PropagationNode>> {
        self.local_node.clone()
    }

    pub fn local_dest_hash_hex(&self) -> String {
        hex::encode(self.local_dest_hash)
    }

    pub fn local_dest_hash_bytes(&self) -> [u8; 16] {
        self.local_dest_hash
    }

    pub fn set_local_serving(&self, enabled: bool, router: &mut LxmRouter) {
        self.local_serving.store(enabled, Ordering::SeqCst);
        router.set_propagation_enabled(enabled);
    }

    pub fn is_local_serving(&self) -> bool {
        self.local_serving.load(Ordering::SeqCst)
    }

    pub fn local_stats(&self) -> (usize, usize) {
        self.local_node
            .lock()
            .map(|node| (node.message_count(), node.total_size()))
            .unwrap_or((0, 0))
    }

    fn clear_sticky_errors(&self) {
        if let Ok(mut slot) = self.last_offer_error.lock() {
            *slot = None;
        }
        if let Ok(mut slot) = self.last_establish_error.lock() {
            *slot = None;
        }
        if let Ok(mut slot) = self.last_finished_ok.lock() {
            *slot = None;
        }
        if let Ok(mut slot) = self.peak_progress.lock() {
            *slot = 0.0;
        }
    }

    #[cfg(test)]
    pub fn force_peak_progress_for_test(&self, progress: f64) {
        self.note_peak_progress(progress);
    }

    fn note_peak_progress(&self, progress: f64) {
        if progress <= 0.0 {
            return;
        }
        if let Ok(mut peak) = self.peak_progress.lock() {
            if progress > *peak {
                *peak = progress;
            }
        }
    }

    /// Peak progress observed for the current/last sync run (survives Idle collapse).
    pub fn last_peak_progress(&self) -> f64 {
        self.peak_progress.lock().map(|p| *p).unwrap_or(0.0)
    }

    fn stamp_terminal_failure_from_peak(&self, peak: f64) {
        // Tip collapses Complete/Failed → Idle in the same tick, so task.state after
        // take_terminal is always Idle (progress 0). Classify from peak instead.
        // Never invent "Unknown" (probe maps that to PROPAGATION_OFFER_UNSUPPORTED).
        // peak >= 25 (Offering+): leave offer_error unset so probe can treat it as OK.
        if peak >= 25.0 {
            return;
        }
        if let Ok(mut slot) = self.last_establish_error.lock() {
            if slot.is_none() {
                *slot = Some("NoLinkProof");
            }
        }
    }

    #[allow(clippy::type_complexity)] // peering tuple: local_id, peer_id, cost, optional key
    pub fn start_sync(
        &self,
        remote_hash: [u8; 16],
        peering: Option<([u8; 16], [u8; 16], u8, Option<Vec<u8>>)>,
    ) -> bool {
        let Ok(mut task) = self.sync_task.lock() else {
            return false;
        };
        self.clear_sticky_errors();
        let mut policy = OutboundOfferPolicy::unrestricted(remote_hash);
        if let Some((_local_id, _peer_id, cost, key)) = peering {
            policy.peering_cost = cost;
            if let Some(k) = key {
                policy.peering_key = k;
            }
        }
        task.request_sync_now_with_policy(policy)
    }

    /// Start outbound peer sync with a fully-built offer policy (local host peer loop).
    pub fn start_sync_with_policy(&self, policy: OutboundOfferPolicy) -> bool {
        let Ok(mut task) = self.sync_task.lock() else {
            return false;
        };
        self.clear_sticky_errors();
        task.request_sync_now_with_policy(policy)
    }

    pub fn cancel_sync(&self) {
        // Tip `cancel_peer_sync` leaves Idle + clears terminal_result. Do not force
        // Failed afterward — that blocks the next `request_sync_now_*` (Idle required).
        if let Ok(mut task) = self.sync_task.lock() {
            if let Some(hash) = task.node_dest_hash() {
                let _ = task.cancel_peer_sync(&hash);
            } else {
                task.state = SyncTaskState::Idle;
            }
        }
        // Offer-probe (and other mid-progress cancels after Offering) should not look
        // like sticky failure — peak ≥ 25 means /offer was accepted enough to proceed.
        let peak = self.last_peak_progress();
        if let Ok(mut slot) = self.last_finished_ok.lock() {
            *slot = Some(peak >= 25.0);
        }
    }

    /// Whether a post-loop terminal success (progress 100) should be emitted.
    #[allow(dead_code)] // used by peer-sync progress emitter + unit tests
    pub fn should_emit_terminal_success(last_finished_ok: Option<bool>) -> bool {
        last_finished_ok != Some(false)
    }

    /// Start a client `/get` download of our own mail from `pn_hash`.
    ///
    /// This is the retrieval half of Sync (Python
    /// `request_messages_from_propagation_node`): list → get → purge over an
    /// `lxmf.propagation.client` link. Returns false when a download is already
    /// in flight or the client refuses to start.
    pub fn start_client_download(&self, pn_hash: [u8; 16]) -> bool {
        let Ok(mut client) = self.client.lock() else {
            return false;
        };
        client.set_propagation_node(pn_hash);
        client.start_download()
    }

    /// Map client `/get` state to UI progress (user Sync is `/get`-primary).
    pub fn client_download_progress(&self) -> f64 {
        let Ok(client) = self.client.lock() else {
            return 0.0;
        };
        match client.state() {
            PropagationClientState::Idle | PropagationClientState::Failed => 0.0,
            PropagationClientState::LinkEstablishing => 10.0,
            PropagationClientState::LinkEstablished => 20.0,
            PropagationClientState::ListRequested => 40.0,
            PropagationClientState::GetRequested => 55.0,
            PropagationClientState::Receiving => 70.0,
            PropagationClientState::PurgeRequested => 90.0,
            PropagationClientState::Complete => 100.0,
        }
    }

    /// True while the client `/get` state machine is mid-transfer.
    pub fn client_download_active(&self) -> bool {
        let Ok(client) = self.client.lock() else {
            return false;
        };
        !matches!(
            client.state(),
            PropagationClientState::Idle
                | PropagationClientState::Complete
                | PropagationClientState::Failed
        )
    }

    /// Cancel any in-flight client download (best-effort). The next
    /// [`Self::start_client_download`] re-arms from Idle.
    pub fn cancel_client_download(&self) {
        if let Ok(mut client) = self.client.lock() {
            // Consuming the terminal snapshot returns the client to Idle so the
            // next download can start; also drops any half-received blobs.
            let _ = client.acknowledge_transfer();
            let _ = client.take_received_messages();
        }
    }

    /// Drive the client download one step: drain inbound events, advance the
    /// state machine, and on a terminal Complete decode the downloaded blobs
    /// into inbound [`LxMessage`]s ready for the router delivery callback.
    pub(crate) fn poll_client_download(
        &self,
        known_identities: &HashMap<String, [u8; 64]>,
    ) -> ClientDownloadPoll {
        let Ok(mut client) = self.client.lock() else {
            return ClientDownloadPoll::Failed;
        };
        if matches!(client.state(), PropagationClientState::Idle) {
            return ClientDownloadPoll::Idle;
        }
        client.drain_events(known_identities);
        client.tick();
        match client.state() {
            PropagationClientState::Idle => ClientDownloadPoll::Idle,
            PropagationClientState::Failed => ClientDownloadPoll::Failed,
            PropagationClientState::Complete => {
                let listed = client.available_messages().len();
                let downloaded = client.received_count();
                let blobs = client.take_received_messages();
                // Consume the terminal snapshot → Idle so the next
                // start_client_download can proceed without a cancel first.
                let _ = client.acknowledge_transfer();
                drop(client);
                let messages = blobs
                    .iter()
                    .filter_map(|blob| decode_downloaded_propagated_blob(&self.identity, blob))
                    .collect::<Vec<_>>();
                ClientDownloadPoll::Complete {
                    messages,
                    listed,
                    downloaded,
                }
            }
            _ => ClientDownloadPoll::InProgress,
        }
    }

    /// Drain our own store-and-forward mail out of the **local** PN store into
    /// inbound [`LxMessage`]s for Chat, without a network link.
    ///
    /// `local-prop` Sync hosts our inbox in-process, so there is no remote
    /// `/get` to run. We replay the node's own `/get` list → serve → purge
    /// against our `lxmf.delivery` hash (identical ownership gate + stamp strip
    /// the server applies to remote clients), decode each blob with the local
    /// identity, and hand them back for delivery. Returns `(messages, listed)`.
    pub(crate) fn drain_local_inbox(&self) -> (Vec<LxMessage>, usize) {
        use rmpv::Value;

        let our_delivery =
            Destination::hash_from_name_and_identity("lxmf.delivery", Some(&self.identity.hash));

        // Hold the node lock only for the list + serve reads, then release it
        // before per-message decryption/decode (CPU work off the shared lock).
        let (blobs, listed) = {
            let Ok(mut node) = self.local_node.lock() else {
                return (Vec::new(), 0);
            };

            // Phase 1: list our available transient IDs.
            let list_req = Self::encode_value(&Value::Array(vec![Value::Nil, Value::Nil]));
            let tids = Self::decode_binary_array(
                &node
                    .handle_get_request(&list_req, &our_delivery)
                    .into_response(),
            );
            if tids.is_empty() {
                return (Vec::new(), 0);
            }

            // Phase 2: fetch every listed message (server strips the stamp).
            let wants: Vec<Value> = tids.iter().map(|t| Value::Binary(t.clone())).collect();
            let get_req = Self::encode_value(&Value::Array(vec![
                Value::Array(wants),
                Value::Array(Vec::new()),
            ]));
            let blobs = Self::decode_binary_array(
                &node
                    .handle_get_request(&get_req, &our_delivery)
                    .into_response(),
            );
            (blobs, tids.len())
        };

        // Decode without holding the node lock.
        let messages = blobs
            .iter()
            .filter_map(|blob| decode_downloaded_propagated_blob(&self.identity, blob))
            .collect::<Vec<_>>();
        let skipped = blobs.len().saturating_sub(messages.len());
        if skipped > 0 {
            tracing::warn!(
                target: "propagation-retrieve",
                skipped,
                served = blobs.len(),
                "local-prop drain skipped undecodable blob(s)"
            );
        }

        // Phase 3: purge only what we successfully decoded, keyed by the exact
        // transient id `compute_propagation_transient_id` stamped on each
        // message. Undecodable blobs stay in the store for a later retry.
        let purge_ids: Vec<Value> = messages
            .iter()
            .filter_map(|msg| msg.transient_id.map(|tid| Value::Binary(tid.to_vec())))
            .collect();
        if !purge_ids.is_empty() {
            if let Ok(mut node) = self.local_node.lock() {
                let purge_req =
                    Self::encode_value(&Value::Array(vec![Value::Nil, Value::Array(purge_ids)]));
                let _ = node.handle_get_request(&purge_req, &our_delivery);
            }
        }

        (messages, listed)
    }

    /// Encode an rmpv value to msgpack bytes (the `/get` request wire form).
    fn encode_value(value: &rmpv::Value) -> Vec<u8> {
        let mut buf = Vec::new();
        // Writing into a Vec is infallible.
        let _ = rmpv::encode::write_value(&mut buf, value);
        buf
    }

    /// Decode a msgpack array of binaries (the `/get` list and serve responses).
    fn decode_binary_array(bytes: &[u8]) -> Vec<Vec<u8>> {
        let Ok(value) = rmpv::decode::read_value(&mut &bytes[..]) else {
            return Vec::new();
        };
        let Some(arr) = value.as_array() else {
            return Vec::new();
        };
        arr.iter()
            .filter_map(|v| v.as_slice().map(<[u8]>::to_vec))
            .collect()
    }

    /// Whether this emitter still owns the active sync run (generation match).
    pub fn is_current_sync_run(active_run_id: u64, run_id: u64) -> bool {
        active_run_id == run_id
    }

    /// Hold while replacing the active sync generation / cancel token.
    pub fn lock_sync_lifecycle(
        &self,
    ) -> Result<MutexGuard<'_, ()>, PoisonError<MutexGuard<'_, ()>>> {
        self.sync_lifecycle.lock()
    }

    /// Run `action` only if `run_id` is still current, under the lifecycle lock.
    pub fn run_if_current(
        &self,
        active_run_id: &AtomicU64,
        run_id: u64,
        action: impl FnOnce(),
    ) -> bool {
        let Ok(_guard) = self.sync_lifecycle.lock() else {
            return false;
        };
        if !Self::is_current_sync_run(active_run_id.load(Ordering::SeqCst), run_id) {
            return false;
        }
        action();
        true
    }

    pub fn sync_active(&self) -> bool {
        self.sync_task
            .lock()
            .map(|task| {
                !matches!(
                    task.state,
                    SyncTaskState::Idle | SyncTaskState::Complete | SyncTaskState::Failed
                )
            })
            .unwrap_or(false)
    }

    pub fn sync_progress(&self) -> f64 {
        self.sync_task
            .lock()
            .map(|task| Self::progress_for_state(task.state))
            .unwrap_or(0.0)
    }

    pub fn last_offer_error(&self) -> Option<&'static str> {
        self.last_offer_error.lock().ok().and_then(|slot| *slot)
    }

    pub fn last_establish_error(&self) -> Option<&'static str> {
        self.last_establish_error.lock().ok().and_then(|slot| *slot)
    }

    /// Sticky success/failure after Complete/Failed collapses to Idle.
    pub fn last_finished_ok(&self) -> Option<bool> {
        self.last_finished_ok.lock().ok().and_then(|slot| *slot)
    }

    /// Drain sync events and return `Some((success, peer_hash))` when a peer sync just finished.
    ///
    /// Applies lxmd-parity router peer bookkeeping: handled-message updates,
    /// `sync_complete` / `sync_failed`, and `mark_offer_generation_processed` when
    /// the generation is exhausted — then persists the peer via `save_peer`.
    pub fn tick(
        &self,
        known_identities: &HashMap<String, [u8; 64]>,
        router: &mut LxmRouter,
    ) -> Option<(bool, [u8; 16])> {
        let (handled, terminal_result) = if let Ok(mut task) = self.sync_task.lock() {
            // Sample before drain/tick: tip collapses Complete|Failed → Idle in tick().
            self.note_peak_progress(Self::progress_for_state(task.state));
            task.drain_events(known_identities);
            self.note_peak_progress(Self::progress_for_state(task.state));
            task.tick();
            let handled = task.take_handled_updates();
            let peer_hash_for_handled = if handled.is_empty() {
                None
            } else {
                task.node_dest_hash()
            };
            let terminal = task.take_terminal_peer_result();
            (peer_hash_for_handled.map(|h| (h, handled)), terminal)
        } else {
            (None, None)
        };

        if let Some((peer_hash, updates)) = handled {
            apply_peer_handled_updates(router, &self.local_node, peer_hash, &updates);
        }

        let terminal = terminal_result.map(|result| {
            apply_peer_sync_terminal(router, &self.local_node, &result);
            (
                matches!(result.state, PeerSyncTerminalState::Complete),
                result.peer_hash,
            )
        });
        if let Some((ok, peer_hash)) = terminal {
            if let Ok(mut slot) = self.last_finished_ok.lock() {
                *slot = Some(ok);
            }
            if ok {
                let peak = self.last_peak_progress();
                // This is the `/offer` peer-sync (inventory replication) outcome, NOT
                // inbox retrieval — HaveAll means the peer wanted nothing, transfer means
                // we pushed blobs to it. Real inbox retrieval is logged by the client
                // `/get` download path (`propagation-retrieve`) in live.rs.
                let peer_outcome = if peak >= 70.0 { "transfer" } else { "have_all" };
                tracing::info!(
                    target: "propagation-sync",
                    pn_hash = %hex::encode(peer_hash),
                    peak_progress = peak,
                    peer_outcome,
                    "remote/host PN peer sync Completes"
                );
            } else {
                let peak = self.last_peak_progress();
                self.stamp_terminal_failure_from_peak(peak);
            }
        }
        terminal
    }

    /// Emit peer `/offer` sync progress over WS (offer probe / host diagnostics).
    /// User Sync drives UI from the client `/get` path instead.
    #[allow(dead_code)] // retained for offer-probe / peer-sync diagnostics
    pub fn spawn_sync_progress_emitter(
        self: &Arc<Self>,
        event_tx: broadcast::Sender<String>,
        cancel: Arc<AtomicBool>,
        run_id: u64,
        active_run_id: Arc<AtomicU64>,
        on_terminal: Option<Arc<dyn Fn() + Send + Sync>>,
    ) {
        let bridge = Arc::clone(self);
        tokio::spawn(async move {
            const SYNC_STALL_TIMEOUT: Duration = Duration::from_secs(45);
            let mut interval = tokio::time::interval(Duration::from_millis(500));
            let started = Instant::now();
            let clear_pins = || {
                bridge.run_if_current(&active_run_id, run_id, || {
                    if let Some(ref cb) = on_terminal {
                        cb();
                    }
                });
            };
            loop {
                interval.tick().await;
                if cancel.load(Ordering::SeqCst) {
                    bridge.run_if_current(&active_run_id, run_id, || {
                        bridge.cancel_sync();
                        tracing::info!(
                            target: "propagation-sync",
                            progress = bridge.sync_progress(),
                            establish_error = ?bridge.last_establish_error(),
                            "propagation sync cancelled"
                        );
                    });
                    break;
                }
                let active = bridge.sync_active();
                let finished_ok = bridge.last_finished_ok();
                let offer_error = bridge.last_offer_error();
                let establish_error = bridge.last_establish_error();
                // Complete/Failed immediately collapse to Idle (progress 0). Use sticky
                // last_finished_ok so success (e.g. HaveAll) is not reported as failure.
                let progress = if active {
                    bridge.sync_progress()
                } else {
                    match finished_ok {
                        Some(true) => 100.0,
                        Some(false) => 0.0,
                        None => bridge.sync_progress(),
                    }
                };
                if active && progress <= 10.0 && started.elapsed() > SYNC_STALL_TIMEOUT {
                    bridge.run_if_current(&active_run_id, run_id, || {
                        if let Ok(mut slot) = bridge.last_establish_error.lock() {
                            if slot.is_none() {
                                *slot = Some("NoLinkProof");
                            }
                        }
                        bridge.cancel_sync();
                        let message = bridge
                            .last_establish_error()
                            .or(establish_error)
                            .map(|e| format!("propagation establish failed: {e}"))
                            .unwrap_or_else(|| {
                                "propagation establish failed: NoLinkProof".to_string()
                            });
                        tracing::info!(
                            target: "propagation-sync",
                            message = %message,
                            progress,
                            "propagation sync stalled while establishing"
                        );
                        let payload = serde_json::json!({
                            "active": false,
                            "progress": 0.0,
                            "message": message,
                        });
                        let frame = serde_json::json!({
                            "type": "propagation_sync",
                            "payload": payload,
                        });
                        let _ = event_tx.send(frame.to_string());
                    });
                    break;
                }
                let fail_message = if !active && progress == 0.0 {
                    offer_error
                        .map(|e| format!("propagation offer rejected: {e}"))
                        .or_else(|| {
                            establish_error.map(|e| format!("propagation establish failed: {e}"))
                        })
                } else {
                    None
                };
                let payload = serde_json::json!({
                    "active": active,
                    "progress": progress,
                    "message": fail_message,
                });
                let frame = serde_json::json!({
                    "type": "propagation_sync",
                    "payload": payload,
                });
                // Drop stale progress frames when a newer sync run has taken ownership.
                if !bridge.run_if_current(&active_run_id, run_id, || {
                    let _ = event_tx.send(frame.to_string());
                }) {
                    break;
                }
                if !active && (progress >= 99.0 || finished_ok.is_some()) {
                    if finished_ok == Some(true) {
                        let peak = bridge.last_peak_progress();
                        let peer_outcome = if peak >= 70.0 { "transfer" } else { "have_all" };
                        tracing::info!(
                            target: "propagation-sync",
                            progress,
                            peak_progress = peak,
                            peer_outcome,
                            "propagation peer sync completed successfully"
                        );
                    } else if let Some(ref msg) = fail_message {
                        tracing::info!(
                            target: "propagation-sync",
                            message = %msg,
                            progress,
                            "propagation sync terminal failure"
                        );
                    }
                    break;
                }
            }
            clear_pins();
            // Do not emit a blanket progress=100 after a real failure/cancel terminal.
            bridge.run_if_current(&active_run_id, run_id, || {
                if !Self::should_emit_terminal_success(bridge.last_finished_ok()) {
                    return;
                }
                let payload = serde_json::json!({
                    "active": false,
                    "progress": 100.0,
                    "message": null,
                });
                let frame = serde_json::json!({
                    "type": "propagation_sync",
                    "payload": payload,
                });
                let _ = event_tx.send(frame.to_string());
            });
        });
    }
}

/// Merge peer-handled transient IDs into the router peer and persist (lxmd parity).
pub(crate) fn apply_peer_handled_updates(
    router: &mut LxmRouter,
    local_node: &Arc<Mutex<PropagationNode>>,
    peer_hash: [u8; 16],
    updates: &[PropagationTransientId],
) {
    if updates.is_empty() {
        return;
    }
    let Some(peer) = router.peers.get_mut(&peer_hash) else {
        return;
    };
    for transient_id in updates {
        peer.add_handled_message(transient_id);
    }
    persist_router_peer(local_node, router, peer_hash);
}

/// Apply peer `/offer` terminal result onto the router peer (lxmd parity).
pub(crate) fn apply_peer_sync_terminal(
    router: &mut LxmRouter,
    local_node: &Arc<Mutex<PropagationNode>>,
    result: &PeerSyncTerminalResult,
) {
    let Some(peer) = router.peers.get_mut(&result.peer_hash) else {
        return;
    };
    match result.state {
        PeerSyncTerminalState::Complete => {
            peer.sync_complete();
            if result.generation_exhausted {
                if let Some(generation) = result.offer_generation {
                    peer.mark_offer_generation_processed(generation);
                }
            }
        }
        PeerSyncTerminalState::Failed => {
            peer.sync_failed();
        }
    }
    persist_router_peer(local_node, router, result.peer_hash);
}

fn persist_router_peer(
    local_node: &Arc<Mutex<PropagationNode>>,
    router: &LxmRouter,
    peer_hash: [u8; 16],
) {
    let Some(peer) = router.peers.get(&peer_hash) else {
        return;
    };
    if let Ok(node) = local_node.lock() {
        if let Err(error) = node.save_peer(peer) {
            tracing::warn!(
                target: "propagation-sync",
                peer = %hex::encode(peer_hash),
                error = %error,
                "failed to persist peer sync state"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lxmf_core::constants::DeliveryMethod;

    /// Manual blob → drain (partial loopback). Full outbound→stored_locally→drain
    /// is covered by `local_prop_outbound_deposit_round_trip_stored_locally_then_drain`
    /// in `lxmf_outbound.rs`.
    #[test]
    fn drain_local_inbox_delivers_then_purges_own_mail() {
        let dir =
            std::env::temp_dir().join(format!("mesh-prop-drain-loopback-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let (tx, _rx) = mpsc::channel(8);
        let recipient = Identity::new();
        let bridge = PropagationBridge::new(
            tx,
            [0xab; 16],
            dir.clone(),
            &recipient,
            &super::super::pn_hosting_policy::PnHostingPolicy::default(),
        )
        .expect("bridge");

        // Deposit a stamped blob addressed to the bridge's own lxmf.delivery hash.
        let sender = Identity::new();
        let blob = super::super::propagation_download::build_client_download_blob(
            &sender,
            &recipient,
            "loopback mail",
        );
        {
            let mut node = bridge.local_node.lock().expect("node lock");
            // stamp_value high enough to clear any policy min_stamp_cost.
            assert!(node.accept_stamped_propagated_blob(&blob, &[0u8; 32], u8::MAX));
        }

        let (messages, listed) = bridge.drain_local_inbox();
        assert_eq!(listed, 1, "one message listed for our delivery hash");
        assert_eq!(messages.len(), 1, "one message decoded");
        assert_eq!(messages[0].content, "loopback mail");
        assert!(messages[0].incoming, "delivered mail is inbound");
        assert_eq!(messages[0].method, DeliveryMethod::Propagated);

        // Phase-3 purge must have removed the entry: a second drain is empty.
        let (again, listed_again) = bridge.drain_local_inbox();
        assert!(again.is_empty(), "purged mail is not re-delivered");
        assert_eq!(listed_again, 0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn inbox_drain_request_coalesces_until_taken() {
        let dir = std::env::temp_dir().join(format!("mesh-prop-drain-req-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let (tx, _rx) = mpsc::channel(8);
        let us = Identity::new();
        let bridge = PropagationBridge::new(
            tx,
            [0xab; 16],
            dir.clone(),
            &us,
            &super::super::pn_hosting_policy::PnHostingPolicy::default(),
        )
        .expect("bridge");
        assert!(!bridge.take_inbox_drain_request());
        bridge.request_inbox_drain();
        bridge.request_inbox_drain();
        assert!(bridge.take_inbox_drain_request());
        assert!(!bridge.take_inbox_drain_request());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn peer_ingress_accept_signals_drain_and_delivers_our_mail() {
        let dir =
            std::env::temp_dir().join(format!("mesh-prop-ingress-drain-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let (tx, _rx) = mpsc::channel(8);
        let us = Identity::new();
        let bridge = PropagationBridge::new(
            tx,
            [0xcd; 16],
            dir.clone(),
            &us,
            &super::super::pn_hosting_policy::PnHostingPolicy::default(),
        )
        .expect("bridge");

        let sender = Identity::new();
        let blob = super::super::propagation_download::build_client_download_blob(
            &sender,
            &us,
            "peer ingress mail",
        );
        {
            let mut node = bridge.local_node.lock().expect("node lock");
            assert!(node.accept_stamped_propagated_blob(&blob, &[0u8; 32], u8::MAX));
        }
        // Serve completion path calls this after accepted > 0.
        bridge.request_inbox_drain();
        assert!(bridge.take_inbox_drain_request());

        let (messages, listed) = bridge.drain_local_inbox();
        assert_eq!(listed, 1);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "peer ingress mail");

        let (again, listed_again) = bridge.drain_local_inbox();
        assert!(again.is_empty());
        assert_eq!(listed_again, 0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn peer_ingress_other_recipient_accepted_but_drain_delivers_zero() {
        let dir =
            std::env::temp_dir().join(format!("mesh-prop-ingress-foreign-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let (tx, _rx) = mpsc::channel(8);
        let us = Identity::new();
        let bridge = PropagationBridge::new(
            tx,
            [0xce; 16],
            dir.clone(),
            &us,
            &super::super::pn_hosting_policy::PnHostingPolicy::default(),
        )
        .expect("bridge");

        let sender = Identity::new();
        let other = Identity::new();
        let blob = super::super::propagation_download::build_client_download_blob(
            &sender,
            &other,
            "stays for peer offer",
        );
        {
            let mut node = bridge.local_node.lock().expect("node lock");
            assert!(node.accept_stamped_propagated_blob(&blob, &[0x5A; 32], u8::MAX));
            assert_eq!(node.message_count(), 1);
        }
        bridge.request_inbox_drain();
        assert!(bridge.take_inbox_drain_request());
        let (messages, listed) = bridge.drain_local_inbox();
        assert!(messages.is_empty());
        assert_eq!(listed, 0);
        assert_eq!(
            bridge.local_node.lock().expect("lock").message_count(),
            1,
            "foreign mail must remain for later peer /offer"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn two_node_inventory_handoff_then_drain_on_recipient_pn() {
        use lxmf_core::propagation_node::{PropagationNode, PropagationNodeConfig};

        let base = std::env::temp_dir().join(format!("mesh-prop-two-node-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let dir_a = base.join("a");
        let dir_b = base.join("b");
        std::fs::create_dir_all(&dir_a).expect("dir a");
        std::fs::create_dir_all(&dir_b).expect("dir b");

        let sender = Identity::new();
        let recipient = Identity::new();
        let hash_a = [0xa1u8; 16];
        let hash_b = [0xb2u8; 16];

        let mut node_a = PropagationNode::with_storage(
            PropagationNodeConfig {
                min_stamp_cost: 0,
                ..Default::default()
            },
            hash_a,
            dir_a,
        )
        .expect("node a");
        let mut node_b = PropagationNode::with_storage(
            PropagationNodeConfig {
                min_stamp_cost: 0,
                ..Default::default()
            },
            hash_b,
            dir_b,
        )
        .expect("node b");

        let blob = super::super::propagation_download::build_client_download_blob(
            &sender,
            &recipient,
            "pn to pn handoff",
        );
        let stamp = [0x11u8; 32];
        assert!(node_a.accept_stamped_propagated_blob(&blob, &stamp, u8::MAX));

        let offer = node_a.prepare_sync_offer(hash_b);
        assert!(
            !offer.transient_ids.is_empty(),
            "A must offer inventory toward B"
        );

        let wanted: Vec<[u8; 32]> = offer
            .transient_ids
            .iter()
            .filter_map(|id| {
                if id.len() != 32 {
                    return None;
                }
                let mut tid = [0u8; 32];
                tid.copy_from_slice(id);
                Some(tid)
            })
            .collect();
        let packed = node_a.message_get_request(&wanted);
        assert!(!packed.is_empty());

        let (tx, _rx) = mpsc::channel(8);
        let bridge_b = PropagationBridge::new(
            tx,
            hash_b,
            base.join("bridge-b"),
            &recipient,
            &super::super::pn_hosting_policy::PnHostingPolicy::default(),
        )
        .expect("bridge b");

        for (tid, stored) in &packed {
            assert!(stored.len() >= 32);
            let lxmf_data = &stored[..stored.len() - 32];
            let mut stamp_data = [0u8; 32];
            stamp_data.copy_from_slice(&stored[stored.len() - 32..]);
            assert!(node_b.accept_stamped_propagated_blob(lxmf_data, &stamp_data, u8::MAX));
            node_a.mark_peer_handled(&hash_b, tid);
            // Chat path uses the same stamped accept + drain_local_inbox seam.
            assert!(
                bridge_b
                    .local_node
                    .lock()
                    .expect("lock")
                    .accept_stamped_propagated_blob(lxmf_data, &stamp_data, u8::MAX)
            );
        }
        node_a.complete_sync(&hash_b);
        assert_eq!(node_b.message_count(), 1);

        let (messages, listed) = bridge_b.drain_local_inbox();
        assert_eq!(listed, 1);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "pn to pn handoff");

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn post_peer_get_queue_respects_client_active_guard() {
        let dir =
            std::env::temp_dir().join(format!("mesh-prop-post-peer-q-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let (tx, _rx) = mpsc::channel(8);
        let us = Identity::new();
        let bridge = PropagationBridge::new(
            tx,
            [0xdf; 16],
            dir.clone(),
            &us,
            &super::super::pn_hosting_policy::PnHostingPolicy::default(),
        )
        .expect("bridge");
        let peer = [0xeeu8; 16];
        bridge.queue_post_peer_get(peer);
        assert_eq!(bridge.take_pending_post_peer_get(), Some(peer));
        assert!(bridge.take_pending_post_peer_get().is_none());
        bridge.queue_post_peer_get(peer);
        bridge.clear_pending_post_peer_get();
        assert!(bridge.take_pending_post_peer_get().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A blob addressed to someone else must never leak into our inbox drain
    /// (server ownership gate + decrypt both reject it).
    #[test]
    fn drain_local_inbox_ignores_mail_for_other_recipients() {
        let dir =
            std::env::temp_dir().join(format!("mesh-prop-drain-foreign-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let (tx, _rx) = mpsc::channel(8);
        let us = Identity::new();
        let bridge = PropagationBridge::new(
            tx,
            [0xab; 16],
            dir.clone(),
            &us,
            &super::super::pn_hosting_policy::PnHostingPolicy::default(),
        )
        .expect("bridge");

        let sender = Identity::new();
        let other_recipient = Identity::new();
        let blob = super::super::propagation_download::build_client_download_blob(
            &sender,
            &other_recipient,
            "not for us",
        );
        {
            let mut node = bridge.local_node.lock().expect("node lock");
            assert!(node.accept_stamped_propagated_blob(&blob, &[0u8; 32], u8::MAX));
        }

        let (messages, listed) = bridge.drain_local_inbox();
        assert!(
            messages.is_empty() && listed == 0,
            "mail addressed to another identity must not drain into our inbox"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn should_emit_terminal_success_skips_explicit_failure() {
        assert!(!PropagationBridge::should_emit_terminal_success(Some(
            false
        )));
        assert!(PropagationBridge::should_emit_terminal_success(Some(true)));
        assert!(PropagationBridge::should_emit_terminal_success(None));
    }

    #[test]
    fn current_sync_run_gate_rejects_stale_emitter() {
        assert!(PropagationBridge::is_current_sync_run(2, 2));
        assert!(!PropagationBridge::is_current_sync_run(2, 1));
    }

    #[test]
    fn run_if_current_rejects_stale_side_effects() {
        let dir =
            std::env::temp_dir().join(format!("mesh-prop-bridge-lifecycle-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let (tx, _rx) = mpsc::channel(8);
        let identity = rns_identity::identity::Identity::new();
        let bridge = PropagationBridge::new(
            tx,
            [0xab; 16],
            dir.clone(),
            &identity,
            &super::super::pn_hosting_policy::PnHostingPolicy::default(),
        )
        .expect("bridge");
        let active = AtomicU64::new(1);
        let mut ran = false;
        assert!(bridge.run_if_current(&active, 1, || {
            ran = true;
        }));
        assert!(ran);
        active.store(2, Ordering::SeqCst);
        ran = false;
        assert!(!bridge.run_if_current(&active, 1, || {
            ran = true;
        }));
        assert!(!ran);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cancel_sync_sets_sticky_failure() {
        let dir =
            std::env::temp_dir().join(format!("mesh-prop-bridge-cancel-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let (tx, _rx) = mpsc::channel(8);
        let identity = rns_identity::identity::Identity::new();
        let bridge = PropagationBridge::new(
            tx,
            [0xab; 16],
            dir.clone(),
            &identity,
            &super::super::pn_hosting_policy::PnHostingPolicy::default(),
        )
        .expect("bridge");
        bridge.cancel_sync();
        assert_eq!(bridge.last_finished_ok(), Some(false));
        assert!(!bridge.sync_active());
        // Tip requires Idle for the next request_sync_now_*; cancel must not leave Failed.
        assert!(matches!(
            bridge.sync_task.lock().expect("lock").state,
            SyncTaskState::Idle
        ));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn cancel_sync_after_offer_peak_stamps_success() {
        let dir = std::env::temp_dir().join(format!(
            "mesh-prop-bridge-cancel-peak-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let (tx, _rx) = mpsc::channel(8);
        let identity = rns_identity::identity::Identity::new();
        let bridge = PropagationBridge::new(
            tx,
            [0xab; 16],
            dir.clone(),
            &identity,
            &super::super::pn_hosting_policy::PnHostingPolicy::default(),
        )
        .expect("bridge");
        bridge.force_peak_progress_for_test(25.0);
        bridge.cancel_sync();
        assert_eq!(bridge.last_finished_ok(), Some(true));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn progress_for_state_maps_offer_threshold() {
        assert!(
            (PropagationBridge::progress_for_state(SyncTaskState::Establishing) - 10.0).abs()
                < f64::EPSILON
        );
        assert!(
            (PropagationBridge::progress_for_state(SyncTaskState::Offering) - 25.0).abs()
                < f64::EPSILON
        );
        assert!(PropagationBridge::progress_for_state(SyncTaskState::Failed).abs() < f64::EPSILON);
    }

    #[test]
    fn early_terminal_failure_stamps_establish_not_unknown() {
        let dir =
            std::env::temp_dir().join(format!("mesh-prop-bridge-stamp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let (tx, _rx) = mpsc::channel(8);
        let identity = rns_identity::identity::Identity::new();
        let bridge = PropagationBridge::new(
            tx,
            [0xab; 16],
            dir.clone(),
            &identity,
            &super::super::pn_hosting_policy::PnHostingPolicy::default(),
        )
        .expect("bridge");
        bridge.stamp_terminal_failure_from_peak(10.0);
        assert_eq!(bridge.last_establish_error(), Some("NoLinkProof"));
        assert_eq!(bridge.last_offer_error(), None);
        bridge.clear_sticky_errors();
        bridge.stamp_terminal_failure_from_peak(40.0);
        assert_eq!(bridge.last_establish_error(), None);
        assert_eq!(bridge.last_offer_error(), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn apply_peer_sync_terminal_complete_returns_idle_and_marks_generation() {
        use lxmf_core::constants::PeerState;
        use lxmf_core::peer::LxmPeer;
        use lxmf_core::router::RouterConfig;

        let dir =
            std::env::temp_dir().join(format!("mesh-prop-peer-terminal-ok-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let (tx, _rx) = mpsc::channel(8);
        let us = Identity::new();
        let bridge = PropagationBridge::new(
            tx,
            [0xab; 16],
            dir.clone(),
            &us,
            &super::super::pn_hosting_policy::PnHostingPolicy::default(),
        )
        .expect("bridge");

        let peer_hash = [0x11u8; 16];
        let mut router = LxmRouter::new(RouterConfig::default());
        let mut peer = LxmPeer::new(peer_hash);
        peer.begin_sync();
        assert_ne!(peer.state, PeerState::Idle);
        router.peers.insert(peer_hash, peer);

        apply_peer_sync_terminal(
            &mut router,
            &bridge.local_node(),
            &PeerSyncTerminalResult {
                peer_hash,
                state: PeerSyncTerminalState::Complete,
                offer_generation: Some(5),
                generation_exhausted: true,
            },
        );
        let peer = router.peers.get(&peer_hash).expect("peer");
        assert_eq!(peer.state, PeerState::Idle);
        assert!(
            !peer.needs_offer_generation(5),
            "exhausted generation must not remain due"
        );
        assert!(
            peer.needs_offer_generation(6),
            "newer store generation must re-enable sync"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn apply_peer_sync_terminal_failed_returns_idle_without_marking_generation() {
        use lxmf_core::constants::PeerState;
        use lxmf_core::peer::LxmPeer;
        use lxmf_core::router::RouterConfig;

        let dir = std::env::temp_dir().join(format!(
            "mesh-prop-peer-terminal-fail-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let (tx, _rx) = mpsc::channel(8);
        let us = Identity::new();
        let bridge = PropagationBridge::new(
            tx,
            [0xab; 16],
            dir.clone(),
            &us,
            &super::super::pn_hosting_policy::PnHostingPolicy::default(),
        )
        .expect("bridge");

        let peer_hash = [0x22u8; 16];
        let mut router = LxmRouter::new(RouterConfig::default());
        let mut peer = LxmPeer::new(peer_hash);
        peer.begin_sync();
        router.peers.insert(peer_hash, peer);

        apply_peer_sync_terminal(
            &mut router,
            &bridge.local_node(),
            &PeerSyncTerminalResult {
                peer_hash,
                state: PeerSyncTerminalState::Failed,
                offer_generation: Some(3),
                generation_exhausted: false,
            },
        );
        let peer = router.peers.get(&peer_hash).expect("peer");
        assert_eq!(peer.state, PeerState::Idle);
        assert!(
            peer.needs_offer_generation(3),
            "failed sync must leave generation retryable"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn apply_peer_handled_updates_merges_ids() {
        use lxmf_core::peer::LxmPeer;
        use lxmf_core::router::RouterConfig;

        let dir =
            std::env::temp_dir().join(format!("mesh-prop-peer-handled-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let (tx, _rx) = mpsc::channel(8);
        let us = Identity::new();
        let bridge = PropagationBridge::new(
            tx,
            [0xab; 16],
            dir.clone(),
            &us,
            &super::super::pn_hosting_policy::PnHostingPolicy::default(),
        )
        .expect("bridge");

        let peer_hash = [0x33u8; 16];
        let mut router = LxmRouter::new(RouterConfig::default());
        router.peers.insert(peer_hash, LxmPeer::new(peer_hash));
        let tid = [0xAAu8; 32];
        apply_peer_handled_updates(&mut router, &bridge.local_node(), peer_hash, &[tid]);
        assert!(
            router
                .peers
                .get(&peer_hash)
                .expect("peer")
                .handled_messages
                .contains(&tid)
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn source_host_peer_sync_idle_gate_and_policy_start() {
        let live = include_str!("live.rs");
        assert!(
            live.contains("drive_local_host_peer_sync"),
            "maintenance must drive host peer sync when serving"
        );
        assert!(
            live.contains("is_local_serving()")
                && live.contains("!propagation.sync_active()")
                && live.contains("!propagation.client_download_active()")
                && live.contains("propagation_sync_target().is_none()"),
            "peer sync tick must require serving + idle + no client /get + no sync target"
        );
        assert!(
            live.contains("start_sync_with_policy"),
            "host peer loop must start policy-aware sync"
        );
        assert!(
            live.contains("queue_post_peer_get")
                && live.contains("take_pending_post_peer_get")
                && live.contains("emit_ui")
                && live.contains("get_post_peer"),
            "peer /offer Complete must sequence silent client /get"
        );
        assert!(
            live.contains("HOST_PERIODIC_GET_INTERVAL")
                && live.contains("next_host_periodic_get_target")
                && live.contains("get_periodic"),
            "Host serving must schedule periodic silent /get when idle"
        );
        assert!(
            live.contains("request_inbox_drain")
                && live.contains("take_inbox_drain_request")
                && live.contains("local-prop inbox auto-drain Completes"),
            "inbound peer accept must auto-drain store into Chat"
        );
        let serve = include_str!("propagation_serve.rs");
        assert!(
            serve.contains("on_inbound_accepted") && serve.contains("accepted > 0"),
            "serve Resource accept must signal inbox drain"
        );
        let bridge = include_str!("propagation_bridge.rs");
        assert!(
            bridge.contains("start_sync_with_policy"),
            "bridge must expose policy sync for host peer loop"
        );
        assert!(
            bridge.contains("apply_peer_sync_terminal")
                && bridge.contains("sync_complete")
                && bridge.contains("mark_offer_generation_processed")
                && bridge.contains("take_handled_updates")
                && bridge.contains("save_peer"),
            "host sync tick must apply lxmd peer terminal + handled updates"
        );
        // Inbox retrieval is the client `/get` download, driven from live.rs; the
        // bridge only logs peer-sync (`/offer`) outcomes, never inbox retrieval.
        assert!(
            bridge.contains("peer_outcome"),
            "peer sync Completes must log peer-sync (not retrieve) telemetry"
        );
        assert!(
            live.contains("propagation-retrieve"),
            "client /get download must log inbox retrieve telemetry"
        );
        // The `/get` pull must stay wired: PropagationClient owned by the bridge,
        // driven from live.rs, so PN→inbox retrieval cannot silently regress.
        assert!(
            bridge.contains("PropagationClient") && bridge.contains("poll_client_download"),
            "bridge must own the PropagationClient `/get` pull"
        );
        assert!(
            live.contains("spawn_client_download_driver") && live.contains("start_client_download"),
            "live sync must drive the client `/get` download"
        );
        // Remote sync must hard-fail when no path exists (same as offer probe) instead of
        // starting Establishing and timing out in the renderer.
        let sync_fn_start = live
            .find("pub async fn start_propagation_sync")
            .expect("start_propagation_sync");
        let sync_fn = &live[sync_fn_start..];
        let sync_fn_end = sync_fn[1..]
            .find("\n    pub ")
            .map_or(sync_fn.len(), |idx| idx + 1);
        let sync_body = &sync_fn[..sync_fn_end];
        assert!(
            sync_body.contains("PROPAGATION_PATH_UNKNOWN"),
            "start_propagation_sync must return PROPAGATION_PATH_UNKNOWN when path is missing"
        );
        assert!(
            !sync_body.contains("let _path_ok"),
            "start_propagation_sync must not discard ensure_path_for_direct"
        );
        let path_gate_at = sync_body
            .find("PROPAGATION_PATH_UNKNOWN")
            .expect("PATH_UNKNOWN in start_propagation_sync");
        let get_at = sync_body
            .find("spawn_client_download_driver")
            .expect("client /get driver in start_propagation_sync");
        assert!(
            path_gate_at < get_at,
            "path gate must run before client /get download"
        );
        // Peer `/offer` inventory sync belongs on the host peer loop. User Sync that
        // starts peer sync with a nonempty messagestore hangs at AwaitingResponse.
        assert!(
            !sync_body.contains("start_sync(hash"),
            "user Sync must not start peer /offer inventory sync"
        );
        assert!(
            sync_body.contains("peer /offer deferred to host loop")
                || sync_body.contains("peerOfferSkipped"),
            "user Sync must document /get-primary peer-offer skip"
        );
        // Offer probe still validates remotes speak `/offer`.
        let probe_start = live
            .find("pub async fn probe_propagation_offer")
            .expect("probe_propagation_offer");
        let probe_fn = &live[probe_start..];
        let probe_end = probe_fn[1..]
            .find("\n    pub ")
            .map_or(probe_fn.len(), |idx| idx + 1);
        assert!(
            probe_fn[..probe_end].contains("start_sync(hash"),
            "offer probe must still exercise peer /offer"
        );
        // Configured-row Sync must not accept via the persistence stub while live is None.
        let stack_sync = include_str!("mod.rs");
        let by_id_start = stack_sync
            .find("pub async fn start_propagation_sync(&self, propagation_id: &str)")
            .expect("start_propagation_sync by id");
        let by_id = &stack_sync[by_id_start..];
        let by_id_end = by_id[1..]
            .find("\n    pub ")
            .map_or(by_id.len(), |idx| idx + 1);
        assert!(
            by_id[..by_id_end].contains("PROPAGATION_STACK_NOT_LIVE"),
            "by-id Sync must hard-fail when RNS live is not attached"
        );
        assert!(
            by_id[..by_id_end].contains("#[cfg(not(feature = \"rns-stack\"))]"),
            "persistence stub Sync must stay gated behind not(rns-stack)"
        );
    }

    /// End-to-end wiring graph for Host PN fabric → Chat (non-flaky source contracts).
    #[test]
    fn source_local_pn_fabric_to_chat_wiring() {
        let serve = include_str!("propagation_serve.rs");
        let bridge = include_str!("propagation_bridge.rs");
        let live = include_str!("live.rs");
        assert!(
            serve.contains("on_inbound_accepted") && serve.contains("accepted > 0"),
            "serve accept → drain signal"
        );
        assert!(
            bridge.contains("fn request_inbox_drain")
                && bridge.contains("fn take_inbox_drain_request"),
            "bridge must expose coalesced inbox drain request"
        );
        assert!(
            live.contains("take_inbox_drain_request")
                && live.contains("drain_local_inbox")
                && live.contains("local-prop inbox auto-drain Completes"),
            "maintenance drain when requested"
        );
        assert!(
            live.contains("queue_post_peer_get")
                && live.contains("spawn_client_download_driver_task")
                && live.contains("false,"),
            "peer terminal → silent /get (emit_ui false)"
        );
        assert!(
            live.contains("delivery_callback")
                && live.contains("get_post_peer")
                && live.contains("get_periodic"),
            "/get Complete → delivery_callback (post-peer + periodic paths)"
        );
        assert!(
            bridge.contains("apply_peer_sync_terminal") && bridge.contains("take_handled_updates"),
            "peer terminal bookkeeping must stay wired"
        );
        let sync_fn_start = live
            .find("pub async fn start_propagation_sync")
            .expect("start_propagation_sync");
        let sync_fn = &live[sync_fn_start..];
        let sync_fn_end = sync_fn[1..]
            .find("\n    pub ")
            .map_or(sync_fn.len(), |idx| idx + 1);
        let sync_body = &sync_fn[..sync_fn_end];
        assert!(
            !sync_body.contains("start_sync(hash"),
            "user Sync remains /get-primary (no peer start_sync)"
        );
        assert!(
            sync_body.contains("spawn_client_download_driver") && sync_body.contains("true,"),
            "user Sync still drives UI client /get"
        );
    }

    /// Auto deposits on discovered PNs, so a newly heard announce must refresh the cascade
    /// shortlist immediately instead of waiting for a settings write or stack restart.
    #[test]
    fn source_announce_handler_rebuilds_pn_cascade_candidates() {
        let live = include_str!("live.rs");
        let handler_start = live
            .find("pub fn register_propagation_announce_handler")
            .expect("propagation announce handler");
        let rest = &live[handler_start..];
        let handler_end = rest[1..]
            .find("\n    pub fn ")
            .map_or(rest.len(), |idx| idx + 1);
        assert!(
            rest[..handler_end].contains("rebuild_pn_cascade_candidates("),
            "announce handler must rebuild cascade candidates when a PN is heard"
        );
        assert!(
            live.contains("async fn rebuild_pn_cascade_candidates("),
            "cascade rebuild must be shared with refresh_pn_cascade_candidates"
        );
    }
}

//! Live propagation node serving and sync against remote propagation nodes.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use lxmf_core::peer::OutboundOfferPolicy;
use lxmf_core::propagation_node::{PropagationNode, PropagationNodeConfig};
use lxmf_core::propagation_sync::{PeerSyncTerminalState, PropagationSyncTask, SyncTaskState};
use lxmf_core::router::LxmRouter;
use rns_identity::identity::Identity;
use rns_transport::messages::TransportMessage;
use tokio::sync::{Notify, broadcast, mpsc};

/// Completed host-peer peering PoW (stamp, value) awaiting apply onto `LxmPeer`.
type PeeringKeyResult = ([u8; 16], [u8; 32], u32);

/// Cap concurrent host-peer peering-key PoW jobs (CPU-heavy stamp generation).
const MAX_PEERING_KEY_JOBS: usize = 8;

pub struct PropagationBridge {
    local_dest_hash: [u8; 16],
    local_node: Arc<Mutex<PropagationNode>>,
    sync_task: Mutex<PropagationSyncTask>,
    local_serving: AtomicBool,
    /// Set when background `load_messagestore_from_disk` finishes (ok or err).
    messagestore_loaded: AtomicBool,
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
        let mut sync_task = PropagationSyncTask::with_shared_node(transport_tx, local_node.clone());
        let signing_key = identity
            .get_signing_key()
            .ok_or_else(|| "propagation sync: identity has no signing key".to_string())?;
        sync_task.set_identity(identity.get_public_key(), signing_key);
        Ok(Self {
            local_dest_hash,
            local_node,
            sync_task: Mutex::new(sync_task),
            local_serving: AtomicBool::new(false),
            messagestore_loaded: AtomicBool::new(false),
            messagestore_notify: Notify::new(),
            sync_lifecycle: Mutex::new(()),
            last_offer_error: Mutex::new(None),
            last_establish_error: Mutex::new(None),
            last_finished_ok: Mutex::new(None),
            peak_progress: Mutex::new(0.0),
            peering_key_jobs: Mutex::new(HashSet::new()),
            peering_key_results: Mutex::new(Vec::new()),
        })
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
            match result {
                Ok(Ok(())) => {
                    tracing::info!(
                        elapsed_ms = load_started.elapsed().as_millis() as u64,
                        "propagation messagestore loaded in background"
                    );
                }
                Ok(Err(e)) => {
                    tracing::warn!(error = %e, "background propagation messagestore load failed");
                }
                Err(e) => {
                    tracing::warn!(error = %e, "background propagation messagestore load join failed");
                }
            }
            this.messagestore_loaded.store(true, Ordering::SeqCst);
            this.messagestore_notify.notify_waiters();
        });
    }

    /// Wait until background messagestore load has finished (success or failure).
    pub async fn wait_messagestore_loaded(&self) {
        if self.messagestore_loaded.load(Ordering::SeqCst) {
            return;
        }
        let notified = self.messagestore_notify.notified();
        if self.messagestore_loaded.load(Ordering::SeqCst) {
            return;
        }
        notified.await;
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
    pub fn should_emit_terminal_success(last_finished_ok: Option<bool>) -> bool {
        last_finished_ok != Some(false)
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
    pub fn tick(&self, known_identities: &HashMap<String, [u8; 64]>) -> Option<(bool, [u8; 16])> {
        let terminal = if let Ok(mut task) = self.sync_task.lock() {
            // Sample before drain/tick: tip collapses Complete|Failed → Idle in tick().
            self.note_peak_progress(Self::progress_for_state(task.state));
            task.drain_events(known_identities);
            self.note_peak_progress(Self::progress_for_state(task.state));
            task.tick();
            task.take_terminal_peer_result().map(|result| {
                (
                    matches!(result.state, PeerSyncTerminalState::Complete),
                    result.peer_hash,
                )
            })
        } else {
            None
        };
        if let Some((ok, peer_hash)) = terminal {
            if let Ok(mut slot) = self.last_finished_ok.lock() {
                *slot = Some(ok);
            }
            if ok {
                let peak = self.last_peak_progress();
                // Peak ≥ Transferring (70) means WantSome/WantAll pulled blobs; lower ≈ HaveAll.
                let retrieve_mode = if peak >= 70.0 { "transfer" } else { "have_all" };
                tracing::info!(
                    target: "propagation-retrieve",
                    pn_hash = %hex::encode(peer_hash),
                    peak_progress = peak,
                    retrieve_mode,
                    "remote/host PN sync Completes"
                );
            } else {
                let peak = self.last_peak_progress();
                self.stamp_terminal_failure_from_peak(peak);
            }
        }
        terminal
    }

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
                        let retrieve_mode = if peak >= 70.0 { "transfer" } else { "have_all" };
                        tracing::info!(
                            target: "propagation-retrieve",
                            progress,
                            peak_progress = peak,
                            retrieve_mode,
                            "propagation sync completed successfully"
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

#[cfg(test)]
mod tests {
    use super::*;

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
    fn source_host_peer_sync_idle_gate_and_policy_start() {
        let live = include_str!("live.rs");
        assert!(
            live.contains("drive_local_host_peer_sync"),
            "maintenance must drive host peer sync when serving"
        );
        assert!(
            live.contains("is_local_serving()")
                && live.contains("!propagation.sync_active()")
                && live.contains("propagation_sync_target().is_none()"),
            "peer sync tick must require serving + idle + no user sync target"
        );
        assert!(
            live.contains("start_sync_with_policy"),
            "host peer loop must start policy-aware sync"
        );
        let bridge = include_str!("propagation_bridge.rs");
        assert!(
            bridge.contains("start_sync_with_policy"),
            "bridge must expose policy sync for host peer loop"
        );
        assert!(
            bridge.contains("propagation-retrieve"),
            "sync Completes must log retrieve telemetry"
        );
    }
}

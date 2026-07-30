//! Live propagation node serving and sync against remote propagation nodes.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use lxmf_core::propagation_node::{PropagationNode, PropagationNodeConfig};
use lxmf_core::propagation_sync::{PropagationSyncTask, SyncTaskState};
use lxmf_core::router::LxmRouter;
use rns_identity::identity::Identity;
use rns_transport::messages::TransportMessage;
use tokio::sync::{broadcast, mpsc};

pub struct PropagationBridge {
    local_dest_hash: [u8; 16],
    local_node: Arc<Mutex<PropagationNode>>,
    sync_task: Mutex<PropagationSyncTask>,
    local_serving: AtomicBool,
    /// Serializes sync-run generation changes with emitter cancel / pin / event side effects.
    sync_lifecycle: Mutex<()>,
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
        };
        let local_node = Arc::new(Mutex::new(
            PropagationNode::with_storage(node_config, local_dest_hash, storage_dir)
                .map_err(|e| format!("propagation storage init: {e}"))?,
        ));
        let mut sync_task = PropagationSyncTask::with_shared_node(transport_tx, local_node.clone());
        let signing_key = identity
            .get_signing_key()
            .ok_or_else(|| "propagation sync: identity has no signing key".to_string())?;
        sync_task.set_local_identity(identity.get_public_key(), signing_key);
        Ok(Self {
            local_dest_hash,
            local_node,
            sync_task: Mutex::new(sync_task),
            local_serving: AtomicBool::new(false),
            sync_lifecycle: Mutex::new(()),
        })
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

    #[allow(clippy::type_complexity)] // peering tuple mirrors RNS PropagationSyncTask::configure_peering
    pub fn start_sync(
        &self,
        remote_hash: [u8; 16],
        peering: Option<([u8; 16], [u8; 16], u8, Option<Vec<u8>>)>,
    ) -> bool {
        let Ok(mut task) = self.sync_task.lock() else {
            return false;
        };
        if let Some((local_id, peer_id, cost, key)) = peering {
            task.configure_peering(local_id, peer_id, cost, key);
        }
        task.request_sync_now(remote_hash);
        true
    }

    pub fn cancel_sync(&self) {
        if let Ok(mut task) = self.sync_task.lock() {
            task.state = SyncTaskState::Failed;
            // Sticky fail so the progress emitter does not emit a terminal progress=100.
            task.last_finished_ok = Some(false);
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
            .map(|task| match task.state {
                SyncTaskState::Establishing => 10.0,
                SyncTaskState::Offering => 25.0,
                SyncTaskState::AwaitingResponse => 40.0,
                SyncTaskState::Transferring => 70.0,
                SyncTaskState::Complete => 100.0,
                SyncTaskState::Idle | SyncTaskState::Failed => 0.0,
            })
            .unwrap_or(0.0)
    }

    pub fn last_offer_error(&self) -> Option<&'static str> {
        self.sync_task
            .lock()
            .ok()
            .and_then(|task| task.last_offer_error)
    }

    pub fn last_establish_error(&self) -> Option<&'static str> {
        self.sync_task
            .lock()
            .ok()
            .and_then(|task| task.last_establish_error)
    }

    /// Sticky success/failure after Complete/Failed collapses to Idle.
    pub fn last_finished_ok(&self) -> Option<bool> {
        self.sync_task
            .lock()
            .ok()
            .and_then(|task| task.last_finished_ok)
    }

    pub fn tick(&self, known_identities: &HashMap<String, [u8; 64]>) {
        if let Ok(mut task) = self.sync_task.lock() {
            task.drain_events(known_identities);
            task.tick();
        }
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
                        bridge.cancel_sync();
                        let message = establish_error
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
                        tracing::info!(
                            target: "propagation-sync",
                            progress,
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
        let _ = std::fs::remove_dir_all(&dir);
    }
}

//! Live propagation node serving and sync against remote propagation nodes.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
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
}

impl PropagationBridge {
    pub fn new(
        transport_tx: mpsc::Sender<TransportMessage>,
        local_dest_hash: [u8; 16],
        storage_dir: PathBuf,
        identity: &Identity,
    ) -> Result<Self, String> {
        std::fs::create_dir_all(&storage_dir).map_err(|e| e.to_string())?;
        let local_node = Arc::new(Mutex::new(
            PropagationNode::with_storage(
                PropagationNodeConfig::default(),
                local_dest_hash,
                storage_dir,
            )
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
        })
    }

    pub fn local_dest_hash_hex(&self) -> String {
        hex::encode(self.local_dest_hash)
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

    pub fn start_sync(
        &self,
        remote_hash: [u8; 16],
        peering: Option<([u8; 16], [u8; 16], u8, Option<Vec<u8>>)>,
    ) -> bool {
        let mut task = match self.sync_task.lock() {
            Ok(task) => task,
            Err(_) => return false,
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
        self.sync_task.lock().map(|task| match task.state {
            SyncTaskState::Idle => 0.0,
            SyncTaskState::Establishing => 10.0,
            SyncTaskState::Offering => 25.0,
            SyncTaskState::AwaitingResponse => 40.0,
            SyncTaskState::Transferring => 70.0,
            SyncTaskState::Complete => 100.0,
            SyncTaskState::Failed => 0.0,
        }).unwrap_or(0.0)
    }

    pub fn last_offer_error(&self) -> Option<&'static str> {
        self.sync_task
            .lock()
            .ok()
            .and_then(|task| task.last_offer_error)
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
    ) {
        let bridge = Arc::clone(self);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(500));
            let started = Instant::now();
            const SYNC_STALL_TIMEOUT: Duration = Duration::from_secs(60);
            loop {
                interval.tick().await;
                if cancel.load(Ordering::SeqCst) {
                    bridge.cancel_sync();
                    break;
                }
                let active = bridge.sync_active();
                let finished_ok = bridge.last_finished_ok();
                let offer_error = bridge.last_offer_error();
                // Complete/Failed immediately collapse to Idle (progress 0). Use sticky
                // last_finished_ok so success (e.g. HaveAll) is not reported as failure.
                let progress = if !active {
                    match finished_ok {
                        Some(true) => 100.0,
                        Some(false) => 0.0,
                        None => bridge.sync_progress(),
                    }
                } else {
                    bridge.sync_progress()
                };
                if active && progress <= 10.0 && started.elapsed() > SYNC_STALL_TIMEOUT {
                    bridge.cancel_sync();
                    let payload = serde_json::json!({
                        "active": false,
                        "progress": 0.0,
                        "message": "propagation node unreachable",
                    });
                    let frame = serde_json::json!({
                        "type": "propagation_sync",
                        "payload": payload,
                    });
                    let _ = event_tx.send(frame.to_string());
                    break;
                }
                let fail_message = if !active && progress == 0.0 {
                    offer_error.map(|e| format!("propagation offer rejected: {e}"))
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
                let _ = event_tx.send(frame.to_string());
                if !active && (progress >= 99.0 || finished_ok.is_some()) {
                    break;
                }
            }
            // Do not emit a blanket progress=100 after a real failure/cancel terminal.
            if Self::should_emit_terminal_success(bridge.last_finished_ok()) {
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
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_emit_terminal_success_skips_explicit_failure() {
        assert!(!PropagationBridge::should_emit_terminal_success(Some(false)));
        assert!(PropagationBridge::should_emit_terminal_success(Some(true)));
        assert!(PropagationBridge::should_emit_terminal_success(None));
    }

    #[test]
    fn cancel_sync_sets_sticky_failure() {
        let dir = std::env::temp_dir().join(format!(
            "mesh-prop-bridge-cancel-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("tmpdir");
        let (tx, _rx) = mpsc::channel(8);
        let identity = rns_identity::identity::Identity::new();
        let bridge = PropagationBridge::new(tx, [0xab; 16], dir.clone(), &identity)
            .expect("bridge");
        bridge.cancel_sync();
        assert_eq!(bridge.last_finished_ok(), Some(false));
        assert!(!bridge.sync_active());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

//! Live propagation node serving and sync against remote propagation nodes.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use lxmf_core::propagation_node::{PropagationNode, PropagationNodeConfig};
use lxmf_core::propagation_sync::{PropagationSyncTask, SyncTaskState};
use lxmf_core::router::LxmRouter;
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
        let sync_task = PropagationSyncTask::with_shared_node(transport_tx, local_node.clone());
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

    pub fn start_sync(&self, remote_hash: [u8; 16]) -> bool {
        let mut task = match self.sync_task.lock() {
            Ok(task) => task,
            Err(_) => return false,
        };
        task.request_sync_now(remote_hash);
        true
    }

    pub fn cancel_sync(&self) {
        if let Ok(mut task) = self.sync_task.lock() {
            task.state = SyncTaskState::Failed;
        }
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
            SyncTaskState::Establishing => 0.1,
            SyncTaskState::Offering => 0.25,
            SyncTaskState::AwaitingResponse => 0.4,
            SyncTaskState::Transferring => 0.7,
            SyncTaskState::Complete => 100.0,
            SyncTaskState::Failed => 0.0,
        }).unwrap_or(0.0)
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
            loop {
                interval.tick().await;
                if cancel.load(Ordering::SeqCst) {
                    bridge.cancel_sync();
                    break;
                }
                let active = bridge.sync_active();
                let progress = bridge.sync_progress();
                let payload = serde_json::json!({
                    "active": active,
                    "progress": progress,
                    "message": null,
                });
                let frame = serde_json::json!({
                    "type": "propagation_sync",
                    "payload": payload,
                });
                let _ = event_tx.send(frame.to_string());
                if !active && progress >= 99.0 {
                    break;
                }
                if !active && progress == 0.0 {
                    break;
                }
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
    }
}

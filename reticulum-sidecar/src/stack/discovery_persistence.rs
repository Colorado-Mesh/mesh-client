use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::RwLock;

use super::persistence::PersistedState;

const SAVE_INTERVAL: Duration = Duration::from_secs(60);

/// Announces update memory immediately; only their durability is batched. A fixed
/// interval, rather than a debounce, also flushes during sustained announce traffic.
pub(super) async fn run(
    inner: Arc<RwLock<PersistedState>>,
    config_dir: PathBuf,
    storage_dir: PathBuf,
) {
    loop {
        tokio::time::sleep(SAVE_INTERVAL).await;
        if let Err(error) = flush(&inner, &config_dir, &storage_dir).await {
            tracing::warn!(%error, "discovery state persist failed; retrying next interval");
        }
    }
}

/// Keep the lock through the write so a deferred snapshot cannot overwrite a newer
/// user save. Serialization and filesystem I/O run off the async runtime threads.
/// `save` clears the dirty flag only on success, including saves by user actions.
pub(super) async fn flush(
    inner: &Arc<RwLock<PersistedState>>,
    config_dir: &Path,
    storage_dir: &Path,
) -> Result<bool, String> {
    let state = Arc::clone(inner).write_owned().await;
    if !state.discovery_dirty() {
        return Ok(false);
    }
    let config_dir = config_dir.to_path_buf();
    let storage_dir = storage_dir.to_path_buf();
    tokio::task::spawn_blocking(move || {
        state.save(&config_dir, &storage_dir)?;
        Ok(true)
    })
    .await
    .map_err(|error| format!("discovery persistence task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    const STATE_FILE: &str = "mesh_client_stack.json";
    const NODE: &str = "00112233445566778899aabbccddeeff";

    fn announce(state: &mut PersistedState, name: &str) {
        state.upsert_nomad_node(NODE, None, Some(name.into()), Some(2));
        state.upsert_rrc_hub(NODE, None, Some(name.into()), Some(3), "discovered");
    }

    #[tokio::test(start_paused = true)]
    async fn sustained_announces_share_one_save_per_minute_and_idle_ticks_do_not_write() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = PersistedState::default_empty();
        // Message history makes each rewrite expensive, as in the reported ~6.5 MiB file.
        state
            .messages
            .push(serde_json::json!({ "content": "x".repeat(6_815_744) }));
        state.save(dir.path(), dir.path()).unwrap();
        let original = fs::read(dir.path().join(STATE_FILE)).unwrap();
        let inner = Arc::new(RwLock::new(state));
        let mut writer = Box::pin(run(
            Arc::clone(&inner),
            dir.path().into(),
            dir.path().into(),
        ));
        assert!(futures_util::poll!(&mut writer).is_pending());

        for second in 0..60 {
            announce(&mut *inner.write().await, &format!("node-{second}"));
            tokio::time::advance(Duration::from_secs(1)).await;
            if second < 59 {
                assert!(futures_util::poll!(&mut writer).is_pending());
            }
        }
        assert_eq!(fs::read(dir.path().join(STATE_FILE)).unwrap(), original);
        assert_eq!(
            inner.read().await.nomad_nodes[0].display_name.as_deref(),
            Some("node-59")
        );

        // The due poll takes the write lock before dispatching the blocking I/O.
        assert!(futures_util::poll!(&mut writer).is_pending());
        assert!(!inner.read().await.discovery_dirty());
        let saved = PersistedState::load(dir.path(), dir.path());
        assert_eq!(
            saved.nomad_nodes[0].display_name.as_deref(),
            Some("node-59")
        );
        assert_eq!(saved.rrc_hubs[0].display_name.as_deref(), Some("node-59"));
        assert_eq!(saved.messages.len(), 1);
        assert!(!saved.discovery_dirty());

        assert!(futures_util::poll!(&mut writer).is_pending());
        // Removing the fixture makes an unwanted idle rewrite observable without mtime races.
        fs::remove_file(dir.path().join(STATE_FILE)).unwrap();
        tokio::time::advance(SAVE_INTERVAL).await;
        assert!(futures_util::poll!(&mut writer).is_pending());
        assert!(!dir.path().join(STATE_FILE).exists());

        announce(&mut *inner.write().await, "next interval");
        tokio::time::advance(SAVE_INTERVAL).await;
        assert!(futures_util::poll!(&mut writer).is_pending());
        assert!(!inner.read().await.discovery_dirty());
        assert_eq!(
            PersistedState::load(dir.path(), dir.path()).nomad_nodes[0]
                .display_name
                .as_deref(),
            Some("next interval")
        );
    }

    #[tokio::test]
    async fn immediate_user_save_covers_pending_discovery_and_cannot_be_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let inner = Arc::new(RwLock::new(PersistedState::default_empty()));
        let mut state = inner.write().await;
        announce(&mut state, "discovered");
        let mut pending = Box::pin(flush(&inner, dir.path(), dir.path()));
        assert!(futures_util::poll!(&mut pending).is_pending());
        state.set_nomad_favorite(NODE, true);
        state.save(dir.path(), dir.path()).unwrap();
        drop(state);
        assert!(
            !pending.await.unwrap(),
            "the user save already persisted discovery"
        );
        let saved = PersistedState::load(dir.path(), dir.path());
        assert!(saved.nomad_nodes[0].favorited);
        assert_eq!(saved.rrc_hubs.len(), 1);

        announce(&mut *inner.write().await, "updated");
        assert!(flush(&inner, dir.path(), dir.path()).await.unwrap());
        assert!(PersistedState::load(dir.path(), dir.path()).nomad_nodes[0].favorited);
    }

    #[tokio::test]
    async fn failed_save_keeps_pending_updates_for_retry() {
        let dir = tempfile::tempdir().unwrap();
        let inner = Arc::new(RwLock::new(PersistedState::default_empty()));
        announce(&mut *inner.write().await, "pending");
        fs::create_dir(dir.path().join(STATE_FILE)).unwrap();
        assert!(flush(&inner, dir.path(), dir.path()).await.is_err());
        assert!(inner.read().await.discovery_dirty());
        {
            let mut state = inner.write().await;
            let snapshot = serde_json::to_value(&*state).unwrap();
            state.restore_after_failed_save(serde_json::from_value(snapshot).unwrap());
            assert!(state.discovery_dirty(), "rollback must preserve the retry");
        }
        fs::remove_dir(dir.path().join(STATE_FILE)).unwrap();
        assert!(flush(&inner, dir.path(), dir.path()).await.unwrap());
        assert!(!flush(&inner, dir.path(), dir.path()).await.unwrap());
        assert_eq!(
            PersistedState::load(dir.path(), dir.path())
                .nomad_nodes
                .len(),
            1
        );
    }
}

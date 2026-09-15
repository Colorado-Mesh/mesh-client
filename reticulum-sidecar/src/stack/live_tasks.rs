use std::future::Future;
use std::sync::Mutex;
use std::time::Duration;

use tokio::task::JoinSet;

/// Tasks owned by one live stack generation, never by the shared GATT process.
pub(super) struct LiveTasks {
    tasks: Mutex<Option<JoinSet<()>>>,
}

impl Default for LiveTasks {
    fn default() -> Self {
        Self {
            tasks: Mutex::new(Some(JoinSet::new())),
        }
    }
}

impl LiveTasks {
    pub fn spawn(&self, future: impl Future<Output = ()> + Send + 'static) {
        if let Some(tasks) = self
            .tasks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_mut()
        {
            tasks.spawn(future);
        }
    }

    pub async fn stop(&self) {
        let mut tasks = self.take();
        tasks.shutdown().await;
    }

    /// Allow a service's shutdown command to settle, then abort any stuck work.
    pub async fn finish(&self, budget: Duration) {
        let mut tasks = self.take();
        if tokio::time::timeout(budget, async { while tasks.join_next().await.is_some() {} })
            .await
            .is_err()
        {
            tracing::warn!("live task shutdown exceeded its budget; aborting remaining tasks");
            tasks.shutdown().await;
        }
    }

    fn take(&self) -> JoinSet<()> {
        self.tasks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    #[tokio::test]
    async fn stop_releases_old_generation_resources_before_returning() {
        let tasks = LiveTasks::default();
        let state = Arc::new(());
        let old_state = Arc::clone(&state);
        tasks.spawn(async move {
            std::future::pending::<()>().await;
            drop(old_state);
        });
        assert_eq!(Arc::strong_count(&state), 2);
        tasks.stop().await;
        assert_eq!(Arc::strong_count(&state), 1);
    }

    #[tokio::test]
    async fn stopped_generation_cannot_start_late_background_work() {
        let tasks = LiveTasks::default();
        tasks.stop().await;
        let state = Arc::new(());
        let old_state = Arc::clone(&state);
        tasks.spawn(async move {
            std::future::pending::<()>().await;
            drop(old_state);
        });
        assert_eq!(Arc::strong_count(&state), 1);
    }

    #[tokio::test]
    async fn failed_construction_drops_spawned_tasks() {
        let state = Arc::new(());
        {
            let tasks = LiveTasks::default();
            let old_state = Arc::clone(&state);
            tasks.spawn(async move {
                std::future::pending::<()>().await;
                drop(old_state);
            });
        }
        tokio::task::yield_now().await;
        assert_eq!(Arc::strong_count(&state), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn graceful_shutdown_has_a_deadline() {
        let tasks = LiveTasks::default();
        let state = Arc::new(());
        let old_state = Arc::clone(&state);
        tasks.spawn(async move {
            std::future::pending::<()>().await;
            drop(old_state);
        });
        tasks.finish(Duration::from_secs(1)).await;
        assert_eq!(Arc::strong_count(&state), 1);
    }
}

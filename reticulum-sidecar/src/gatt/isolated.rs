//! Drive btleplug on a dedicated Tokio runtime so a blocking OS Bluetooth call
//! (WinRT pairing/bond checks have been seen to stall a worker thread) cannot
//! starve the sidecar HTTP runtime or outlive the caller's deadline.
//!
//! Each call is spawned onto the BLE runtime; the caller awaits the join handle
//! under its own timeout on the main runtime, which keeps firing even when the
//! BLE runtime's threads are blocked. A call that overruns its budget latches
//! the executor as stuck until it finishes, so new connects/scans fail fast
//! instead of queueing behind the wedged adapter.

use std::future::Future;
use std::sync::Arc;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use tokio::runtime::{Handle, Runtime};

use super::error::{GattError, GattErrorCode};

const BLE_RUNTIME_WORKERS: usize = 2;

static BLE_RUNTIME: OnceLock<Result<Runtime, String>> = OnceLock::new();

/// Process-wide BLE runtime. Stored in a static so it is never dropped inside an
/// async context (dropping a `Runtime` there panics).
pub fn ble_runtime_handle() -> Result<Handle, GattError> {
    BLE_RUNTIME
        .get_or_init(|| {
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(BLE_RUNTIME_WORKERS)
                .thread_name("gatt-ble")
                .enable_all()
                .build()
                .map_err(|e| e.to_string())
        })
        .as_ref()
        .map(|rt| rt.handle().clone())
        .map_err(|e| {
            GattError::new(
                GattErrorCode::AdapterMissing,
                format!("BLE runtime unavailable: {e}"),
            )
        })
}

#[derive(Default)]
pub struct IsolatedExecutor {
    stuck: Arc<AtomicUsize>,
}

impl IsolatedExecutor {
    pub fn stuck_count(&self) -> usize {
        self.stuck.load(Ordering::SeqCst)
    }

    /// Fail fast while an earlier call is still wedged on the BLE runtime.
    pub fn ensure_responsive(&self, op: &str, code: GattErrorCode) -> Result<(), GattError> {
        let stuck = self.stuck_count();
        if stuck == 0 {
            return Ok(());
        }
        Err(GattError::new(
            code,
            format!(
                "{op} refused: Bluetooth stack unresponsive ({stuck} earlier call(s) still stuck)"
            ),
        ))
    }

    /// Run `fut` on `handle`, bounded by `budget` measured on the caller's runtime.
    /// `on_late` receives the value if the call succeeds after the budget expired
    /// (e.g. to tear down a connection nobody is waiting for anymore).
    pub async fn run<T, F, L>(
        &self,
        handle: &Handle,
        op: &'static str,
        budget: Duration,
        timeout_code: GattErrorCode,
        fut: F,
        on_late: L,
    ) -> Result<T, GattError>
    where
        T: Send + 'static,
        F: Future<Output = Result<T, GattError>> + Send + 'static,
        L: FnOnce(T) + Send + 'static,
    {
        let mut join = handle.spawn(fut);
        match tokio::time::timeout(budget, &mut join).await {
            Ok(Ok(result)) => result,
            Ok(Err(e)) => Err(GattError::new(
                GattErrorCode::Internal,
                format!("gatt {op} task failed: {e}"),
            )),
            Err(_) => {
                let budget_ms = u64::try_from(budget.as_millis()).unwrap_or(u64::MAX);
                self.stuck.fetch_add(1, Ordering::SeqCst);
                tracing::warn!(
                    target: "gatt",
                    op,
                    budget_ms,
                    "gatt: backend call exceeded budget — Bluetooth stack unresponsive"
                );
                let stuck = Arc::clone(&self.stuck);
                tokio::spawn(async move {
                    let late = join.await;
                    stuck.fetch_sub(1, Ordering::SeqCst);
                    tracing::warn!(target: "gatt", op, "gatt: stuck backend call finished late");
                    if let Ok(Ok(value)) = late {
                        on_late(value);
                    }
                });
                Err(GattError::new(
                    timeout_code,
                    format!("{op} timed out: Bluetooth stack unresponsive"),
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;
    use std::time::Instant;

    use super::*;

    fn test_runtime() -> Runtime {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .expect("test BLE runtime")
    }

    /// Caller runtime is single-threaded: if the blocking call ran on it, neither the
    /// timeout nor the concurrent "status" task could make progress.
    #[tokio::test(flavor = "current_thread")]
    async fn blocking_connect_times_out_and_caller_stays_responsive() {
        let rt = test_runtime();
        let exec = IsolatedExecutor::default();
        let started = Instant::now();

        let status = tokio::spawn(async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            "ok"
        });
        let result: Result<(), GattError> = exec
            .run(
                rt.handle(),
                "connect",
                Duration::from_millis(150),
                GattErrorCode::ConnectTimeout,
                async {
                    std::thread::sleep(Duration::from_millis(1500));
                    Ok(())
                },
                |()| {},
            )
            .await;

        let err = result.expect_err("blocked connect must time out");
        assert_eq!(err.code, GattErrorCode::ConnectTimeout);
        assert!(started.elapsed() < Duration::from_millis(1000));
        assert_eq!(status.await.expect("status task"), "ok");
        assert_eq!(exec.stuck_count(), 1);
        let refused = exec
            .ensure_responsive("connect", GattErrorCode::ConnectTimeout)
            .expect_err("stuck executor must refuse new connects");
        assert_eq!(refused.code, GattErrorCode::ConnectTimeout);

        rt.shutdown_background();
    }

    #[tokio::test(flavor = "current_thread")]
    async fn late_success_clears_stuck_and_hands_value_to_on_late() {
        let rt = test_runtime();
        let exec = IsolatedExecutor::default();
        let late_seen = Arc::new(AtomicBool::new(false));
        let late_flag = Arc::clone(&late_seen);

        let result = exec
            .run(
                rt.handle(),
                "connect",
                Duration::from_millis(50),
                GattErrorCode::ConnectTimeout,
                async {
                    std::thread::sleep(Duration::from_millis(200));
                    Ok(7u8)
                },
                move |v| {
                    assert_eq!(v, 7);
                    late_flag.store(true, Ordering::SeqCst);
                },
            )
            .await;
        assert!(result.is_err());

        let deadline = Instant::now() + Duration::from_secs(3);
        while exec.stuck_count() != 0 && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(exec.stuck_count(), 0);
        assert!(late_seen.load(Ordering::SeqCst));
        assert!(
            exec.ensure_responsive("connect", GattErrorCode::ConnectTimeout)
                .is_ok()
        );

        rt.shutdown_background();
    }

    #[tokio::test(flavor = "current_thread")]
    async fn fast_result_passes_through() {
        let rt = test_runtime();
        let exec = IsolatedExecutor::default();
        let ok = exec
            .run(
                rt.handle(),
                "rssi",
                Duration::from_secs(1),
                GattErrorCode::Internal,
                async { Ok(-60i16) },
                |_| {},
            )
            .await;
        assert_eq!(ok.expect("rssi"), -60);

        let err = exec
            .run(
                rt.handle(),
                "write",
                Duration::from_secs(1),
                GattErrorCode::Internal,
                async { Err::<(), _>(GattError::new(GattErrorCode::WriteFailed, "nope")) },
                |()| {},
            )
            .await
            .expect_err("backend error passes through");
        assert_eq!(err.code, GattErrorCode::WriteFailed);
        assert_eq!(exec.stuck_count(), 0);

        rt.shutdown_background();
    }
}

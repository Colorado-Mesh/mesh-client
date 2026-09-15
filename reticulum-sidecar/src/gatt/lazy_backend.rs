//! Retry adapter discovery after a missing-adapter failure without replacing live sessions.

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{OnceCell, mpsc};

use super::backend::{BackendConnId, BackendEvent, BleBackend, ScannedDevice};
use super::btleplug_backend::BtleplugBackend;
use super::error::{GattError, GattErrorCode};
use super::profile::GattProfile;

#[derive(Default)]
pub struct LazyBtleplugBackend {
    backend: OnceCell<Arc<BtleplugBackend>>,
}

// Only successful discovery is cached. OnceCell also serializes concurrent first probes.
async fn get_or_probe<B, P, F>(backend: &OnceCell<Arc<B>>, probe: P) -> Result<&Arc<B>, GattError>
where
    P: FnOnce() -> F,
    F: Future<Output = Result<B, GattError>>,
{
    // Include time waiting behind another initial probe in this caller's budget.
    tokio::time::timeout(
        Duration::from_secs(3),
        backend.get_or_try_init(|| async { probe().await.map(Arc::new) }),
    )
    .await
    .map_err(|_| {
        GattError::new(
            GattErrorCode::AdapterMissing,
            "Bluetooth adapter discovery timed out",
        )
    })?
}

impl LazyBtleplugBackend {
    pub const fn new() -> Self {
        Self {
            backend: OnceCell::const_new(),
        }
    }

    async fn backend(&self) -> Result<&Arc<BtleplugBackend>, GattError> {
        get_or_probe(&self.backend, || async {
            let backend = BtleplugBackend::try_new().await?;
            tracing::info!("gatt: using btleplug backend");
            Ok(backend)
        })
        .await
    }
}

impl BleBackend for LazyBtleplugBackend {
    async fn adapter_available(&self) -> Result<(), GattError> {
        self.backend().await?.adapter_available().await
    }

    async fn scan(
        &self,
        profile: GattProfile,
        timeout_secs: u64,
    ) -> Result<Vec<ScannedDevice>, GattError> {
        self.backend().await?.scan(profile, timeout_secs).await
    }

    async fn connect(
        &self,
        profile: GattProfile,
        address: &str,
    ) -> Result<
        (
            BackendConnId,
            mpsc::UnboundedReceiver<BackendEvent>,
            Option<u16>,
        ),
        GattError,
    > {
        self.backend().await?.connect(profile, address).await
    }

    async fn write(&self, conn: &BackendConnId, payload: &[u8]) -> Result<(), GattError> {
        self.backend().await?.write(conn, payload).await
    }

    async fn disconnect(&self, conn: &BackendConnId) -> Result<(), GattError> {
        self.backend().await?.disconnect(conn).await
    }

    async fn rssi(&self, conn: &BackendConnId) -> Result<i16, GattError> {
        self.backend().await?.rssi(conn).await
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use crate::gatt::fake::FakeBleBackend;

    #[tokio::test]
    async fn failed_probe_retries_then_keeps_the_backend_and_its_session() {
        let backend = OnceCell::new();
        let attempts = AtomicUsize::new(0);
        let missing = get_or_probe::<FakeBleBackend, _, _>(&backend, || async {
            attempts.fetch_add(1, Ordering::Relaxed);
            Err(GattError::new(
                GattErrorCode::AdapterMissing,
                "adapter unplugged",
            ))
        })
        .await;
        assert!(matches!(missing, Err(ref err) if err.code == GattErrorCode::AdapterMissing));
        assert!(backend.get().is_none());

        let connected = get_or_probe(&backend, || async {
            attempts.fetch_add(1, Ordering::Relaxed);
            Ok(FakeBleBackend::new())
        })
        .await
        .unwrap();
        let (conn, _events, _) = connected
            .connect(GattProfile::Meshcore, "aa:bb:cc:dd:ee:ff")
            .await
            .unwrap();

        let reused = get_or_probe(&backend, || async {
            attempts.fetch_add(1, Ordering::Relaxed);
            Err(GattError::new(
                GattErrorCode::AdapterMissing,
                "must not re-probe",
            ))
        })
        .await
        .unwrap();
        assert!(Arc::ptr_eq(connected, reused));
        reused.write(&conn, &[1, 2, 3]).await.unwrap();
        assert_eq!(connected.writes_for(&conn.0).await, vec![vec![1, 2, 3]]);
        assert_eq!(attempts.load(Ordering::Relaxed), 2);
    }

    #[tokio::test]
    async fn concurrent_first_operations_share_one_successful_probe() {
        let backend = OnceCell::new();
        let attempts = AtomicUsize::new(0);
        let probe = || async {
            attempts.fetch_add(1, Ordering::Relaxed);
            tokio::task::yield_now().await;
            Ok(FakeBleBackend::new())
        };
        let (first, second) =
            tokio::join!(get_or_probe(&backend, probe), get_or_probe(&backend, probe),);
        assert!(Arc::ptr_eq(first.unwrap(), second.unwrap()));
        assert_eq!(attempts.load(Ordering::Relaxed), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn timed_out_probe_can_retry_without_exceeding_the_connect_budget() {
        let backend = OnceCell::new();
        let start = tokio::time::Instant::now();
        let error = get_or_probe::<FakeBleBackend, _, _>(&backend, std::future::pending)
            .await
            .err()
            .expect("probe must time out");
        assert_eq!(error.code, GattErrorCode::AdapterMissing);
        assert_eq!(start.elapsed(), Duration::from_secs(3));
        assert!(backend.get().is_none());
        assert!(
            get_or_probe(&backend, || async { Ok(FakeBleBackend::new()) })
                .await
                .is_ok()
        );
    }
}

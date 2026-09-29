//! Retry adapter discovery after a missing-adapter failure without replacing live sessions.
//!
//! The cached backend can be disposed (bond-recovery) so CoreBluetooth's central is dropped
//! while an RNode reconnect owns the adapter exclusively. A hold bit blocks recreation via
//! `/api/v1/ble/availability` (and any other probe) until recovery clears.
//!
//! Every btleplug call runs on the dedicated BLE runtime (`isolated.rs`) with a caller-side
//! budget, so a wedged OS Bluetooth call cannot stall the sidecar HTTP server.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tokio::sync::{Mutex, mpsc};

use super::backend::{BackendConnId, BackendEvent, BleBackend, ScannedDevice};
use super::btleplug_backend::BtleplugBackend;
use super::error::{GattError, GattErrorCode};
use super::isolated::{IsolatedExecutor, ble_runtime_handle};
use super::profile::GattProfile;

const ADAPTER_INIT_BUDGET: Duration = Duration::from_secs(3);
const ADAPTER_STATE_BUDGET: Duration = Duration::from_secs(5);
/// Scan sleep plus bounded pre/post `stop_scan` and peripheral enumeration.
const SCAN_OVERHEAD_BUDGET: Duration = Duration::from_secs(15);
/// Backend connect deadline is 35s plus a bounded 5s cleanup; stays under the proxy's 45s.
const CONNECT_BUDGET: Duration = Duration::from_secs(41);
const WRITE_BUDGET: Duration = Duration::from_secs(10);
/// Backend disconnect is bounded at 5s internally.
const DISCONNECT_BUDGET: Duration = Duration::from_secs(8);
const RSSI_BUDGET: Duration = Duration::from_secs(5);

#[derive(Default)]
pub struct LazyBtleplugBackend {
    backend: Mutex<Option<Arc<BtleplugBackend>>>,
    /// When true, refuse to construct a new CBCentralManager (RNode bond recovery).
    bond_recovery_hold: AtomicBool,
    executor: IsolatedExecutor,
}

impl LazyBtleplugBackend {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_bond_recovery_hold(&self, hold: bool) {
        self.bond_recovery_hold.store(hold, Ordering::SeqCst);
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn bond_recovery_hold(&self) -> bool {
        self.bond_recovery_hold.load(Ordering::SeqCst)
    }

    /// Drop the cached btleplug central (if any). Call only after all GATT sessions are gone.
    pub async fn dispose_adapter(&self) {
        self.bond_recovery_hold.store(true, Ordering::SeqCst);
        let mut guard = self.backend.lock().await;
        let had = guard.take().is_some();
        if had {
            tracing::warn!("gatt: disposed btleplug central (RNode bond recovery)");
        }
    }

    async fn backend(&self) -> Result<Arc<BtleplugBackend>, GattError> {
        // Include time waiting behind another initial probe in this caller's budget.
        tokio::time::timeout(ADAPTER_INIT_BUDGET, async {
            let mut guard = self.backend.lock().await;
            if let Some(existing) = guard.as_ref() {
                return Ok(existing.clone());
            }
            if self.bond_recovery_hold.load(Ordering::SeqCst) {
                return Err(GattError::new(
                    GattErrorCode::ScanBusy,
                    "RNode bond recovery holds the LoRa GATT adapter",
                ));
            }
            let handle = ble_runtime_handle()?;
            let created = Arc::new(
                self.executor
                    .run(
                        &handle,
                        "adapter_init",
                        ADAPTER_INIT_BUDGET,
                        GattErrorCode::AdapterMissing,
                        BtleplugBackend::try_new(),
                        |_| {},
                    )
                    .await?,
            );
            tracing::info!("gatt: using btleplug backend");
            *guard = Some(created.clone());
            Ok(created)
        })
        .await
        .map_err(|_| {
            GattError::new(
                GattErrorCode::AdapterMissing,
                "Bluetooth adapter discovery timed out",
            )
        })?
    }
}

impl BleBackend for LazyBtleplugBackend {
    async fn adapter_available(&self) -> Result<(), GattError> {
        let backend = self.backend().await?;
        let handle = ble_runtime_handle()?;
        self.executor
            .run(
                &handle,
                "adapter_state",
                ADAPTER_STATE_BUDGET,
                GattErrorCode::AdapterMissing,
                async move { backend.adapter_available().await },
                |()| {},
            )
            .await
    }

    async fn scan(
        &self,
        profile: GattProfile,
        timeout_secs: u64,
    ) -> Result<Vec<ScannedDevice>, GattError> {
        self.executor
            .ensure_responsive("scan", GattErrorCode::AdapterMissing)?;
        let backend = self.backend().await?;
        let handle = ble_runtime_handle()?;
        self.executor
            .run(
                &handle,
                "scan",
                Duration::from_secs(timeout_secs.max(1)) + SCAN_OVERHEAD_BUDGET,
                GattErrorCode::AdapterMissing,
                async move { backend.scan(profile, timeout_secs).await },
                |_| {},
            )
            .await
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
        self.executor
            .ensure_responsive("connect", GattErrorCode::ConnectTimeout)?;
        let backend = self.backend().await?;
        let handle = ble_runtime_handle()?;
        let address = address.to_string();
        let connect_backend = Arc::clone(&backend);
        let late_handle = handle.clone();
        self.executor
            .run(
                &handle,
                "connect",
                CONNECT_BUDGET,
                GattErrorCode::ConnectTimeout,
                async move { connect_backend.connect(profile, &address).await },
                move |(conn, _events, _mtu)| {
                    // Nobody owns this session anymore; close it so the peripheral is free.
                    late_handle.spawn(async move {
                        if let Err(e) = backend.disconnect(&conn).await {
                            tracing::warn!(target: "gatt", "gatt: late connect cleanup failed: {e}");
                        }
                    });
                },
            )
            .await
    }

    async fn write(&self, conn: &BackendConnId, payload: &[u8]) -> Result<(), GattError> {
        let backend = self.backend().await?;
        let handle = ble_runtime_handle()?;
        let conn = conn.clone();
        let payload = payload.to_vec();
        self.executor
            .run(
                &handle,
                "write",
                WRITE_BUDGET,
                GattErrorCode::WriteFailed,
                async move { backend.write(&conn, &payload).await },
                |()| {},
            )
            .await
    }

    async fn disconnect(&self, conn: &BackendConnId) -> Result<(), GattError> {
        let backend = self.backend().await?;
        let handle = ble_runtime_handle()?;
        let conn = conn.clone();
        self.executor
            .run(
                &handle,
                "disconnect",
                DISCONNECT_BUDGET,
                GattErrorCode::Internal,
                async move { backend.disconnect(&conn).await },
                |()| {},
            )
            .await
    }

    async fn rssi(&self, conn: &BackendConnId) -> Result<i16, GattError> {
        let backend = self.backend().await?;
        let handle = ble_runtime_handle()?;
        let conn = conn.clone();
        self.executor
            .run(
                &handle,
                "rssi",
                RSSI_BUDGET,
                GattErrorCode::Internal,
                async move { backend.rssi(&conn).await },
                |_| {},
            )
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn dispose_sets_hold_and_clear_releases() {
        let lazy = LazyBtleplugBackend::new();
        assert!(!lazy.bond_recovery_hold());
        lazy.dispose_adapter().await;
        assert!(lazy.bond_recovery_hold());
        lazy.set_bond_recovery_hold(false);
        assert!(!lazy.bond_recovery_hold());
    }

    #[tokio::test]
    async fn backend_refuses_create_while_hold() {
        let lazy = LazyBtleplugBackend::new();
        lazy.set_bond_recovery_hold(true);
        let Err(err) = lazy.backend().await else {
            panic!("must refuse create while bond recovery hold is set");
        };
        assert_eq!(err.code, GattErrorCode::ScanBusy);
    }
}

//! Retry adapter discovery after a missing-adapter failure without replacing live sessions.
//!
//! The cached backend can be disposed (bond-recovery) so CoreBluetooth's central is dropped
//! while an RNode reconnect owns the adapter exclusively. A hold bit blocks recreation via
//! `/api/v1/ble/availability` (and any other probe) until recovery clears.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tokio::sync::{Mutex, mpsc};

use super::backend::{BackendConnId, BackendEvent, BleBackend, ScannedDevice};
use super::btleplug_backend::BtleplugBackend;
use super::error::{GattError, GattErrorCode};
use super::profile::GattProfile;

#[derive(Default)]
pub struct LazyBtleplugBackend {
    backend: Mutex<Option<Arc<BtleplugBackend>>>,
    /// When true, refuse to construct a new CBCentralManager (RNode bond recovery).
    bond_recovery_hold: AtomicBool,
}

impl LazyBtleplugBackend {
    pub const fn new() -> Self {
        Self {
            backend: Mutex::const_new(None),
            bond_recovery_hold: AtomicBool::new(false),
        }
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
        tokio::time::timeout(Duration::from_secs(3), async {
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
            let created = Arc::new(BtleplugBackend::try_new().await?);
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

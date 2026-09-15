//! In-memory BLE backend for unit tests (no hardware).

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{Mutex, mpsc};

use super::backend::{BackendConnId, BackendEvent, BleBackend, ScannedDevice};
use super::error::{GattError, GattErrorCode};
use super::profile::{GattProfile, normalize_address};

#[derive(Default)]
struct FakeState {
    devices: Vec<ScannedDevice>,
    /// address → open event sender
    open: HashMap<String, mpsc::UnboundedSender<BackendEvent>>,
    /// Force next connect/scan to fail with this code.
    fail_code: Option<GattErrorCode>,
    adapter_ok: bool,
    /// Inbound queue for read_from_radio (Meshtastic pump).
    from_radio: HashMap<String, Vec<Vec<u8>>>,
    /// Captured writes per address.
    writes: HashMap<String, Vec<Vec<u8>>>,
    mtu: u16,
}

/// Test double implementing [`BleBackend`].
pub struct FakeBleBackend {
    inner: Arc<Mutex<FakeState>>,
}

impl FakeBleBackend {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(FakeState {
                adapter_ok: true,
                mtu: 23,
                ..FakeState::default()
            })),
        }
    }

    #[cfg(test)]
    pub async fn set_adapter_ok(&self, ok: bool) {
        self.inner.lock().await.adapter_ok = ok;
    }

    #[cfg(test)]
    pub async fn add_device(&self, device: ScannedDevice) {
        self.inner.lock().await.devices.push(device);
    }

    #[cfg(test)]
    pub async fn writes_for(&self, address: &str) -> Vec<Vec<u8>> {
        let key = normalize_address(address).unwrap_or_else(|_| address.to_string());
        self.inner
            .lock()
            .await
            .writes
            .get(&key)
            .cloned()
            .unwrap_or_default()
    }
}

impl Default for FakeBleBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl BleBackend for FakeBleBackend {
    async fn adapter_available(&self) -> Result<(), GattError> {
        let guard = self.inner.lock().await;
        if let Some(code) = guard.fail_code {
            return Err(GattError::new(code, "forced failure"));
        }
        if guard.adapter_ok {
            Ok(())
        } else {
            Err(GattError::new(
                GattErrorCode::AdapterMissing,
                "no bluetooth adapter",
            ))
        }
    }

    async fn scan(
        &self,
        profile: GattProfile,
        _timeout_secs: u64,
    ) -> Result<Vec<ScannedDevice>, GattError> {
        let guard = self.inner.lock().await;
        if let Some(code) = guard.fail_code {
            return Err(GattError::new(code, "forced scan failure"));
        }
        let needle = match profile {
            GattProfile::Meshtastic => "6ba1b218",
            GattProfile::Meshcore | GattProfile::Rnode => "6e400001",
            GattProfile::Peer => "",
        };
        Ok(guard
            .devices
            .iter()
            .filter(|d| {
                if needle.is_empty() {
                    true
                } else {
                    d.service_uuids
                        .iter()
                        .any(|u| u.to_ascii_lowercase().contains(needle))
                }
            })
            .cloned()
            .collect())
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
        let key = normalize_address(address)?;
        let mut guard = self.inner.lock().await;
        if let Some(code) = guard.fail_code {
            return Err(GattError::new(code, "forced connect failure"));
        }
        if !guard.adapter_ok {
            return Err(GattError::new(
                GattErrorCode::AdapterMissing,
                "no bluetooth adapter",
            ));
        }
        let _ = profile;
        let (tx, rx) = mpsc::unbounded_channel();
        guard.open.insert(key.clone(), tx);
        let mtu = guard.mtu;
        Ok((BackendConnId(key), rx, Some(mtu)))
    }

    async fn write(&self, conn: &BackendConnId, payload: &[u8]) -> Result<(), GattError> {
        let mut guard = self.inner.lock().await;
        if let Some(code) = guard.fail_code {
            return Err(GattError::new(code, "forced write failure"));
        }
        if !guard.open.contains_key(&conn.0) {
            return Err(GattError::new(
                GattErrorCode::SessionNotFound,
                "not connected",
            ));
        }
        guard
            .writes
            .entry(conn.0.clone())
            .or_default()
            .push(payload.to_vec());
        Ok(())
    }

    async fn read_from_radio(&self, conn: &BackendConnId) -> Result<Vec<u8>, GattError> {
        let mut guard = self.inner.lock().await;
        let queue = guard.from_radio.entry(conn.0.clone()).or_default();
        if queue.is_empty() {
            Ok(Vec::new())
        } else {
            Ok(queue.remove(0))
        }
    }

    async fn disconnect(&self, conn: &BackendConnId) -> Result<(), GattError> {
        let mut guard = self.inner.lock().await;
        if let Some(tx) = guard.open.remove(&conn.0) {
            let _ = tx.send(BackendEvent::Disconnected {
                reason: "local_disconnect".into(),
            });
        }
        Ok(())
    }

    async fn rssi(&self, conn: &BackendConnId) -> Result<i16, GattError> {
        let guard = self.inner.lock().await;
        if guard.open.contains_key(&conn.0) {
            Ok(-55)
        } else {
            Err(GattError::new(
                GattErrorCode::SessionNotFound,
                "not connected",
            ))
        }
    }
}

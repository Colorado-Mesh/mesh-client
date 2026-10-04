//! Windows GATT session keep-alive for btleplug connections.
//!
//! btleplug never opens a `GattSession`, so Windows may idle the link down between
//! operations (writes reconnect on demand, notifications and reads go quiet).
//! Chromium Web Bluetooth holds a session with `MaintainConnection = true`; do the same.

use windows::Devices::Bluetooth::BluetoothLEDevice;
use windows::Devices::Bluetooth::GenericAttributeProfile::GattSession;

/// Held for the lifetime of an open connection; dropping it releases the session.
pub struct GattKeepAlive {
    session: GattSession,
    _device: BluetoothLEDevice,
}

impl GattKeepAlive {
    /// Best effort: returns `None` (after logging) when the session cannot be opened.
    pub async fn open(address: u64) -> Option<Self> {
        match tokio::task::spawn_blocking(move || Self::open_blocking(address)).await {
            Ok(Ok(keep_alive)) => {
                tracing::info!(target: "gatt", "gatt: windows GattSession MaintainConnection enabled");
                Some(keep_alive)
            }
            Ok(Err(e)) => {
                tracing::warn!(target: "gatt", "gatt: windows GattSession keep-alive unavailable: {e}");
                None
            }
            Err(e) => {
                tracing::warn!(target: "gatt", "gatt: windows GattSession keep-alive task failed: {e}");
                None
            }
        }
    }

    fn open_blocking(address: u64) -> windows::core::Result<Self> {
        let device = BluetoothLEDevice::FromBluetoothAddressAsync(address)?.get()?;
        let device_id = device.BluetoothDeviceId()?;
        let session = GattSession::FromDeviceIdAsync(&device_id)?.get()?;
        session.SetMaintainConnection(true)?;
        Ok(Self {
            session,
            _device: device,
        })
    }
}

impl Drop for GattKeepAlive {
    fn drop(&mut self) {
        if let Err(e) = self.session.SetMaintainConnection(false) {
            tracing::debug!(target: "gatt", "gatt: windows GattSession release failed: {e}");
        }
        if let Err(e) = self.session.Close() {
            tracing::debug!(target: "gatt", "gatt: windows GattSession close failed: {e}");
        }
    }
}

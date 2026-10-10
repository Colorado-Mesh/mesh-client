//! App-wide BLE GATT session host (Meshtastic / MeshCore pipes + MAC registry).
//!
//! Owns the LoRa btleplug central within the helper process; Electron coordinates configured
//! addresses.

mod att;
mod backend;
mod error;
mod events;
mod fake;
mod manager;
mod profile;
mod registry;
pub mod windows_pairing;

#[cfg(feature = "gatt-ble")]
mod btleplug_backend;
#[cfg(feature = "gatt-ble")]
mod isolated;
#[cfg(feature = "gatt-ble")]
mod lazy_backend;
#[cfg(all(feature = "gatt-ble", target_os = "windows"))]
mod windows_gatt_session;

pub use events::GattSessionEvent;
pub use manager::{GattBackend, GattManager};
pub use profile::GattProfile;

#[cfg(feature = "gatt-ble")]
pub use lazy_backend::LazyBtleplugBackend;

/// Construct the process-wide GATT manager.
#[allow(clippy::unused_async)] // async to keep the bootstrap call site uniform
pub async fn create_gatt_manager() -> std::sync::Arc<GattManager> {
    #[cfg(feature = "gatt-ble")]
    {
        GattManager::new(GattBackend::Btleplug(std::sync::Arc::new(
            LazyBtleplugBackend::new(),
        )))
    }
    #[cfg(not(feature = "gatt-ble"))]
    {
        tracing::info!("gatt: feature gatt-ble disabled");
        GattManager::new(GattBackend::disabled())
    }
}

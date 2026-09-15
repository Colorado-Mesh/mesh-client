//! App-wide BLE GATT session host (Meshtastic / MeshCore pipes + MAC registry).
//!
//! Owns the LoRa btleplug central within the shared sidecar process.
//! RNode/Peer stacks use separate rsReticulum centrals; Electron coordinates configured addresses.

mod att;
mod backend;
mod error;
mod events;
mod fake;
mod manager;
mod profile;
mod registry;

#[cfg(feature = "gatt-ble")]
mod btleplug_backend;
#[cfg(feature = "gatt-ble")]
mod lazy_backend;

pub use events::GattSessionEvent;
pub use manager::{GattBackend, GattManager};
pub use profile::GattProfile;

#[cfg(feature = "gatt-ble")]
pub use lazy_backend::LazyBtleplugBackend;

/// Construct the process-wide GATT manager.
#[allow(clippy::unused_async)] // matches the async stack bootstrap API
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

//! App-wide BLE GATT session host (Meshtastic / MeshCore pipes + MAC registry).
//!
//! Lives in the reticulum-sidecar process so one btleplug central owns the adapter.
//! RNode/Peer protocol stacks remain in rsReticulum; they register MACs via the registry.

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

pub use events::GattSessionEvent;
pub use manager::{GattBackend, GattManager};
pub use profile::GattProfile;

#[cfg(feature = "gatt-ble")]
pub use btleplug_backend::BtleplugBackend;

/// Construct the process-wide GATT manager.
pub async fn create_gatt_manager() -> std::sync::Arc<GattManager> {
    #[cfg(feature = "gatt-ble")]
    {
        match BtleplugBackend::try_new().await {
            Ok(backend) => {
                tracing::info!("gatt: using btleplug backend");
                return GattManager::new(GattBackend::Btleplug(std::sync::Arc::new(backend)));
            }
            Err(e) => {
                tracing::warn!(
                    "gatt: btleplug unavailable ({e}); falling back to disabled backend"
                );
            }
        }
    }
    #[cfg(not(feature = "gatt-ble"))]
    {
        tracing::info!("gatt: feature gatt-ble disabled; using fake/disabled backend");
    }
    // Stub / failed probe: production without feature reports feature_disabled on connect.
    GattManager::new(GattBackend::disabled())
}

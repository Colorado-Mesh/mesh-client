//! BLE LTK / bond helpers for the reticulum sidecar (mesh-client owned).

pub mod error_classifier;
pub mod unbond;

#[allow(unused_imports)] // public API for callers / future GATT paths
pub use error_classifier::{BleFailureClass, classify_ble_error};
#[allow(unused_imports)] // public API for callers / future GATT paths
pub use unbond::{
    BleBondError, LtkDesyncHandleResult, handle_ltk_desync_named, unbond_device_named,
};

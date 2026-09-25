//! BLE central backend trait — real btleplug or in-memory fake for tests.

use tokio::sync::mpsc;

use super::error::GattError;
use super::profile::GattProfile;

#[derive(Debug, Clone)]
pub struct ScannedDevice {
    pub address: String,
    pub name: Option<String>,
    pub rssi: Option<i16>,
    pub service_uuids: Vec<String>,
}

#[derive(Debug, Clone)]
pub enum BackendEvent {
    /// Inbound GATT bytes (fromRadio / NUS TX notify).
    Bytes(Vec<u8>),
    Disconnected {
        reason: String,
    },
    /// Reserved for link-quality events from the central (not yet emitted on all OS backends).
    #[allow(dead_code)]
    Mtu(u16),
    #[allow(dead_code)]
    Rssi(i16),
}

/// Opaque handle for an open backend connection.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct BackendConnId(pub String);

pub trait BleBackend: Send + Sync {
    fn adapter_available(&self) -> impl std::future::Future<Output = Result<(), GattError>> + Send;

    fn scan(
        &self,
        profile: GattProfile,
        timeout_secs: u64,
    ) -> impl std::future::Future<Output = Result<Vec<ScannedDevice>, GattError>> + Send;

    /// Connect + discover + subscribe. Returns connection id, event channel, and optional MTU.
    fn connect(
        &self,
        profile: GattProfile,
        address: &str,
    ) -> impl std::future::Future<
        Output = Result<
            (
                BackendConnId,
                mpsc::UnboundedReceiver<BackendEvent>,
                Option<u16>,
            ),
            GattError,
        >,
    > + Send;

    fn write(
        &self,
        conn: &BackendConnId,
        payload: &[u8],
    ) -> impl std::future::Future<Output = Result<(), GattError>> + Send;

    fn disconnect(
        &self,
        conn: &BackendConnId,
    ) -> impl std::future::Future<Output = Result<(), GattError>> + Send;

    fn rssi(
        &self,
        conn: &BackendConnId,
    ) -> impl std::future::Future<Output = Result<i16, GattError>> + Send;
}

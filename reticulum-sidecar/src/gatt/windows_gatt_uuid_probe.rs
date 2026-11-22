//! Windows WinRT UUID-targeted GATT probe (btleplug#325 workaround).
//!
//! After a fresh pair, btleplug's uncached characteristic discovery can time out and fall
//! back to an empty Cached attribute set (`write characteristic missing`). Calling
//! `GetGattServicesForUuidAsync` / `GetCharacteristicsForUuidAsync` (default/Cached first)
//! forces the OS GATT cache to populate so a subsequent btleplug `discover_services()` can
//! see Nordic UART / Meshtastic characteristics. Subscribe and writes still use btleplug.

use std::time::Duration;

use uuid::Uuid;
use windows::Devices::Bluetooth::GenericAttributeProfile::{
    GattCommunicationStatus, GattDeviceServicesResult,
};
use windows::Devices::Bluetooth::{BluetoothCacheMode, BluetoothLEDevice};
use windows::core::GUID;

use super::error::{GattError, GattErrorCode};
use super::profile::{self, GattProfile};

/// Hard cap for the whole probe (spawn_blocking + WinRT `.get()`).
pub const UUID_PROBE_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Clone, Copy)]
pub struct UuidProbeRequest {
    pub address: u64,
    pub service: Uuid,
    pub write: Uuid,
    pub notify: Uuid,
    pub from_radio: Option<Uuid>,
}

impl UuidProbeRequest {
    pub fn for_profile(address: u64, profile: GattProfile) -> Result<Self, GattError> {
        match profile {
            GattProfile::Meshtastic => Ok(Self {
                address,
                service: profile::meshtastic::service(),
                write: profile::meshtastic::to_radio(),
                notify: profile::meshtastic::from_num(),
                from_radio: Some(profile::meshtastic::from_radio()),
            }),
            GattProfile::Meshcore | GattProfile::Rnode => Ok(Self {
                address,
                service: profile::nus::service(),
                write: profile::nus::rx(),
                notify: profile::nus::tx(),
                from_radio: None,
            }),
            GattProfile::Peer => Err(GattError::new(
                GattErrorCode::InvalidProfile,
                "peer profile has no gatt pipe",
            )),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UuidProbeOutcome {
    /// Service + required characteristics were found (cache should be warm).
    Found,
    /// WinRT answered but a required characteristic UUID was absent.
    Missing(&'static str),
    /// WinRT call failed or timed out (caller should keep the original discover error).
    Failed(String),
}

/// Best-effort UUID probe. Prefer Cached; one Uncached attempt if Cached misses.
pub async fn probe_profile_characteristics(req: UuidProbeRequest) -> UuidProbeOutcome {
    match tokio::time::timeout(
        UUID_PROBE_TIMEOUT,
        tokio::task::spawn_blocking(move || probe_blocking(req)),
    )
    .await
    {
        Ok(Ok(outcome)) => outcome,
        Ok(Err(e)) => UuidProbeOutcome::Failed(format!("uuid probe join: {e}")),
        Err(_) => UuidProbeOutcome::Failed("uuid probe timed out".into()),
    }
}

fn probe_blocking(req: UuidProbeRequest) -> UuidProbeOutcome {
    match probe_with_cache_mode(req, BluetoothCacheMode::Cached) {
        UuidProbeOutcome::Found => UuidProbeOutcome::Found,
        UuidProbeOutcome::Missing(label) => {
            tracing::info!(
                target: "gatt",
                missing = label,
                "gatt: windows UUID probe Cached miss — trying Uncached"
            );
            probe_with_cache_mode(req, BluetoothCacheMode::Uncached)
        }
        UuidProbeOutcome::Failed(msg) => {
            tracing::info!(
                target: "gatt",
                error = %msg,
                "gatt: windows UUID probe Cached failed — trying Uncached"
            );
            probe_with_cache_mode(req, BluetoothCacheMode::Uncached)
        }
    }
}

fn probe_with_cache_mode(req: UuidProbeRequest, mode: BluetoothCacheMode) -> UuidProbeOutcome {
    let device =
        match BluetoothLEDevice::FromBluetoothAddressAsync(req.address).and_then(|op| op.get()) {
            Ok(d) => d,
            Err(e) => return UuidProbeOutcome::Failed(format!("FromBluetoothAddressAsync: {e}")),
        };

    let services = match device
        .GetGattServicesForUuidWithCacheModeAsync(uuid_to_guid(req.service), mode)
        .and_then(|op| op.get())
    {
        Ok(r) => r,
        Err(e) => {
            let _ = device.Close();
            return UuidProbeOutcome::Failed(format!("GetGattServicesForUuid: {e}"));
        }
    };

    if let Err(status) = require_success(&services, "GetGattServicesForUuid") {
        let _ = device.Close();
        return status;
    }

    let service = match services
        .Services()
        .ok()
        .and_then(|list| list.into_iter().next())
    {
        Some(s) => s,
        None => {
            let _ = device.Close();
            return UuidProbeOutcome::Missing("service");
        }
    };

    for (uuid, label) in [(req.write, "write"), (req.notify, "notify")] {
        match characteristic_for_uuid(&service, uuid, mode) {
            Ok(true) => {}
            Ok(false) => {
                let _ = service.Close();
                let _ = device.Close();
                return UuidProbeOutcome::Missing(label);
            }
            Err(msg) => {
                let _ = service.Close();
                let _ = device.Close();
                return UuidProbeOutcome::Failed(msg);
            }
        }
    }

    if let Some(from_radio) = req.from_radio {
        match characteristic_for_uuid(&service, from_radio, mode) {
            Ok(true) => {}
            Ok(false) => {
                let _ = service.Close();
                let _ = device.Close();
                return UuidProbeOutcome::Missing("fromRadio");
            }
            Err(msg) => {
                let _ = service.Close();
                let _ = device.Close();
                return UuidProbeOutcome::Failed(msg);
            }
        }
    }

    let _ = service.Close();
    let _ = device.Close();
    UuidProbeOutcome::Found
}

fn characteristic_for_uuid(
    service: &windows::Devices::Bluetooth::GenericAttributeProfile::GattDeviceService,
    uuid: Uuid,
    mode: BluetoothCacheMode,
) -> Result<bool, String> {
    let result = service
        .GetCharacteristicsForUuidWithCacheModeAsync(uuid_to_guid(uuid), mode)
        .and_then(|op| op.get())
        .map_err(|e| format!("GetCharacteristicsForUuid: {e}"))?;
    let status = result
        .Status()
        .map_err(|e| format!("characteristic status: {e}"))?;
    if status != GattCommunicationStatus::Success {
        return Err(format!("characteristic status={status:?}"));
    }
    let chars = result
        .Characteristics()
        .map_err(|e| format!("characteristics list: {e}"))?;
    let count = chars
        .Size()
        .map_err(|e| format!("characteristics size: {e}"))?;
    Ok(count > 0)
}

fn require_success(result: &GattDeviceServicesResult, label: &str) -> Result<(), UuidProbeOutcome> {
    let status = result
        .Status()
        .map_err(|e| UuidProbeOutcome::Failed(format!("{label} status: {e}")))?;
    if status != GattCommunicationStatus::Success {
        return Err(UuidProbeOutcome::Failed(format!(
            "{label} status={status:?}"
        )));
    }
    Ok(())
}

fn uuid_to_guid(uuid: Uuid) -> GUID {
    GUID::from_u128(uuid.as_u128())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn meshcore_probe_request_uses_nus_uuids() {
        let req = UuidProbeRequest::for_profile(0x_e5_23_5d_d9_93_7c, GattProfile::Meshcore)
            .expect("meshcore");
        assert_eq!(req.service, profile::nus::service());
        assert_eq!(req.write, profile::nus::rx());
        assert_eq!(req.notify, profile::nus::tx());
        assert!(req.from_radio.is_none());
    }

    #[test]
    fn meshtastic_probe_request_includes_from_radio() {
        let req = UuidProbeRequest::for_profile(1, GattProfile::Meshtastic).expect("meshtastic");
        assert_eq!(req.service, profile::meshtastic::service());
        assert!(req.from_radio.is_some());
    }

    #[test]
    fn peer_profile_has_no_probe() {
        assert!(UuidProbeRequest::for_profile(1, GattProfile::Peer).is_err());
    }

    #[test]
    fn uuid_guid_round_trip_preserves_u128() {
        let u = profile::nus::service();
        assert_eq!(uuid_to_guid(u).to_u128(), u.as_u128());
    }
}

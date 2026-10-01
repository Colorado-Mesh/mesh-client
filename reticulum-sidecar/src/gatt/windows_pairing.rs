//! In-app BLE pairing for LoRa radios on Windows (WinRT custom pairing).
//!
//! Windows Settings pairing fails for some MeshCore radios (Wio L1 Pro: "connected"
//! for a second, never "Paired"), after which btleplug's connect can stall inside
//! WinRT. Chrome's Web Bluetooth pairs in-app via `DeviceInformationCustomPairing`
//! + `ProvidePin`; this module does the same with a PIN typed in mesh-client.
//!
//! Calls run on `spawn_blocking` (windows 0.58 `IAsyncOperation` needs `.get()`),
//! never on the isolated btleplug runtime, so a wedged connect cannot block repair.
//! Other platforms return `Unsupported`: Linux pairs via bluetoothctl in Electron
//! and macOS CoreBluetooth shows its own pairing dialog.

use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::sync::Semaphore;

use super::error::{GattError, GattErrorCode};

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
const PAIR_TIMEOUT: Duration = Duration::from_secs(60);
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
const STATE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct PairState {
    pub paired: bool,
}

/// 48-bit Bluetooth address from a MAC-style id (any punctuation), e.g. `ef:4f:4f:1c:23:73`.
pub fn ble_address_u64(id: &str) -> Option<u64> {
    let hex: String = id.chars().filter(char::is_ascii_hexdigit).collect();
    if hex.len() != 12 {
        return None;
    }
    u64::from_str_radix(&hex, 16).ok()
}

fn require_address(address: &str) -> Result<u64, GattError> {
    ble_address_u64(address).ok_or_else(|| {
        GattError::new(
            GattErrorCode::InvalidAddress,
            "in-app pairing needs a 12-digit Bluetooth MAC address",
        )
    })
}

/// MeshCore / Meshtastic pairing PINs are 4–6 digits.
pub fn validate_pin(pin: &str) -> Result<String, GattError> {
    let trimmed = pin.trim();
    if (4..=6).contains(&trimmed.len()) && trimmed.chars().all(|c| c.is_ascii_digit()) {
        return Ok(trimmed.to_string());
    }
    Err(GattError::new(
        GattErrorCode::InvalidAddress,
        "pairing PIN must be 4 to 6 digits",
    ))
}

/// `DevicePairingResultStatus` value → name (mirrors WinRT; kept platform-neutral for tests).
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
const fn pairing_status_name(code: i32) -> &'static str {
    match code {
        0 => "Paired",
        1 => "NotReadyToPair",
        2 => "NotPaired",
        3 => "AlreadyPaired",
        4 => "ConnectionRejected",
        5 => "TooManyConnections",
        6 => "HardwareFailure",
        7 => "AuthenticationTimeout",
        8 => "AuthenticationNotAllowed",
        9 => "AuthenticationFailure",
        10 => "NoSupportedProfiles",
        11 => "ProtectionLevelCouldNotBeMet",
        12 => "AccessDenied",
        13 => "InvalidCeremonyData",
        14 => "PairingCanceled",
        15 => "OperationAlreadyInProgress",
        16 => "RequiredHandlerNotRegistered",
        17 => "RejectedByHandler",
        18 => "RemoteDeviceHasAssociation",
        19 => "Failed",
        _ => "Unknown",
    }
}

/// `ProtectionLevelCouldNotBeMet`: retry at `Encryption` for radios without MITM pairing.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
const STATUS_PROTECTION_LEVEL_NOT_MET: i32 = 11;

/// Map a WinRT `DevicePairingResultStatus` to the GATT error taxonomy.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn map_pairing_status(code: i32) -> Result<(), GattError> {
    let name = pairing_status_name(code);
    match code {
        0 | 3 => Ok(()),
        7 | 8 | 9 | 17 => Err(GattError::new(
            GattErrorCode::AuthenticationFailed,
            format!("Windows rejected the pairing PIN (status={name})"),
        )),
        _ => Err(GattError::new(
            GattErrorCode::PairingRequired,
            format!("Windows pairing failed (status={name})"),
        )),
    }
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
async fn run_blocking<T, F>(op: &'static str, budget: Duration, f: F) -> Result<T, GattError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, GattError> + Send + 'static,
{
    match tokio::time::timeout(budget, tokio::task::spawn_blocking(f)).await {
        Ok(Ok(result)) => result,
        Ok(Err(e)) => Err(GattError::new(
            GattErrorCode::Internal,
            format!("windows {op} task failed: {e}"),
        )),
        Err(_) => Err(GattError::new(
            GattErrorCode::ConnectTimeout,
            format!("windows {op} timed out"),
        )),
    }
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn address_lock(addr: u64) -> Arc<Semaphore> {
    static LOCKS: LazyLock<std::sync::Mutex<HashMap<u64, Arc<Semaphore>>>> =
        LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));
    let mut locks = LOCKS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    Arc::clone(
        locks
            .entry(addr)
            .or_insert_with(|| Arc::new(Semaphore::new(1))),
    )
}

/// Pair/unpair for one address, one at a time. The permit and `hold` move into the
/// blocking closure: a timed-out WinRT call keeps running, and neither a retry nor a
/// connect (via the caller's `hold`) may touch the address until it returns.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
async fn run_exclusive<T, F, H>(
    addr: u64,
    op: &'static str,
    budget: Duration,
    hold: H,
    f: F,
) -> Result<T, GattError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, GattError> + Send + 'static,
    H: Send + 'static,
{
    let deadline = Instant::now() + budget;
    let permit = tokio::time::timeout(budget, address_lock(addr).acquire_owned())
        .await
        .map_err(|_| {
            GattError::new(
                GattErrorCode::ConnectTimeout,
                format!("windows {op} timed out waiting for an earlier pairing call"),
            )
        })?
        .map_err(|e| GattError::new(GattErrorCode::Internal, format!("windows {op}: {e}")))?;
    let remaining = deadline.saturating_duration_since(Instant::now());
    run_blocking(op, remaining, move || {
        let _permit = permit;
        let _hold = hold;
        f()
    })
    .await
}

#[cfg_attr(not(target_os = "windows"), allow(clippy::unused_async))]
pub async fn pair_state(address: &str) -> Result<PairState, GattError> {
    let addr = require_address(address)?;
    #[cfg(target_os = "windows")]
    {
        run_blocking("pair-state", STATE_TIMEOUT, move || imp::pair_state(addr)).await
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = addr;
        Err(unsupported())
    }
}

/// `hold` is dropped only once the WinRT call returns (even after a timeout).
#[cfg_attr(not(target_os = "windows"), allow(clippy::unused_async))]
pub async fn pair_with_pin<H: Send + 'static>(
    address: &str,
    pin: &str,
    hold: H,
) -> Result<(), GattError> {
    let addr = require_address(address)?;
    let pin = validate_pin(pin)?;
    #[cfg(target_os = "windows")]
    {
        run_exclusive(addr, "pair", PAIR_TIMEOUT, hold, move || {
            imp::pair(addr, &pin)
        })
        .await
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (addr, pin, hold);
        Err(unsupported())
    }
}

/// `hold` is dropped only once the WinRT call returns (even after a timeout).
#[cfg_attr(not(target_os = "windows"), allow(clippy::unused_async))]
pub async fn unpair<H: Send + 'static>(address: &str, hold: H) -> Result<(), GattError> {
    let addr = require_address(address)?;
    #[cfg(target_os = "windows")]
    {
        run_exclusive(addr, "unpair", STATE_TIMEOUT, hold, move || {
            imp::unpair(addr)
        })
        .await
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (addr, hold);
        Err(unsupported())
    }
}

#[cfg(not(target_os = "windows"))]
fn unsupported() -> GattError {
    GattError::new(
        GattErrorCode::Unsupported,
        "in-app Bluetooth pairing is only implemented on Windows",
    )
}

#[cfg(target_os = "windows")]
mod imp {
    use windows::Devices::Bluetooth::BluetoothLEDevice;
    use windows::Devices::Enumeration::{
        DeviceInformationCustomPairing, DeviceInformationPairing, DevicePairingKinds,
        DevicePairingProtectionLevel, DevicePairingRequestedEventArgs, DeviceUnpairingResultStatus,
    };
    use windows::Foundation::TypedEventHandler;
    use windows::core::HSTRING;

    use super::{
        GattError, GattErrorCode, PairState, STATUS_PROTECTION_LEVEL_NOT_MET, map_pairing_status,
        pairing_status_name,
    };

    fn win_err(op: &'static str) -> impl Fn(windows::core::Error) -> GattError {
        move |e| GattError::new(GattErrorCode::Internal, format!("windows {op}: {e}"))
    }

    /// Keep the `BluetoothLEDevice` alive alongside its pairing handle.
    fn open(addr: u64) -> Result<(BluetoothLEDevice, DeviceInformationPairing), GattError> {
        let device = BluetoothLEDevice::FromBluetoothAddressAsync(addr)
            .and_then(|op| op.get())
            .map_err(|e| {
                GattError::new(
                    GattErrorCode::ConnectTimeout,
                    format!(
                        "Windows could not find the radio ({e}); make sure it is powered on, \
                         advertising, and not connected to a phone"
                    ),
                )
            })?;
        let pairing = device
            .DeviceInformation()
            .and_then(|info| info.Pairing())
            .map_err(win_err("DeviceInformation.Pairing"))?;
        Ok((device, pairing))
    }

    pub fn pair_state(addr: u64) -> Result<PairState, GattError> {
        let (_device, pairing) = open(addr)?;
        let paired = pairing.IsPaired().map_err(win_err("IsPaired"))?;
        tracing::info!(target: "gatt", paired, "gatt: windows pair state");
        Ok(PairState { paired })
    }

    fn pair_once(
        custom: &DeviceInformationCustomPairing,
        level: DevicePairingProtectionLevel,
    ) -> Result<i32, GattError> {
        let kinds = DevicePairingKinds::ProvidePin
            | DevicePairingKinds::ConfirmOnly
            | DevicePairingKinds::ConfirmPinMatch;
        let result = custom
            .PairWithProtectionLevelAsync(kinds, level)
            .and_then(|op| op.get())
            .map_err(win_err("PairWithProtectionLevelAsync"))?;
        let status = result.Status().map_err(win_err("pairing status"))?;
        tracing::info!(
            target: "gatt",
            status = pairing_status_name(status.0),
            protection_level = level.0,
            "gatt: windows pairing result"
        );
        Ok(status.0)
    }

    pub fn pair(addr: u64, pin: &str) -> Result<(), GattError> {
        let (_device, pairing) = open(addr)?;
        if pairing.IsPaired().map_err(win_err("IsPaired"))? {
            tracing::info!(target: "gatt", "gatt: windows pair skipped (already paired)");
            return Ok(());
        }
        let custom = pairing.Custom().map_err(win_err("Pairing.Custom"))?;
        let pin_h = HSTRING::from(pin);
        let handler = TypedEventHandler::<
            DeviceInformationCustomPairing,
            DevicePairingRequestedEventArgs,
        >::new(
            move |_sender: &Option<DeviceInformationCustomPairing>,
                  args: &Option<DevicePairingRequestedEventArgs>| {
                let Some(args) = args else {
                    return Ok(());
                };
                let kind = args.PairingKind()?;
                tracing::info!(target: "gatt", pairing_kind = kind.0, "gatt: windows pairing requested");
                if kind == DevicePairingKinds::ProvidePin {
                    args.AcceptWithPin(&pin_h)
                } else {
                    args.Accept()
                }
            },
        );
        let token = custom
            .PairingRequested(&handler)
            .map_err(win_err("PairingRequested"))?;
        let mut status = pair_once(
            &custom,
            DevicePairingProtectionLevel::EncryptionAndAuthentication,
        );
        if matches!(status, Ok(code) if code == STATUS_PROTECTION_LEVEL_NOT_MET) {
            status = pair_once(&custom, DevicePairingProtectionLevel::Encryption);
        }
        if let Err(e) = custom.RemovePairingRequested(token) {
            tracing::debug!(target: "gatt", error = %e, "gatt: RemovePairingRequested failed");
        }
        map_pairing_status(status?)
    }

    pub fn unpair(addr: u64) -> Result<(), GattError> {
        let (_device, pairing) = open(addr)?;
        let result = pairing
            .UnpairAsync()
            .and_then(|op| op.get())
            .map_err(win_err("UnpairAsync"))?;
        let status = result.Status().map_err(win_err("unpair status"))?;
        if status != DeviceUnpairingResultStatus::Unpaired
            && status != DeviceUnpairingResultStatus::AlreadyUnpaired
        {
            return Err(GattError::new(
                GattErrorCode::Internal,
                format!("Windows unpair status={}", status.0),
            ));
        }
        tracing::info!(target: "gatt", status = status.0, "gatt: windows unpair ok");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mac_with_any_punctuation() {
        assert_eq!(ble_address_u64("ef:4f:4f:1c:23:73"), Some(0xef4f_4f1c_2373));
        assert_eq!(ble_address_u64("EF-4F-4F-1C-23-73"), Some(0xef4f_4f1c_2373));
        assert_eq!(ble_address_u64("ef4f4f1c2373"), Some(0xef4f_4f1c_2373));
        assert_eq!(ble_address_u64("ef:4f:4f:1c:23"), None);
        assert_eq!(
            ble_address_u64("6e400001-b5a3-f393-e0a9-e50e24dcca9e"),
            None,
            "CoreBluetooth UUIDs are not MACs"
        );
    }

    #[test]
    fn validates_pin_digits() {
        assert_eq!(validate_pin(" 123456 ").expect("pin"), "123456");
        assert_eq!(validate_pin("1234").expect("pin"), "1234");
        assert!(validate_pin("123").is_err());
        assert!(validate_pin("1234567").is_err());
        assert!(validate_pin("12a456").is_err());
        assert!(validate_pin("").is_err());
    }

    #[test]
    fn maps_pairing_statuses() {
        assert!(map_pairing_status(0).is_ok());
        assert!(map_pairing_status(3).is_ok());
        for code in [7, 8, 9, 17] {
            let err = map_pairing_status(code).expect_err("auth failure");
            assert_eq!(err.code, GattErrorCode::AuthenticationFailed);
        }
        let err = map_pairing_status(1).expect_err("not ready");
        assert_eq!(err.code, GattErrorCode::PairingRequired);
        assert!(err.message.contains("NotReadyToPair"));
        let err = map_pairing_status(99).expect_err("unknown");
        assert_eq!(err.code, GattErrorCode::PairingRequired);
        assert!(err.message.contains("Unknown"));
    }

    #[tokio::test]
    async fn rejects_bad_address_before_platform_dispatch() {
        let err = pair_state("not-a-mac").await.expect_err("bad address");
        assert_eq!(err.code, GattErrorCode::InvalidAddress);
        let err = pair_with_pin("ef:4f:4f:1c:23:73", "12", ())
            .await
            .expect_err("bad pin");
        assert_eq!(err.code, GattErrorCode::InvalidAddress);
    }

    #[cfg(not(target_os = "windows"))]
    #[tokio::test]
    async fn non_windows_returns_unsupported() {
        let addr = "ef:4f:4f:1c:23:73";
        assert_eq!(
            pair_state(addr).await.expect_err("unsupported").code,
            GattErrorCode::Unsupported
        );
        assert_eq!(
            pair_with_pin(addr, "123456", ())
                .await
                .expect_err("unsupported")
                .code,
            GattErrorCode::Unsupported
        );
        assert_eq!(
            unpair(addr, ()).await.expect_err("unsupported").code,
            GattErrorCode::Unsupported
        );
    }

    #[tokio::test]
    async fn run_blocking_times_out() {
        let err = run_blocking("pair", Duration::from_millis(20), || {
            std::thread::sleep(Duration::from_millis(200));
            Ok(())
        })
        .await
        .expect_err("timeout");
        assert_eq!(err.code, GattErrorCode::ConnectTimeout);
    }

    #[tokio::test]
    async fn run_exclusive_holds_address_until_timed_out_call_returns() {
        struct DropFlag(Arc<std::sync::atomic::AtomicBool>);
        impl Drop for DropFlag {
            fn drop(&mut self) {
                self.0.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
        let addr = 0x00AA_BBCC_DDEE;
        let dropped = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let err = run_exclusive(
            addr,
            "pair",
            Duration::from_millis(20),
            DropFlag(Arc::clone(&dropped)),
            || {
                std::thread::sleep(Duration::from_millis(300));
                Ok(())
            },
        )
        .await
        .expect_err("first call times out");
        assert_eq!(err.code, GattErrorCode::ConnectTimeout);
        assert!(
            !dropped.load(std::sync::atomic::Ordering::SeqCst),
            "hold must outlive the timeout while the blocking call runs"
        );

        let retry = run_exclusive(addr, "pair", Duration::from_millis(50), (), || Ok(()))
            .await
            .expect_err("retry must wait for the still-running call");
        assert!(
            retry.message.contains("earlier pairing call"),
            "{}",
            retry.message
        );

        run_exclusive(
            0x0011_2233_4455,
            "pair",
            Duration::from_millis(50),
            (),
            || Ok(()),
        )
        .await
        .expect("other addresses are not blocked");
        run_exclusive(addr, "pair", Duration::from_secs(2), (), || Ok(()))
            .await
            .expect("permit released once the blocking call returns");
        assert!(dropped.load(std::sync::atomic::Ordering::SeqCst));
    }
}

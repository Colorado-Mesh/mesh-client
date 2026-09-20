//! OS-level BLE bond purge when the host LTK no longer matches the peripheral.

use thiserror::Error;

use super::error_classifier::{BleFailureClass, classify_ble_error};

#[derive(Debug, Error)]
pub enum BleBondError {
    #[error("invalid BLE device identifier: {0}")]
    InvalidIdentifier(String),
    #[error("BLE unbond is not supported on this platform build")]
    #[allow(dead_code)] // used on non linux/macos/windows cfgs
    Unsupported,
    #[error("BLE unbond tool missing: {0}")]
    ToolMissing(String),
    #[error("BLE unbond failed: {0}")]
    Failed(String),
}

/// Normalize `ble://…`, MAC, or CoreBluetooth UUID into a bare identifier string.
#[must_use]
pub fn normalize_ble_identifier(raw: &str) -> String {
    let trimmed = raw.trim();
    let without_scheme = trimmed
        .strip_prefix("ble://")
        .or_else(|| trimmed.strip_prefix("BLE://"))
        .unwrap_or(trimmed)
        .trim();
    without_scheme
        .trim_matches(|c| c == '<' || c == '>')
        .to_string()
}

/// Result of handling a classified LTK desync (purge attempt + UI payload fields).
#[derive(Debug, Clone, serde::Serialize)]
pub struct LtkDesyncHandleResult {
    pub device_address: String,
    pub bond_purged: bool,
    pub message: String,
    pub purge_error: Option<String>,
}

/// Classify `error_message`; if LTK desync, attempt OS unbond and build the event payload.
#[allow(dead_code)] // convenience wrapper; API uses handle_ltk_desync_named
pub async fn handle_ltk_desync(
    identifier: &str,
    error_message: &str,
) -> Result<LtkDesyncHandleResult, BleBondError> {
    handle_ltk_desync_named(identifier, None, error_message).await
}

/// Like [`handle_ltk_desync`], with an optional OS Bluetooth display name
/// (e.g. `RNode 41F4`) for platforms where CoreBluetooth UUIDs are not usable
/// as unpair identifiers.
pub async fn handle_ltk_desync_named(
    identifier: &str,
    display_name: Option<&str>,
    error_message: &str,
) -> Result<LtkDesyncHandleResult, BleBondError> {
    let device_address = normalize_ble_identifier(identifier);
    if device_address.is_empty() {
        return Err(BleBondError::InvalidIdentifier(identifier.to_string()));
    }

    if classify_ble_error(error_message) != BleFailureClass::LtkDesync {
        return Err(BleBondError::Failed(
            "error message is not classified as LTK desync".into(),
        ));
    }

    match unbond_device_named(&device_address, display_name).await {
        Ok(()) => Ok(LtkDesyncHandleResult {
            device_address,
            bond_purged: true,
            message: "Bluetooth encryption key mismatch detected. Stale bond removed. Please re-pair the device.".into(),
            purge_error: None,
        }),
        Err(e) => Ok(LtkDesyncHandleResult {
            device_address,
            bond_purged: false,
            message: "Bluetooth encryption key mismatch detected. Forget the device in system Bluetooth settings, then re-pair.".into(),
            purge_error: Some(e.to_string()),
        }),
    }
}

/// Remove the OS BLE bond for `identifier` (MAC, UUID, or `ble://` URI).
#[allow(dead_code)] // convenience wrapper; callers use unbond_device_named
pub async fn unbond_device(identifier: &str) -> Result<(), BleBondError> {
    unbond_device_named(identifier, None).await
}

/// Remove the OS BLE bond, preferring `display_name` when the identifier is a
/// CoreBluetooth UUID that blueutil / classic Bluetooth APIs cannot resolve.
pub async fn unbond_device_named(
    identifier: &str,
    display_name: Option<&str>,
) -> Result<(), BleBondError> {
    let id = normalize_ble_identifier(identifier);
    if id.is_empty() {
        return Err(BleBondError::InvalidIdentifier(identifier.to_string()));
    }

    #[cfg(target_os = "linux")]
    {
        let _ = display_name;
        return unbond_linux(&id).await;
    }
    #[cfg(target_os = "macos")]
    {
        return unbond_macos(&id, display_name).await;
    }
    #[cfg(target_os = "windows")]
    {
        let _ = display_name;
        return unbond_windows(&id).await;
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        let _ = (id, display_name);
        Err(BleBondError::Unsupported)
    }
}

#[cfg(target_os = "linux")]
async fn unbond_linux(id: &str) -> Result<(), BleBondError> {
    use std::str::FromStr;

    use bluer::{Address, Session};

    let addr =
        Address::from_str(id).map_err(|e| BleBondError::InvalidIdentifier(format!("{id}: {e}")))?;
    let session = Session::new()
        .await
        .map_err(|e| BleBondError::Failed(format!("bluer session: {e}")))?;
    let adapter = session
        .default_adapter()
        .await
        .map_err(|e| BleBondError::Failed(format!("bluer adapter: {e}")))?;
    adapter
        .remove_device(addr)
        .await
        .map_err(|e| BleBondError::Failed(format!("bluer remove_device: {e}")))?;
    tracing::warn!(%id, "ble: removed BlueZ device bond (LTK desync recovery)");
    Ok(())
}

#[cfg(target_os = "macos")]
async fn unbond_macos(id: &str, display_name: Option<&str>) -> Result<(), BleBondError> {
    // CoreBluetooth has no public unpair API. Prefer Homebrew `blueutil --unpair`.
    // blueutil IDs are classic MAC or display name — never CoreBluetooth UUIDs.
    let id_owned = id.to_string();
    let name_owned = display_name
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    tokio::task::spawn_blocking(move || run_blueutil_unpair(&id_owned, name_owned.as_deref()))
        .await
        .map_err(|e| BleBondError::Failed(format!("blueutil join: {e}")))?
}

#[cfg(target_os = "macos")]
fn looks_like_corebluetooth_uuid(id: &str) -> bool {
    let hex: String = id.chars().filter(char::is_ascii_hexdigit).collect();
    // 8-4-4-4-12 UUID → 32 hex digits; classic BT address is 12.
    hex.len() == 32
}

#[cfg(target_os = "macos")]
fn looks_like_bt_address(id: &str) -> bool {
    let hex: String = id.chars().filter(char::is_ascii_hexdigit).collect();
    hex.len() == 12
}

#[cfg(target_os = "macos")]
fn normalize_bt_address_dashed(id: &str) -> Option<String> {
    let hex: String = id
        .chars()
        .filter(char::is_ascii_hexdigit)
        .map(|c| c.to_ascii_lowercase())
        .collect();
    if hex.len() != 12 {
        return None;
    }
    Some(format!(
        "{}-{}-{}-{}-{}-{}",
        &hex[0..2],
        &hex[2..4],
        &hex[4..6],
        &hex[6..8],
        &hex[8..10],
        &hex[10..12]
    ))
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone)]
struct BlueutilPairedDevice {
    address: String,
    name: String,
}

#[cfg(target_os = "macos")]
fn blueutil_bin_candidates() -> &'static [&'static str] {
    &[
        "blueutil",
        "/opt/homebrew/bin/blueutil",
        "/usr/local/bin/blueutil",
    ]
}

#[cfg(target_os = "macos")]
fn run_blueutil_json(bin: &str, args: &[&str]) -> Result<serde_json::Value, BleBondError> {
    use std::process::Command;

    let output = match Command::new(bin).args(args).output() {
        Ok(o) => o,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(BleBondError::ToolMissing(
                "blueutil not found (brew install blueutil) — Forget the device in System Settings → Bluetooth"
                    .into(),
            ));
        }
        Err(e) => return Err(BleBondError::Failed(format!("{bin}: {e}"))),
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(BleBondError::Failed(format!(
            "{bin} {:?} failed (status={}): {}",
            args,
            output.status,
            stderr.trim()
        )));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(stdout.trim()).map_err(|e| {
        BleBondError::Failed(format!("{bin} JSON parse: {e}; stdout={}", stdout.trim()))
    })
}

#[cfg(target_os = "macos")]
fn list_blueutil_paired(bin: &str) -> Result<Vec<BlueutilPairedDevice>, BleBondError> {
    let value = run_blueutil_json(bin, &["--paired", "--format", "json"])?;
    let arr = value
        .as_array()
        .ok_or_else(|| BleBondError::Failed(format!("{bin} --paired: expected JSON array")))?;
    let mut out = Vec::with_capacity(arr.len());
    for entry in arr {
        let address = entry
            .get("address")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let name = entry
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if !address.is_empty() || !name.is_empty() {
            out.push(BlueutilPairedDevice { address, name });
        }
    }
    Ok(out)
}

#[cfg(target_os = "macos")]
fn paired_still_contains(paired: &[BlueutilPairedDevice], id: &str) -> bool {
    let id_hex: String = id
        .chars()
        .filter(char::is_ascii_hexdigit)
        .map(|c| c.to_ascii_lowercase())
        .collect();
    paired.iter().any(|d| {
        if !d.name.is_empty() && d.name.eq_ignore_ascii_case(id.trim()) {
            return true;
        }
        if !d.address.is_empty() {
            if d.address.eq_ignore_ascii_case(id.trim()) {
                return true;
            }
            let addr_hex: String = d
                .address
                .chars()
                .filter(char::is_ascii_hexdigit)
                .map(|c| c.to_ascii_lowercase())
                .collect();
            if !id_hex.is_empty() && addr_hex == id_hex {
                return true;
            }
        }
        false
    })
}

#[cfg(target_os = "macos")]
fn resolve_blueutil_unpair_candidates(
    id: &str,
    display_name: Option<&str>,
    paired: &[BlueutilPairedDevice],
) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push_unique = |s: String| {
        if s.is_empty() {
            return;
        }
        if !out.iter().any(|e| e.eq_ignore_ascii_case(&s)) {
            out.push(s);
        }
    };

    if let Some(name) = display_name.map(str::trim).filter(|s| !s.is_empty()) {
        push_unique(name.to_string());
        if let Some(match_dev) = paired.iter().find(|d| d.name.eq_ignore_ascii_case(name)) {
            if let Some(dashed) = normalize_bt_address_dashed(&match_dev.address) {
                push_unique(dashed);
            }
            if !match_dev.address.is_empty() {
                push_unique(match_dev.address.clone());
            }
        }
    }

    if looks_like_bt_address(id) {
        if let Some(dashed) = normalize_bt_address_dashed(id) {
            push_unique(dashed);
        }
        push_unique(id.to_string());
    } else if !looks_like_corebluetooth_uuid(id) {
        // Likely already a display name or other blueutil-resolvable id.
        push_unique(id.to_string());
    }

    // Last resort: if UUID and no name match, do not pass the UUID to blueutil —
    // it always fails with "Device not found by name: <uuid>".
    out
}

#[cfg(target_os = "macos")]
fn run_blueutil_unpair(id: &str, display_name: Option<&str>) -> Result<(), BleBondError> {
    use std::process::Command;

    let mut last_err = BleBondError::ToolMissing(
        "blueutil not found (brew install blueutil) — Forget the device in System Settings → Bluetooth"
            .into(),
    );

    for bin in blueutil_bin_candidates() {
        let paired = match list_blueutil_paired(bin) {
            Ok(p) => p,
            Err(e) if matches!(e, BleBondError::ToolMissing(_)) => {
                last_err = e;
                continue;
            }
            Err(e) => {
                // Binary exists but paired list failed — still try direct candidates.
                tracing::debug!(bin, error = %e, "ble: blueutil --paired failed; trying direct ids");
                Vec::new()
            }
        };

        let candidates = resolve_blueutil_unpair_candidates(id, display_name, &paired);

        if candidates.is_empty() {
            last_err = BleBondError::Failed(format!(
                "{bin}: no blueutil-resolvable id (CoreBluetooth UUID requires display name; got id={id}, name={display_name:?})"
            ));
            continue;
        }

        for candidate in &candidates {
            let output = match Command::new(bin).args(["--unpair", candidate]).output() {
                Ok(o) => o,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    last_err = BleBondError::ToolMissing(
                        "blueutil not found (brew install blueutil) — Forget the device in System Settings → Bluetooth"
                            .into(),
                    );
                    break;
                }
                Err(e) => {
                    last_err = BleBondError::Failed(format!("{bin}: {e}"));
                    continue;
                }
            };
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                last_err = BleBondError::Failed(format!(
                    "{bin} --unpair {candidate:?} failed (status={}): {} {}",
                    output.status,
                    stdout.trim(),
                    stderr.trim()
                ));
                continue;
            }

            // blueutil --unpair is EXPERIMENTAL and may exit 0 without removing the bond.
            let still = match list_blueutil_paired(bin) {
                Ok(after) => {
                    candidates.iter().any(|c| paired_still_contains(&after, c))
                        || paired_still_contains(&after, candidate)
                }
                Err(_) => false,
            };
            if still {
                last_err = BleBondError::Failed(format!(
                    "{bin} --unpair {candidate:?} exited 0 but device still listed in --paired (EXPERIMENTAL unpair ineffective on this macOS — Forget in System Settings → Bluetooth)"
                ));
                continue;
            }

            tracing::warn!(
                %id,
                candidate,
                name = ?display_name,
                bin,
                "ble: blueutil --unpair ok (LTK desync recovery)"
            );
            return Ok(());
        }
    }
    Err(last_err)
}

#[cfg(target_os = "windows")]
async fn unbond_windows(id: &str) -> Result<(), BleBondError> {
    use windows::Devices::Bluetooth::BluetoothDevice;
    use windows::core::HSTRING;

    // Prefer classic Bluetooth address (12 hex digits); else treat as device Id.
    let device = if let Some(addr) = parse_bt_address_u64(id) {
        BluetoothDevice::FromBluetoothAddressAsync(addr)
            .map_err(|e| BleBondError::Failed(format!("FromBluetoothAddressAsync: {e}")))?
            .await
            .map_err(|e| BleBondError::Failed(format!("FromBluetoothAddress: {e}")))?
    } else {
        let id_h = HSTRING::from(id);
        BluetoothDevice::FromIdAsync(&id_h)
            .map_err(|e| BleBondError::Failed(format!("BluetoothDevice::FromIdAsync: {e}")))?
            .await
            .map_err(|e| BleBondError::Failed(format!("BluetoothDevice FromId: {e}")))?
    };
    let pairing = device
        .DeviceInformation()
        .map_err(|e| BleBondError::Failed(format!("DeviceInformation: {e}")))?
        .Pairing()
        .map_err(|e| BleBondError::Failed(format!("Pairing: {e}")))?;
    let result = pairing
        .UnpairAsync()
        .map_err(|e| BleBondError::Failed(format!("UnpairAsync: {e}")))?
        .await
        .map_err(|e| BleBondError::Failed(format!("Unpair await: {e}")))?;
    let status = result
        .Status()
        .map_err(|e| BleBondError::Failed(format!("Unpair status: {e}")))?;
    // DeviceUnpairingResultStatus::Unpaired == 1
    if i32::from(status) != 1 {
        return Err(BleBondError::Failed(format!(
            "Windows Unpair status={status:?} (expected Unpaired)"
        )));
    }
    tracing::warn!(%id, "ble: Windows UnpairAsync ok (LTK desync recovery)");
    Ok(())
}

#[cfg(target_os = "windows")]
fn parse_bt_address_u64(id: &str) -> Option<u64> {
    let hex: String = id.chars().filter(char::is_ascii_hexdigit).collect();
    if hex.len() != 12 {
        return None;
    }
    u64::from_str_radix(&hex, 16).ok()
}

#[cfg(test)]
mod tests {
    use super::normalize_ble_identifier;

    #[test]
    fn strips_ble_scheme() {
        assert_eq!(
            normalize_ble_identifier("ble://AA:BB:CC:DD:EE:FF"),
            "AA:BB:CC:DD:EE:FF"
        );
        assert_eq!(
            normalize_ble_identifier("ble://eccf2847-e1fd-3f5f-0811-064db1639a3d"),
            "eccf2847-e1fd-3f5f-0811-064db1639a3d"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn resolve_candidates_prefers_name_and_mac_over_uuid() {
        use super::{BlueutilPairedDevice, resolve_blueutil_unpair_candidates};

        let paired = vec![BlueutilPairedDevice {
            address: "f0-9e-9e-77-98-d5".into(),
            name: "RNode 41F4".into(),
        }];
        let c = resolve_blueutil_unpair_candidates(
            "eccf2847-e1fd-3f5f-0811-064db1639a3d",
            Some("RNode 41F4"),
            &paired,
        );
        assert_eq!(c.first().map(String::as_str), Some("RNode 41F4"));
        assert!(c.iter().any(|x| x == "f0-9e-9e-77-98-d5"));
        assert!(!c.iter().any(|x| x.contains("eccf2847")));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn resolve_candidates_skips_bare_uuid_without_name() {
        use super::resolve_blueutil_unpair_candidates;

        let c =
            resolve_blueutil_unpair_candidates("eccf2847-e1fd-3f5f-0811-064db1639a3d", None, &[]);
        assert!(c.is_empty());
    }
}

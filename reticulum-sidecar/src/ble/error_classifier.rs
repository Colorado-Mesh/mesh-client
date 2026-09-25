//! Classify BLE connect/pair failures as ordinary errors vs LTK / bond desync.

/// Outcome of inspecting a BLE driver / OS error string.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BleFailureClass {
    /// Transient connect/scan timeout or adapter busy — safe to retry.
    Transient,
    /// OS still has a bond entry but the peripheral rejected the LTK / cleared its table.
    LtkDesync,
    /// Other hard failure (not specifically LTK desync).
    Other,
}

/// Inspect a btleplug / CoreBluetooth / BlueZ / WinRT error string.
#[must_use]
pub fn classify_ble_error(message: &str) -> BleFailureClass {
    let lower = message.to_ascii_lowercase();

    if is_ltk_desync_message(&lower) {
        return BleFailureClass::LtkDesync;
    }
    if is_transient_message(&lower) {
        return BleFailureClass::Transient;
    }
    BleFailureClass::Other
}

fn is_ltk_desync_message(lower: &str) -> bool {
    // macOS CoreBluetooth
    if lower.contains("peer removed pairing information") {
        return true;
    }
    if lower.contains("cberrordomain") && (lower.contains("code=14") || lower.contains("code=15")) {
        return true;
    }
    if lower.contains("encryption required failed") || lower.contains("encryption timed out") {
        return true;
    }

    // Linux BlueZ
    if lower.contains("org.bluez.error.authenticationfailed")
        || lower.contains("authentication failed")
        || lower.contains("software caused connection abort")
        || lower.contains("ebadmsg")
    {
        return true;
    }

    // Windows WinRT / HRESULT
    if lower.contains("0x80070490")
        || lower.contains("element not found")
        || lower.contains("consentrequired")
        || lower.contains("consent required")
    {
        return true;
    }

    // HCI status 0x05 (Authentication Failure) / 0x06 (PIN or Key Missing)
    if lower.contains("hci status 0x05")
        || lower.contains("hci status 0x06")
        || lower.contains("status: 0x05")
        || lower.contains("status: 0x06")
        || lower.contains("authentication failure")
        || lower.contains("pin or key missing")
    {
        return true;
    }

    false
}

fn is_transient_message(lower: &str) -> bool {
    lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("scan_busy")
        || lower.contains("adapter missing")
        || lower.contains("busy")
        || (lower.contains("connection aborted")
            && !lower.contains("software caused connection abort"))
}

#[cfg(test)]
mod tests {
    use super::{BleFailureClass, classify_ble_error};

    #[test]
    fn classifies_macos_peer_removed() {
        assert_eq!(
            classify_ble_error(
                "BLE connect failed after 3 attempts: connect: Runtime Error: Peer removed pairing information"
            ),
            BleFailureClass::LtkDesync
        );
        assert_eq!(
            classify_ble_error("CBErrorDomain Code=14 \"Peer removed pairing information\""),
            BleFailureClass::LtkDesync
        );
        assert_eq!(
            classify_ble_error("CBErrorDomain Code=15 Encryption required failed"),
            BleFailureClass::LtkDesync
        );
    }

    #[test]
    fn classifies_linux_bluez_auth_failures() {
        assert_eq!(
            classify_ble_error("org.bluez.Error.AuthenticationFailed"),
            BleFailureClass::LtkDesync
        );
        assert_eq!(
            classify_ble_error("Software caused connection abort"),
            BleFailureClass::LtkDesync
        );
        assert_eq!(
            classify_ble_error("write failed: ebadmsg"),
            BleFailureClass::LtkDesync
        );
    }

    #[test]
    fn classifies_windows_hresult_and_consent() {
        assert_eq!(
            classify_ble_error("Unpair failed: 0x80070490 Element not found"),
            BleFailureClass::LtkDesync
        );
        assert_eq!(
            classify_ble_error("DevicePairingResult Status=ConsentRequired"),
            BleFailureClass::LtkDesync
        );
    }

    #[test]
    fn classifies_hci_auth_and_key_missing() {
        assert_eq!(
            classify_ble_error("connect failed: HCI status 0x05 Authentication Failure"),
            BleFailureClass::LtkDesync
        );
        assert_eq!(
            classify_ble_error("HCI status 0x06 PIN or Key Missing"),
            BleFailureClass::LtkDesync
        );
    }

    #[test]
    fn classifies_transient_timeouts() {
        assert_eq!(
            classify_ble_error("Bluetooth adapter discovery timed out"),
            BleFailureClass::Transient
        );
        assert_eq!(
            classify_ble_error("scan_busy: reticulum holds the adapter"),
            BleFailureClass::Transient
        );
    }

    #[test]
    fn other_errors_are_not_ltk_desync() {
        assert_eq!(
            classify_ble_error("peripheral not found in scan results"),
            BleFailureClass::Other
        );
    }
}

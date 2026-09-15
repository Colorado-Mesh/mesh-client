//! Stable GATT error taxonomy for HTTP/WS and Electron log/UI bridging.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GattErrorCode {
    AdapterMissing,
    /// OS denied Bluetooth access (surfaced when platforms report it).
    #[allow(dead_code)]
    PermissionDenied,
    ScanBusy,
    MacConflict,
    ConnectTimeout,
    GattDiscoverFailed,
    PairingRequired,
    /// Peer bond was removed mid-session (surfaced when platforms report it).
    #[allow(dead_code)]
    BondRemoved,
    WriteFailed,
    SessionNotFound,
    NotifiedReadForbidden,
    FeatureDisabled,
    InvalidProfile,
    InvalidAddress,
    Internal,
}

impl GattErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::AdapterMissing => "adapter_missing",
            Self::PermissionDenied => "permission_denied",
            Self::ScanBusy => "scan_busy",
            Self::MacConflict => "mac_conflict",
            Self::ConnectTimeout => "connect_timeout",
            Self::GattDiscoverFailed => "gatt_discover_failed",
            Self::PairingRequired => "pairing_required",
            Self::BondRemoved => "bond_removed",
            Self::WriteFailed => "write_failed",
            Self::SessionNotFound => "session_not_found",
            Self::NotifiedReadForbidden => "notified_read_forbidden",
            Self::FeatureDisabled => "feature_disabled",
            Self::InvalidProfile => "invalid_profile",
            Self::InvalidAddress => "invalid_address",
            Self::Internal => "internal",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct GattError {
    pub code: GattErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
}

impl GattError {
    pub fn new(code: GattErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            owner: None,
        }
    }

    pub fn with_owner(mut self, owner: impl Into<String>) -> Self {
        self.owner = Some(owner.into());
        self
    }

    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "ok": false,
            "code": self.code.as_str(),
            "error": self.message,
            "owner": self.owner,
        })
    }
}

impl std::fmt::Display for GattError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code.as_str(), self.message)
    }
}

impl std::error::Error for GattError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_snake_case_codes() {
        let err =
            GattError::new(GattErrorCode::MacConflict, "held by meshcore").with_owner("meshcore");
        let v = err.to_json();
        assert_eq!(v["code"], "mac_conflict");
        assert_eq!(v["owner"], "meshcore");
        assert_eq!(v["ok"], false);
    }

    #[test]
    fn all_codes_have_stable_strings() {
        let codes = [
            GattErrorCode::AdapterMissing,
            GattErrorCode::PermissionDenied,
            GattErrorCode::ScanBusy,
            GattErrorCode::MacConflict,
            GattErrorCode::ConnectTimeout,
            GattErrorCode::GattDiscoverFailed,
            GattErrorCode::PairingRequired,
            GattErrorCode::BondRemoved,
            GattErrorCode::WriteFailed,
            GattErrorCode::SessionNotFound,
            GattErrorCode::NotifiedReadForbidden,
            GattErrorCode::FeatureDisabled,
            GattErrorCode::InvalidProfile,
            GattErrorCode::InvalidAddress,
            GattErrorCode::Internal,
        ];
        for code in codes {
            assert!(!code.as_str().is_empty());
            assert!(!code.as_str().contains(' '));
        }
    }
}

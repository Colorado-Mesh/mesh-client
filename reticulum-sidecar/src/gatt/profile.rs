//! GATT profile identifiers and service/characteristic UUIDs.

use std::str::FromStr;

use serde::{Deserialize, Serialize};

use super::error::{GattError, GattErrorCode};

/// Session / ownership profile for a BLE peripheral.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GattProfile {
    Meshtastic,
    Meshcore,
    Rnode,
    Peer,
}

impl GattProfile {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Meshtastic => "meshtastic",
            Self::Meshcore => "meshcore",
            Self::Rnode => "rnode",
            Self::Peer => "peer",
        }
    }

    pub const fn is_lora_pipe(self) -> bool {
        matches!(self, Self::Meshtastic | Self::Meshcore)
    }
}

impl FromStr for GattProfile {
    type Err = GattError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "meshtastic" => Ok(Self::Meshtastic),
            "meshcore" => Ok(Self::Meshcore),
            "rnode" => Ok(Self::Rnode),
            "peer" => Ok(Self::Peer),
            _ => Err(GattError::new(
                GattErrorCode::InvalidProfile,
                format!("invalid gatt profile: {s}"),
            )),
        }
    }
}

impl std::fmt::Display for GattProfile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Meshtastic BLE GATT UUIDs (from @meshtastic/transport-web-bluetooth).
pub mod meshtastic {
    use uuid::Uuid;

    pub fn service() -> Uuid {
        Uuid::parse_str("6ba1b218-15a8-461f-9fa8-5dcae273eafd").expect("valid uuid")
    }
    pub fn to_radio() -> Uuid {
        Uuid::parse_str("f75c76d2-129e-4dad-a1dd-7866124401e7").expect("valid uuid")
    }
    pub fn from_radio() -> Uuid {
        Uuid::parse_str("2c55e69e-4993-11ed-b878-0242ac120002").expect("valid uuid")
    }
    pub fn from_num() -> Uuid {
        Uuid::parse_str("ed9da18c-a800-4f66-a670-aa7547e34453").expect("valid uuid")
    }
}

/// Nordic UART Service (MeshCore + RNode share NUS UUIDs — key sessions by MAC+profile).
pub mod nus {
    use uuid::Uuid;

    pub fn service() -> Uuid {
        Uuid::parse_str("6e400001-b5a3-f393-e0a9-e50e24dcca9e").expect("valid uuid")
    }
    /// Central writes; peripheral reads.
    pub fn rx() -> Uuid {
        Uuid::parse_str("6e400002-b5a3-f393-e0a9-e50e24dcca9e").expect("valid uuid")
    }
    /// Peripheral notifies; central must not GATT-read while notify is active (WinRT).
    pub fn tx() -> Uuid {
        Uuid::parse_str("6e400003-b5a3-f393-e0a9-e50e24dcca9e").expect("valid uuid")
    }
}

/// Normalize a BLE address / peripheral id for registry keys.
pub fn normalize_address(raw: &str) -> Result<String, GattError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(GattError::new(
            GattErrorCode::InvalidAddress,
            "empty ble address",
        ));
    }
    // Keep opaque CoreBluetooth UUIDs and MACs; compare via [`ble_id_match_key`].
    Ok(trimmed.to_ascii_lowercase())
}

/// Strip to lowercase hex digits so Noble UUIDs and dashed CoreBluetooth UUIDs compare equal.
pub fn ble_id_match_key(raw: &str) -> String {
    raw.chars()
        .filter(char::is_ascii_hexdigit)
        .flat_map(char::to_lowercase)
        .collect()
}

/// True when two BLE identifiers refer to the same peripheral (MAC or UUID, any punctuation).
pub fn ble_ids_match(a: &str, b: &str) -> bool {
    let ka = ble_id_match_key(a);
    let kb = ble_id_match_key(b);
    !ka.is_empty() && ka == kb
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_profiles() {
        assert_eq!(
            "meshtastic".parse::<GattProfile>().unwrap(),
            GattProfile::Meshtastic
        );
        assert_eq!(
            "MESHCORE".parse::<GattProfile>().unwrap(),
            GattProfile::Meshcore
        );
        assert!("nope".parse::<GattProfile>().is_err());
    }

    #[test]
    fn ble_ids_match_uuid_with_and_without_dashes() {
        assert!(ble_ids_match(
            "ff92959fd78be6f009376829a4d6efdc",
            "FF92959F-D78B-E6F0-0937-6829A4D6EFDC"
        ));
        assert!(ble_ids_match("AA:BB:CC:DD:EE:FF", "aabbccddeeff"));
        assert!(!ble_ids_match(
            "aa:bb:cc:dd:ee:ff",
            "ff92959fd78be6f009376829a4d6efdc"
        ));
    }
}

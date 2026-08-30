//! Persisted transport path-medium preference and per-destination medium pins.
//!
//! Wire spellings match rsReticulum `PathMediumPreference::as_str()` /
//! `PathMedium::as_str()` so the state file, HTTP API, and transport control
//! RPC all speak the same tokens.

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use super::topology::canonicalize_destination_hash;

/// Cap the pin map so a runaway client cannot grow the state file without bound.
pub const MAX_PEER_MEDIUM_PINS: usize = 256;

/// Global bias for which medium wins a destination's active path slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PathMediumPreferenceSetting {
    /// No medium bias — rank purely by hop count.
    #[default]
    Lowest,
    Network,
    Rf,
}

impl PathMediumPreferenceSetting {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Lowest => "lowest",
            Self::Network => "network",
            Self::Rf => "rf",
        }
    }

    pub fn from_wire(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "lowest" => Some(Self::Lowest),
            "network" => Some(Self::Network),
            "rf" => Some(Self::Rf),
            _ => None,
        }
    }
}

impl Serialize for PathMediumPreferenceSetting {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for PathMediumPreferenceSetting {
    /// Unknown or non-string tokens fall back to the default instead of failing
    /// the whole state-file load (which would reset every persisted setting).
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = serde_json::Value::deserialize(deserializer)?;
        Ok(raw
            .as_str()
            .and_then(Self::from_wire)
            .unwrap_or_else(Self::default))
    }
}

/// Transport medium a path was learned over (coarser than interface mode).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathMediumSetting {
    Rf,
    Network,
}

impl PathMediumSetting {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Rf => "rf",
            Self::Network => "network",
        }
    }

    pub fn from_wire(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "rf" => Some(Self::Rf),
            "network" => Some(Self::Network),
            _ => None,
        }
    }
}

impl Serialize for PathMediumSetting {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for PathMediumSetting {
    /// Unknown tokens deserialize to `None` at the field level (`Option`) rather
    /// than failing the whole state-file load.
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = serde_json::Value::deserialize(deserializer)?;
        raw.as_str()
            .and_then(Self::from_wire)
            .ok_or_else(|| serde::de::Error::custom("unknown path medium"))
    }
}

/// Map a `via.rs` transport atom (`rf` / `ble` / `tcp` / `network`) onto a medium.
///
/// LoRa and BLE are RF: low bandwidth, high latency, and subject to duty-cycle
/// limits, so they cannot carry propagation-node traffic the way IP links can.
pub fn medium_from_via_atom(atom: &str) -> PathMediumSetting {
    match atom.trim().to_ascii_lowercase().as_str() {
        "rf" | "ble" => PathMediumSetting::Rf,
        _ => PathMediumSetting::Network,
    }
}

/// Per-destination medium pins keyed by 32 lowercase hex chars.
///
/// `BTreeMap` keeps the persisted JSON key order stable across saves.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PeerMediumPins(BTreeMap<String, PathMediumSetting>);

impl PeerMediumPins {
    pub fn get(&self, hash: &str) -> Option<PathMediumSetting> {
        let key = canonicalize_destination_hash(hash)?;
        self.0.get(&key).copied()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, PathMediumSetting)> {
        self.0.iter().map(|(hash, pin)| (hash.as_str(), *pin))
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Set (`Some`) or clear (`None`) the pin for `hash`; returns the canonical hash.
    pub fn set(&mut self, hash: &str, pin: Option<PathMediumSetting>) -> Result<String, String> {
        let key = canonicalize_destination_hash(hash)
            .ok_or_else(|| "destination_hash must be 32 hex characters".to_string())?;
        match pin {
            Some(pin) => {
                if !self.0.contains_key(&key) && self.len() >= MAX_PEER_MEDIUM_PINS {
                    return Err("peer_medium_pins_too_many".into());
                }
                self.0.insert(key.clone(), pin);
            }
            None => {
                self.0.remove(&key);
            }
        }
        Ok(key)
    }

    pub fn to_json(&self) -> serde_json::Value {
        serde_json::Value::Object(
            self.0
                .iter()
                .map(|(hash, pin)| {
                    (
                        hash.clone(),
                        serde_json::Value::String(pin.as_str().to_string()),
                    )
                })
                .collect(),
        )
    }
}

impl Serialize for PeerMediumPins {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for PeerMediumPins {
    /// Skip malformed hashes / unknown mediums rather than failing the whole
    /// state-file load.
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = serde_json::Value::deserialize(deserializer)?;
        let Some(map) = raw.as_object() else {
            return Ok(Self::default());
        };
        let mut pins = BTreeMap::new();
        for (hash, value) in map {
            let Some(key) = canonicalize_destination_hash(hash) else {
                continue;
            };
            let Some(pin) = value.as_str().and_then(PathMediumSetting::from_wire) else {
                continue;
            };
            if pins.len() >= MAX_PEER_MEDIUM_PINS {
                break;
            }
            pins.insert(key, pin);
        }
        Ok(Self(pins))
    }
}

/// Map the persisted preference onto the transport control enum.
#[cfg(feature = "rns-stack")]
pub fn to_transport_preference(
    preference: PathMediumPreferenceSetting,
) -> rns_transport::constants::PathMediumPreference {
    use rns_transport::constants::PathMediumPreference;
    match preference {
        PathMediumPreferenceSetting::Lowest => PathMediumPreference::Lowest,
        PathMediumPreferenceSetting::Network => PathMediumPreference::Network,
        PathMediumPreferenceSetting::Rf => PathMediumPreference::Rf,
    }
}

/// Map a persisted pin onto the transport control enum.
#[cfg(feature = "rns-stack")]
pub fn to_transport_medium(pin: PathMediumSetting) -> rns_transport::constants::PathMedium {
    use rns_transport::constants::PathMedium;
    match pin {
        PathMediumSetting::Rf => PathMedium::Rf,
        PathMediumSetting::Network => PathMedium::Network,
    }
}

/// Map a transport-reported preference back onto the persisted spelling.
#[cfg(feature = "rns-stack")]
pub fn from_transport_preference(
    preference: rns_transport::constants::PathMediumPreference,
) -> PathMediumPreferenceSetting {
    use rns_transport::constants::PathMediumPreference;
    match preference {
        PathMediumPreference::Lowest => PathMediumPreferenceSetting::Lowest,
        PathMediumPreference::Network => PathMediumPreferenceSetting::Network,
        PathMediumPreference::Rf => PathMediumPreferenceSetting::Rf,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH_A: &str = "aabbccddeeff00112233445566778899";
    const HASH_B: &str = "deadbeefcafebabe0123456789abcdef";

    #[test]
    fn preference_defaults_to_lowest() {
        assert_eq!(
            PathMediumPreferenceSetting::default(),
            PathMediumPreferenceSetting::Lowest
        );
        assert_eq!(PathMediumPreferenceSetting::default().as_str(), "lowest");
    }

    #[test]
    fn preference_wire_round_trip() {
        for token in ["lowest", "network", "rf"] {
            let parsed = PathMediumPreferenceSetting::from_wire(token).expect("parse");
            assert_eq!(parsed.as_str(), token);
            let json = serde_json::to_string(&parsed).expect("serialize");
            assert_eq!(json, format!("\"{token}\""));
        }
        assert_eq!(
            PathMediumPreferenceSetting::from_wire("  RF  "),
            Some(PathMediumPreferenceSetting::Rf)
        );
        assert!(PathMediumPreferenceSetting::from_wire("wired").is_none());
    }

    #[test]
    fn preference_deserialize_falls_back_on_garbage() {
        let parsed: PathMediumPreferenceSetting =
            serde_json::from_str("\"bogus\"").expect("tolerant");
        assert_eq!(parsed, PathMediumPreferenceSetting::Lowest);
        let parsed: PathMediumPreferenceSetting = serde_json::from_str("null").expect("tolerant");
        assert_eq!(parsed, PathMediumPreferenceSetting::Lowest);
        let parsed: PathMediumPreferenceSetting = serde_json::from_str("7").expect("tolerant");
        assert_eq!(parsed, PathMediumPreferenceSetting::Lowest);
    }

    #[test]
    fn medium_wire_round_trip() {
        assert_eq!(PathMediumSetting::Rf.as_str(), "rf");
        assert_eq!(PathMediumSetting::Network.as_str(), "network");
        assert_eq!(
            PathMediumSetting::from_wire("NETWORK"),
            Some(PathMediumSetting::Network)
        );
        assert!(PathMediumSetting::from_wire("lowest").is_none());
    }

    #[test]
    fn pins_set_and_clear() {
        let mut pins = PeerMediumPins::default();
        assert!(pins.is_empty());
        let key = pins
            .set(&HASH_A.to_ascii_uppercase(), Some(PathMediumSetting::Rf))
            .expect("set");
        assert_eq!(key, HASH_A);
        assert_eq!(pins.get(HASH_A), Some(PathMediumSetting::Rf));
        pins.set(HASH_A, Some(PathMediumSetting::Network))
            .expect("update");
        assert_eq!(pins.get(HASH_A), Some(PathMediumSetting::Network));
        pins.set(HASH_A, None).expect("clear");
        assert!(pins.get(HASH_A).is_none());
        assert!(pins.is_empty());
        // Clearing an absent pin is a no-op, not an error.
        pins.set(HASH_B, None).expect("clear absent");
    }

    #[test]
    fn pins_reject_bad_hash_and_cap_entries() {
        let mut pins = PeerMediumPins::default();
        assert!(pins.set("abcd", Some(PathMediumSetting::Rf)).is_err());
        assert!(
            pins.set(&format!("{HASH_A}ff"), Some(PathMediumSetting::Rf))
                .is_err()
        );
        for i in 0..MAX_PEER_MEDIUM_PINS {
            let hash = format!("{:032x}", i as u128);
            pins.set(&hash, Some(PathMediumSetting::Rf)).expect("fill");
        }
        assert_eq!(pins.len(), MAX_PEER_MEDIUM_PINS);
        assert_eq!(
            pins.set(HASH_A, Some(PathMediumSetting::Rf)).unwrap_err(),
            "peer_medium_pins_too_many"
        );
        // Updating an existing key still works at the cap.
        let existing = format!("{:032x}", 0u128);
        pins.set(&existing, Some(PathMediumSetting::Network))
            .expect("update at cap");
    }

    #[test]
    fn pins_serde_round_trip_skips_invalid_entries() {
        let mut pins = PeerMediumPins::default();
        pins.set(HASH_A, Some(PathMediumSetting::Rf)).expect("set");
        pins.set(HASH_B, Some(PathMediumSetting::Network))
            .expect("set");
        let json = serde_json::to_string(&pins).expect("serialize");
        let loaded: PeerMediumPins = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(loaded, pins);

        let tolerant: PeerMediumPins = serde_json::from_str(&format!(
            "{{\"{HASH_A}\":\"rf\",\"nothex\":\"rf\",\"{HASH_B}\":\"satellite\"}}"
        ))
        .expect("tolerant");
        assert_eq!(tolerant.len(), 1);
        assert_eq!(tolerant.get(HASH_A), Some(PathMediumSetting::Rf));

        let tolerant: PeerMediumPins = serde_json::from_str("[]").expect("tolerant");
        assert!(tolerant.is_empty());
    }

    #[test]
    fn pins_to_json_uses_wire_tokens() {
        let mut pins = PeerMediumPins::default();
        pins.set(HASH_A, Some(PathMediumSetting::Network))
            .expect("set");
        assert_eq!(
            pins.to_json(),
            serde_json::json!({ HASH_A: "network" }),
            "pin map should serialize as hash -> medium token"
        );
    }
}

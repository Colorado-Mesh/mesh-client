//! Persisted propagation mode (mirrors the renderer Network → Propagation nodes selector).
//!
//! `Off` means no propagation support at all: no outbound Direct→PN cascade and no
//! propagation deposit route. A saved Preferred node stays on disk but is never armed.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PropagationMode {
    /// No propagation node support (renderer default).
    #[default]
    Off,
    Auto,
    Manual,
}

impl PropagationMode {
    pub fn as_str(self) -> &'static str {
        match self {
            PropagationMode::Off => "off",
            PropagationMode::Auto => "auto",
            PropagationMode::Manual => "manual",
        }
    }

    pub fn is_off(self) -> bool {
        matches!(self, PropagationMode::Off)
    }

    pub fn is_auto(self) -> bool {
        matches!(self, PropagationMode::Auto)
    }
}

/// Parse a renderer mode string; unknown values are rejected so a typo cannot
/// silently disable propagation.
pub fn parse_propagation_mode(raw: &str) -> Result<PropagationMode, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "off" => Ok(PropagationMode::Off),
        "auto" => Ok(PropagationMode::Auto),
        "manual" => Ok(PropagationMode::Manual),
        other => Err(format!("unknown propagation mode: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_modes_case_insensitively() {
        assert_eq!(parse_propagation_mode(" Off "), Ok(PropagationMode::Off));
        assert_eq!(parse_propagation_mode("AUTO"), Ok(PropagationMode::Auto));
        assert_eq!(
            parse_propagation_mode("manual"),
            Ok(PropagationMode::Manual)
        );
    }

    #[test]
    fn rejects_unknown_mode() {
        assert!(parse_propagation_mode("sometimes").is_err());
    }

    #[test]
    fn defaults_to_off() {
        assert!(PropagationMode::default().is_off());
        assert_eq!(PropagationMode::default().as_str(), "off");
    }

    #[test]
    fn round_trips_through_json() {
        let json = serde_json::to_string(&PropagationMode::Manual).unwrap();
        assert_eq!(json, "\"manual\"");
        let parsed: PropagationMode = serde_json::from_str("\"auto\"").unwrap();
        assert_eq!(parsed, PropagationMode::Auto);
    }
}

//! Persisted LXMF propagation-node hosting / peering policy.

use serde::{Deserialize, Serialize};

/// Defaults match rsLXMF `RouterConfig` / `RouterConfigExt` / lxmd `[propagation]`.
pub const DEFAULT_PEERING_COST: u8 = 18;
pub const DEFAULT_MAX_PEERING_COST: u8 = 26;
pub const DEFAULT_AUTOPEER: bool = true;
pub const DEFAULT_AUTOPEER_MAXDEPTH: usize = 4;
pub const DEFAULT_MAX_PEERS: usize = 20;
pub const DEFAULT_PROPAGATION_STAMP_COST: u8 = 16;
pub const DEFAULT_PROPAGATION_STAMP_FLEX: u8 = 3;
pub const DEFAULT_MESSAGE_STORAGE_LIMIT_MB: u32 = 256;
pub const DEFAULT_PROPAGATION_LIMIT_KB: usize = 256;
pub const DEFAULT_SYNC_LIMIT_KB: usize = 10_240;
pub const DEFAULT_DELIVERY_LIMIT_KB: usize = 1000;
pub const DEFAULT_PN_ANNOUNCE_INTERVAL_SEC: u32 = 360;
pub const DEFAULT_ANNOUNCE_AT_START: bool = true;

const MAX_AUTOPEER_MAXDEPTH: usize = 64;
const MAX_MAX_PEERS: usize = 256;
const MAX_STORAGE_MB: u32 = 10_240;
const MAX_LIMIT_KB: usize = 102_400;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
#[allow(clippy::struct_excessive_bools)] // mirrors independent LXMF router prefs
pub struct PnHostingPolicy {
    pub peering_cost: u8,
    pub max_peering_cost: u8,
    pub autopeer: bool,
    pub autopeer_maxdepth: usize,
    pub max_peers: usize,
    pub propagation_stamp_cost: u8,
    pub propagation_stamp_flex: u8,
    pub message_storage_limit_mb: u32,
    pub propagation_limit_kb: usize,
    pub sync_limit_kb: usize,
    pub delivery_limit_kb: usize,
    pub from_static_only: bool,
    pub auth_required: bool,
    pub enforce_stamps: bool,
    pub enforce_ratchets: bool,
    pub static_peers: Vec<String>,
    pub node_name: Option<String>,
    pub pn_announce_interval_sec: u32,
    pub announce_at_start: bool,
}

impl Default for PnHostingPolicy {
    fn default() -> Self {
        Self {
            peering_cost: DEFAULT_PEERING_COST,
            max_peering_cost: DEFAULT_MAX_PEERING_COST,
            autopeer: DEFAULT_AUTOPEER,
            autopeer_maxdepth: DEFAULT_AUTOPEER_MAXDEPTH,
            max_peers: DEFAULT_MAX_PEERS,
            propagation_stamp_cost: DEFAULT_PROPAGATION_STAMP_COST,
            propagation_stamp_flex: DEFAULT_PROPAGATION_STAMP_FLEX,
            message_storage_limit_mb: DEFAULT_MESSAGE_STORAGE_LIMIT_MB,
            propagation_limit_kb: DEFAULT_PROPAGATION_LIMIT_KB,
            sync_limit_kb: DEFAULT_SYNC_LIMIT_KB,
            delivery_limit_kb: DEFAULT_DELIVERY_LIMIT_KB,
            from_static_only: false,
            auth_required: false,
            enforce_stamps: false,
            enforce_ratchets: false,
            static_peers: Vec::new(),
            node_name: None,
            pn_announce_interval_sec: DEFAULT_PN_ANNOUNCE_INTERVAL_SEC,
            announce_at_start: DEFAULT_ANNOUNCE_AT_START,
        }
    }
}

impl PnHostingPolicy {
    pub fn validate(&self) -> Result<(), String> {
        if self.peering_cost > self.max_peering_cost {
            return Err("peering_cost_exceeds_max".into());
        }
        if self.propagation_stamp_flex > self.propagation_stamp_cost {
            return Err("stamp_flex_exceeds_cost".into());
        }
        if self.autopeer_maxdepth > MAX_AUTOPEER_MAXDEPTH {
            return Err("autopeer_maxdepth_out_of_range".into());
        }
        if self.max_peers == 0 || self.max_peers > MAX_MAX_PEERS {
            return Err("max_peers_out_of_range".into());
        }
        if self.message_storage_limit_mb == 0 || self.message_storage_limit_mb > MAX_STORAGE_MB {
            return Err("message_storage_limit_out_of_range".into());
        }
        if self.propagation_limit_kb == 0 || self.propagation_limit_kb > MAX_LIMIT_KB {
            return Err("propagation_limit_out_of_range".into());
        }
        if self.sync_limit_kb == 0 || self.sync_limit_kb > MAX_LIMIT_KB {
            return Err("sync_limit_out_of_range".into());
        }
        if self.delivery_limit_kb == 0 || self.delivery_limit_kb > MAX_LIMIT_KB {
            return Err("delivery_limit_out_of_range".into());
        }
        if self.pn_announce_interval_sec > 86_400 {
            return Err("pn_announce_interval_out_of_range".into());
        }
        for peer in &self.static_peers {
            validate_static_peer_hash(peer)?;
        }
        if let Some(name) = &self.node_name {
            let trimmed = name.trim();
            if trimmed.chars().any(char::is_control) {
                return Err("node_name_invalid".into());
            }
            if trimmed.chars().count() > 128 {
                return Err("node_name_too_long".into());
            }
        }
        Ok(())
    }

    /// Clamp and normalize; returns a validated policy or an error for semantic violations.
    pub fn sanitized(mut self) -> Result<Self, String> {
        self.static_peers = self
            .static_peers
            .into_iter()
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect();
        if let Some(name) = self.node_name.take() {
            let trimmed = name.trim().to_string();
            self.node_name = if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            };
        }
        self.validate()?;
        Ok(self)
    }

    pub fn message_storage_limit_bytes(&self) -> usize {
        (self.message_storage_limit_mb as usize).saturating_mul(1024 * 1024)
    }

    pub fn min_stamp_cost(&self) -> u8 {
        self.propagation_stamp_cost
            .saturating_sub(self.propagation_stamp_flex)
    }
}

fn validate_static_peer_hash(hash: &str) -> Result<(), String> {
    let trimmed = hash.trim().to_lowercase();
    if trimmed.len() != 32 || !trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!("static_peer_invalid:{trimmed}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_validate() {
        assert!(PnHostingPolicy::default().validate().is_ok());
    }

    #[test]
    fn rejects_peering_cost_above_max() {
        let policy = PnHostingPolicy {
            peering_cost: 30,
            max_peering_cost: 26,
            ..Default::default()
        };
        assert_eq!(policy.validate().unwrap_err(), "peering_cost_exceeds_max");
    }

    #[test]
    fn rejects_bad_static_peer() {
        let policy = PnHostingPolicy {
            static_peers: vec!["abcd".into()],
            ..Default::default()
        };
        assert!(
            policy
                .validate()
                .unwrap_err()
                .starts_with("static_peer_invalid:")
        );
    }

    #[test]
    fn serde_round_trip_defaults() {
        let json = serde_json::to_string(&PnHostingPolicy::default()).unwrap();
        let parsed: PnHostingPolicy = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, PnHostingPolicy::default());
    }

    #[test]
    fn serde_missing_fields_use_defaults() {
        let parsed: PnHostingPolicy = serde_json::from_str("{}").unwrap();
        assert_eq!(parsed.peering_cost, DEFAULT_PEERING_COST);
        assert_eq!(parsed.max_peering_cost, DEFAULT_MAX_PEERING_COST);
        assert!(parsed.autopeer);
    }
}

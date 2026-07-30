//! Worldwide coordinated + fallback RNode RF profiles (parity with src/shared/reticulumRnodeRfProfiles.json).

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct RfProfile {
    pub id: String,
    pub tier: String,
    pub label: String,
    pub region: String,
    pub frequency: u64,
    pub bandwidth: u32,
    pub spreading_factor: u8,
    pub coding_rate: u8,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub canonical_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RfProfilesFile {
    profiles: Vec<RfProfile>,
}

fn load_profiles() -> Vec<RfProfile> {
    const JSON: &str = include_str!("../../../src/shared/reticulumRnodeRfProfiles.json");
    serde_json::from_str::<RfProfilesFile>(JSON)
        .map(|f| f.profiles)
        .unwrap_or_default()
}

#[allow(dead_code)] // catalog helper; presets use rf_profile_by_id
pub fn all_rf_profiles() -> Vec<RfProfile> {
    load_profiles()
}

pub fn rf_profile_by_id(id: &str) -> Option<RfProfile> {
    load_profiles().into_iter().find(|p| p.id == id)
}

pub fn known_preset_ids() -> Vec<String> {
    load_profiles().into_iter().map(|p| p.id).collect()
}

pub fn presets_wire_json() -> serde_json::Value {
    let profiles = load_profiles();
    let mut coordinated = Vec::new();
    let mut fallback = Vec::new();
    let mut legacy = Vec::new();
    for p in profiles {
        let entry = serde_json::json!({
            "id": p.id,
            "label": p.label,
            "tier": p.tier,
            "region": p.region,
            "frequency": p.frequency,
            "bandwidth": p.bandwidth,
            "spreading_factor": p.spreading_factor,
            "coding_rate": p.coding_rate,
            "notes": p.notes,
            "canonical_id": p.canonical_id,
        });
        match p.tier.as_str() {
            "coordinated" => coordinated.push(entry),
            "fallback" => fallback.push(entry),
            _ => legacy.push(entry),
        }
    }
    let mut all = coordinated.clone();
    all.extend(fallback.clone());
    all.extend(legacy.clone());
    serde_json::json!({
        "coordinated": coordinated,
        "fallback": fallback,
        "legacy": legacy,
        "presets": all,
    })
}

pub fn apply_profile_defaults_to_row(row: &mut crate::stack::types::InterfaceRow) {
    if row.iface_type != "rnode" {
        return;
    }
    let Some(preset_id) = row.preset.as_deref() else {
        return;
    };
    let Some(profile) = rf_profile_by_id(preset_id) else {
        return;
    };
    row.frequency.get_or_insert(profile.frequency);
    row.bandwidth.get_or_insert(profile.bandwidth);
    row.spreading_factor.get_or_insert(profile.spreading_factor);
    row.coding_rate.get_or_insert(profile.coding_rate);
    row.txpower.get_or_insert(17);
}

/// Overwrite RF fields from the row's preset profile (config repair when params deviate).
pub fn force_apply_profile_defaults_to_row(row: &mut crate::stack::types::InterfaceRow) {
    if row.iface_type != "rnode" {
        return;
    }
    let Some(preset_id) = row.preset.as_deref() else {
        return;
    };
    let Some(profile) = rf_profile_by_id(preset_id) else {
        return;
    };
    row.frequency = Some(profile.frequency);
    row.bandwidth = Some(profile.bandwidth);
    row.spreading_factor = Some(profile.spreading_factor);
    row.coding_rate = Some(profile.coding_rate);
    row.txpower = Some(17);
}

pub fn row_params_match_preset(row: &crate::stack::types::InterfaceRow) -> bool {
    let Some(preset_id) = row.preset.as_deref() else {
        return true;
    };
    let Some(profile) = rf_profile_by_id(preset_id) else {
        return true;
    };
    params_match_profile(
        row.frequency,
        row.bandwidth,
        row.spreading_factor,
        row.coding_rate,
        &profile,
    )
}

pub fn params_match_profile(
    frequency: Option<u64>,
    bandwidth: Option<u32>,
    spreading_factor: Option<u8>,
    coding_rate: Option<u8>,
    profile: &RfProfile,
) -> bool {
    frequency == Some(profile.frequency)
        && bandwidth == Some(profile.bandwidth)
        && spreading_factor == Some(profile.spreading_factor)
        && coding_rate.unwrap_or(5) == profile.coding_rate
}

pub fn match_params_to_profile(
    frequency: Option<u64>,
    bandwidth: Option<u32>,
    spreading_factor: Option<u8>,
    coding_rate: Option<u8>,
) -> Option<RfProfile> {
    if frequency.is_none() || bandwidth.is_none() || spreading_factor.is_none() {
        return None;
    }
    load_profiles()
        .into_iter()
        .find(|p| params_match_profile(frequency, bandwidth, spreading_factor, coding_rate, p))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn us_coordinated_is_914875_mhz() {
        let us = rf_profile_by_id("rnode_us").expect("rnode_us");
        assert_eq!(us.frequency, 914_875_000);
        assert_eq!(us.spreading_factor, 8);
    }

    #[test]
    fn legacy_us915_aliases_us_frequency() {
        let legacy = rf_profile_by_id("rnode_us915").expect("rnode_us915");
        let us = rf_profile_by_id("rnode_us").expect("rnode_us");
        assert_eq!(legacy.frequency, us.frequency);
        assert_eq!(legacy.canonical_id.as_deref(), Some("rnode_us"));
    }

    #[test]
    fn eu868_fallback_is_867_2_mhz() {
        let eu = rf_profile_by_id("rnode_eu868").expect("rnode_eu868");
        assert_eq!(eu.frequency, 867_200_000);
    }

    #[test]
    fn force_apply_overwrites_wrong_frequency() {
        let mut row = crate::stack::types::InterfaceRow {
            id: "nv0n2".into(),
            name: "NV0N2".into(),
            iface_type: "rnode".into(),
            enabled: true,
            status: "up".into(),
            host: None,
            port: None,
            preset: Some("rnode_us915".into()),
            serial_port: None,
            frequency: Some(915_000_000),
            bandwidth: Some(125_000),
            txpower: None,
            spreading_factor: Some(8),
            coding_rate: Some(5),
            callsign: None,
            id_interval: None,
            mode: None,
            seed_addresses: Vec::new(),
            discoverable: None,
            latitude: None,
            longitude: None,
            height: None,
            discovery_name: None,
            announce_interval_min: None,
            connectable: None,
            reachable_on: None,
            network_name: None,
            passphrase: None,
            extra_config: std::collections::HashMap::new(),
        };
        assert!(!row_params_match_preset(&row));
        force_apply_profile_defaults_to_row(&mut row);
        assert_eq!(row.frequency, Some(914_875_000));
        assert!(row_params_match_preset(&row));
    }
}

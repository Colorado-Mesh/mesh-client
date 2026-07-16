//! RMAP v4 discovered-interface JSON mapping (rsReticulum DiscoveryStore).

#[cfg(feature = "rns-stack")]
use rns_transport::discovery::{DiscoveredInterface, DiscoveryStatus};

/// Wire row for `GET /api/v1/rmap/discovered` and WS `rmap.discovery` events.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RmapDiscoveredWireRow {
    pub discovery_hash: String,
    pub transport_id: String,
    pub discovery_name: String,
    pub interface_type: String,
    pub latitude: f64,
    pub longitude: f64,
    pub height: f64,
    pub transport_enabled: bool,
    pub reachable_on: Option<String>,
    pub port: Option<u16>,
    pub frequency: Option<u64>,
    pub bandwidth: Option<u64>,
    pub spreading_factor: Option<u8>,
    pub coding_rate: Option<u8>,
    pub modulation: Option<String>,
    pub channel: Option<u16>,
    pub hops: u8,
    pub stamp_value: u8,
    pub discovered: u64,
    pub last_heard: u64,
    pub heard_count: u64,
    pub status: String,
    pub has_coordinates: bool,
}

#[cfg(feature = "rns-stack")]
pub fn wire_row_from_discovered(row: &DiscoveredInterface) -> RmapDiscoveredWireRow {
    let info = &row.info;
    let lat = info.latitude;
    let lon = info.longitude;
    let has_coordinates = is_valid_map_coordinate(lat, lon);
    RmapDiscoveredWireRow {
        discovery_hash: row.filename(),
        transport_id: hex::encode(info.transport_id),
        discovery_name: info.name.clone(),
        interface_type: info.interface_type.clone(),
        latitude: lat,
        longitude: lon,
        height: info.height,
        transport_enabled: info.transport_enabled,
        reachable_on: info.reachable_on.clone(),
        port: info.port,
        frequency: info.frequency,
        bandwidth: info.bandwidth,
        spreading_factor: info.spreading_factor,
        coding_rate: info.coding_rate,
        modulation: info.modulation.clone(),
        channel: info.channel,
        hops: row.hops,
        stamp_value: row.stamp_value,
        discovered: row.discovered,
        last_heard: row.last_heard,
        heard_count: row.heard_count,
        status: discovery_status_str(row.status).into(),
        has_coordinates,
    }
}

#[cfg(not(feature = "rns-stack"))]
pub fn list_discovered_wire_rows(_storage_dir: &std::path::Path) -> Vec<RmapDiscoveredWireRow> {
    Vec::new()
}

#[cfg(feature = "rns-stack")]
pub fn list_discovered_wire_rows_from_store(
    rows: &[DiscoveredInterface],
) -> Vec<RmapDiscoveredWireRow> {
    rows.iter().map(wire_row_from_discovered).collect()
}

#[cfg(feature = "rns-stack")]
fn discovery_status_str(status: Option<DiscoveryStatus>) -> &'static str {
    match status {
        Some(DiscoveryStatus::Available) => "available",
        Some(DiscoveryStatus::Unknown) | None => "unknown",
        Some(DiscoveryStatus::Stale) => "stale",
    }
}

/// Null-island and out-of-range coords are not map markers (matches mesh-client geo rules).
pub fn is_valid_map_coordinate(lat: f64, lon: f64) -> bool {
    if !lat.is_finite() || !lon.is_finite() {
        return false;
    }
    if lat == 0.0 && lon == 0.0 {
        return false;
    }
    (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_valid_map_coordinate_rejects_null_island_and_oob() {
        assert!(!is_valid_map_coordinate(0.0, 0.0));
        assert!(!is_valid_map_coordinate(f64::NAN, 10.0));
        assert!(!is_valid_map_coordinate(91.0, 0.0));
        assert!(is_valid_map_coordinate(40.0, -105.0));
    }

    #[cfg(feature = "rns-stack")]
    #[test]
    fn wire_row_maps_discovery_fields() {
        use rns_transport::discovery::app_data::DiscoveryInfo;

        let row = DiscoveredInterface {
            info: DiscoveryInfo {
                name: "Test Node".into(),
                transport_id: [0xAB; 16],
                interface_type: "RNodeInterface".into(),
                transport_enabled: true,
                latitude: 48.8566,
                longitude: 2.3522,
                height: 35.0,
                frequency: Some(869_525_000),
                bandwidth: Some(125_000),
                spreading_factor: Some(8),
                coding_rate: Some(5),
                ..Default::default()
            },
            network_id: [0xCD; 16],
            hops: 2,
            stamp_value: 14,
            stamp: vec![0; 32],
            discovered: 1_700_000_000,
            last_heard: 1_700_000_100,
            heard_count: 3,
            status: Some(DiscoveryStatus::Available),
        };
        let wire = wire_row_from_discovered(&row);
        assert_eq!(wire.discovery_name, "Test Node");
        assert_eq!(wire.interface_type, "RNodeInterface");
        assert!(wire.has_coordinates);
        assert_eq!(wire.frequency, Some(869_525_000));
        assert_eq!(wire.status, "available");
        assert_eq!(wire.hops, 2);
    }

    #[cfg(feature = "rns-stack")]
    #[test]
    fn wire_row_marks_missing_coords() {
        use rns_transport::discovery::app_data::DiscoveryInfo;

        let row = DiscoveredInterface {
            info: DiscoveryInfo {
                name: "No GPS".into(),
                transport_id: [0x01; 16],
                interface_type: "I2PInterface".into(),
                transport_enabled: false,
                latitude: 0.0,
                longitude: 0.0,
                height: 0.0,
                ..Default::default()
            },
            network_id: [0x02; 16],
            hops: 0,
            stamp_value: 14,
            stamp: vec![],
            discovered: 1,
            last_heard: 1,
            heard_count: 1,
            status: Some(DiscoveryStatus::Unknown),
        };
        let wire = wire_row_from_discovered(&row);
        assert!(!wire.has_coordinates);
    }
}

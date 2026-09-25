//! BLE availability probe and device scan (requires `rns-ble` feature).

use super::types::InterfaceRow;

/// Fill `host_rssi` on online `ble://` RNode rows from the rsReticulum connect/scan cache.
pub fn attach_ble_rnode_host_rssi(rows: &mut [InterfaceRow]) {
    for row in rows.iter_mut() {
        row.host_rssi = None;
        if !row.enabled || row.status != "up" {
            continue;
        }
        let Some(port) = row.serial_port.as_deref() else {
            continue;
        };
        if !port.to_ascii_lowercase().starts_with("ble://") {
            continue;
        }
        let ty = row.iface_type.to_ascii_lowercase();
        if ty != "rnode" && ty != "rnodeinterface" && ty != "rnode multi" && ty != "rnodemulti" {
            continue;
        }
        #[cfg(feature = "rns-ble")]
        {
            row.host_rssi = rns_interface::ble_rnode::cached_host_rssi(port);
        }
    }
}

pub async fn ble_availability() -> serde_json::Value {
    #[cfg(feature = "rns-ble")]
    {
        match probe_ble_adapter().await {
            Ok(()) => serde_json::json!({
                "available": true,
                "missing": [],
                "permissions_granted": true,
                "probe_failed": false
            }),
            Err(reason) => serde_json::json!({
                "available": false,
                "missing": [reason],
                "permissions_granted": false,
                "probe_failed": true
            }),
        }
    }
    #[cfg(not(feature = "rns-ble"))]
    {
        serde_json::json!({
            "available": false,
            "missing": ["rns-ble feature not enabled in this build"],
            "permissions_granted": false,
            "probe_failed": false
        })
    }
}

#[cfg(feature = "rns-ble")]
async fn probe_ble_adapter() -> Result<(), String> {
    rns_interface::ble_rnode::scan_ble_devices(1)
        .await
        .map(|_| ())
}

/// Scan mode query: `peer` (Reticulum mesh), `rnode` (LoRa RNode hardware), or `all`.
pub async fn ble_scan(timeout_secs: u64, mode: &str) -> Result<serde_json::Value, String> {
    #[cfg(feature = "rns-ble")]
    {
        let timeout_secs = timeout_secs.clamp(1, 30);
        let mut devices: Vec<serde_json::Value> = Vec::new();

        if mode == "peer" || mode == "all" {
            let peers = rns_interface::ble_peer::scan_mesh_peers(timeout_secs).await?;
            for peer in peers {
                devices.push(serde_json::json!({
                    "address": peer.ble_address,
                    "name": peer.identity_hash,
                    "rssi": peer.rssi,
                    "kind": "peer",
                    "identity_hash": peer.identity_hash,
                }));
            }
        }

        if mode == "rnode" || mode == "all" {
            let rnodes = rns_interface::ble_rnode::scan_ble_devices(timeout_secs).await?;
            for dev in rnodes {
                devices.push(serde_json::json!({
                    "address": dev.address,
                    "name": dev.name,
                    "rssi": dev.rssi,
                    "kind": "rnode",
                    "bonded": dev.bonded,
                }));
            }
        }

        if mode != "peer" && mode != "rnode" && mode != "all" {
            return Err(format!("invalid scan mode: {mode}"));
        }

        Ok(serde_json::json!({ "devices": devices }))
    }
    #[cfg(not(feature = "rns-ble"))]
    {
        let _ = (timeout_secs, mode);
        Err("BLE feature not enabled in this build".into())
    }
}

#[cfg(test)]
mod host_rssi_attach_tests {
    use super::attach_ble_rnode_host_rssi;
    use crate::stack::types::InterfaceRow;
    use std::collections::HashMap;

    fn ble_rnode_row(status: &str, serial_port: &str) -> InterfaceRow {
        InterfaceRow {
            id: "rnode-1".into(),
            name: "RNode BLE".into(),
            iface_type: "rnode".into(),
            enabled: true,
            status: status.into(),
            host: None,
            port: None,
            preset: None,
            serial_port: Some(serial_port.into()),
            frequency: None,
            bandwidth: None,
            txpower: None,
            spreading_factor: None,
            coding_rate: None,
            callsign: None,
            id_interval: None,
            mode: None,
            runtime_mode: None,
            seed_addresses: Vec::new(),
            discoverable: None,
            latitude: None,
            longitude: None,
            height: None,
            discovery_name: None,
            announce_interval_min: None,
            connectable: None,
            reachable_on: None,
            discovery_lxmf_address: None,
            discovery_stamp_value: None,
            discovery_encrypt: None,
            publish_ifac: None,
            network_name: None,
            passphrase: None,
            flow_control: None,
            ignore_config_warnings: None,
            bootstrap_only: None,
            tx_queue_used: None,
            tx_queue_max: None,
            host_rssi: None,
            extra_config: HashMap::new(),
        }
    }

    #[test]
    fn attach_skips_down_and_non_ble_rows() {
        let mut rows = vec![
            ble_rnode_row("down", "ble://AA:BB:CC:DD:EE:FF"),
            ble_rnode_row("up", "/dev/ttyUSB0"),
        ];
        attach_ble_rnode_host_rssi(&mut rows);
        assert_eq!(rows[0].host_rssi, None);
        assert_eq!(rows[1].host_rssi, None);
    }

    #[cfg(feature = "rns-ble")]
    #[test]
    fn attach_reads_cached_host_rssi_for_online_ble_rnode() {
        rns_interface::ble_rnode::remember_host_rssi("ble://AA:BB:CC:DD:EE:FF", -68);
        let mut rows = vec![ble_rnode_row("up", "ble://AA:BB:CC:DD:EE:FF")];
        attach_ble_rnode_host_rssi(&mut rows);
        assert_eq!(rows[0].host_rssi, Some(-68));
    }
}

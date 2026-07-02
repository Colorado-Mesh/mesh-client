//! BLE availability probe and device scan (requires `rns-ble` feature).

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

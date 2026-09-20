use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};

use crate::stack::{AddInterfaceRequest, StackHandle};

#[derive(Debug, serde::Deserialize)]
pub struct BleScanQuery {
    #[serde(default = "default_ble_scan_timeout")]
    pub timeout_secs: u64,
    #[serde(default = "default_ble_scan_mode")]
    pub mode: String,
}

fn default_ble_scan_timeout() -> u64 {
    5
}

fn default_ble_scan_mode() -> String {
    "all".into()
}

pub async fn list_interfaces(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    let interfaces = stack.list_interfaces().await;
    let (stored, effective) = stack.primary_local_serial_interface_ids().await;
    Json(serde_json::json!({
        "interfaces": interfaces,
        "primary_local_serial_interface_id": stored,
        "effective_primary_local_serial_interface_id": effective,
    }))
}

pub async fn add_interface(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<AddInterfaceRequest>,
) -> Json<serde_json::Value> {
    match stack.add_interface(body).await {
        Ok(row) => Json(serde_json::json!({ "ok": true, "interface": row })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn enable_interface(
    State(stack): State<Arc<StackHandle>>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    match stack.set_interface_enabled(&id, true).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn disable_interface(
    State(stack): State<Arc<StackHandle>>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    match stack.set_interface_enabled(&id, false).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn rnode_presets(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.rnode_presets().await)
}

pub async fn serial_ports(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.serial_ports().await)
}

pub async fn ble_availability(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.ble_availability().await)
}

pub async fn ble_scan(
    State(stack): State<Arc<StackHandle>>,
    Query(query): Query<BleScanQuery>,
) -> Json<serde_json::Value> {
    match stack.ble_scan(query.timeout_secs, &query.mode).await {
        Ok(body) => Json(body),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e, "devices": [] })),
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct BleUnbondBody {
    /// MAC, CoreBluetooth UUID, or `ble://…` URI.
    pub address: String,
    /// Optional OS Bluetooth display name (e.g. `RNode 41F4`). Required on macOS
    /// when `address` is a CoreBluetooth UUID — blueutil cannot unpair by UUID.
    #[serde(default)]
    pub name: Option<String>,
    /// Optional driver error string used to confirm LTK desync classification.
    #[serde(default)]
    pub error: String,
}

/// Classify a BLE failure and, on LTK desync, purge the OS bond then emit `BleLtkDesync`.
pub async fn ble_handle_ltk_desync(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<BleUnbondBody>,
) -> Json<serde_json::Value> {
    let error = if body.error.trim().is_empty() {
        // Callers that already latched Peer-removed may omit the raw string.
        "Peer removed pairing information".to_string()
    } else {
        body.error
    };
    let name = body
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    match crate::ble::handle_ltk_desync_named(&body.address, name, &error).await {
        Ok(result) => {
            stack.emit_event(
                "BleLtkDesync",
                serde_json::json!({
                    "device_address": result.device_address,
                    "bond_purged": result.bond_purged,
                    "message": result.message,
                    "purge_error": result.purge_error,
                }),
            );
            Json(serde_json::json!({
                "ok": true,
                "device_address": result.device_address,
                "bond_purged": result.bond_purged,
                "message": result.message,
                "purge_error": result.purge_error,
            }))
        }
        Err(e) => Json(serde_json::json!({
            "ok": false,
            "error": e.to_string(),
        })),
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct SetPrimaryLocalRnodeRequest {
    pub id: String,
}

pub async fn set_primary_local_rnode(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<SetPrimaryLocalRnodeRequest>,
) -> Json<serde_json::Value> {
    match stack.set_primary_local_serial_interface(&body.id).await {
        Ok((reordered, effective_id)) => Json(serde_json::json!({
            "ok": true,
            "reordered": reordered,
            "effective_id": effective_id,
        })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

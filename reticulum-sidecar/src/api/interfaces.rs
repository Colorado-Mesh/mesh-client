use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;

use crate::stack::{AddInterfaceRequest, StackHandle};

pub async fn list_interfaces(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    let interfaces = stack.list_interfaces().await;
    Json(serde_json::json!({ "interfaces": interfaces }))
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

use std::sync::Arc;

use axum::Json;
use axum::extract::{Query, State};

use crate::stack::StackHandle;

pub async fn stack_restart(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    match stack.request_stack_restart().await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn factory_reset(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    match stack.factory_reset().await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn diagnostics(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.diagnostics_snapshot().await)
}

pub async fn list_identities(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.list_identities().await)
}

pub async fn create_identity(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let display_name = body
        .get("display_name")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    match stack.create_identity_slot(display_name).await {
        Ok(v) => Json(v),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn switch_identity(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let Some(id) = body.get("identity_id").and_then(|v| v.as_str()) else {
        return Json(serde_json::json!({ "ok": false, "error": "identity_id required" }));
    };
    match stack.switch_identity(id).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn delete_identity(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    let Some(id) = body.get("identity_id").and_then(|v| v.as_str()) else {
        return Json(serde_json::json!({ "ok": false, "error": "identity_id required" }));
    };
    match stack.delete_identity_slot(id).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn topology(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.topology_snapshot().await)
}

pub async fn clear_announces(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    match stack.clear_announces().await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn announce_now(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    match stack.announce_now().await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

#[derive(serde::Deserialize)]
pub struct PacketListQuery {
    #[serde(default = "default_packet_limit")]
    pub limit: usize,
}

fn default_packet_limit() -> usize {
    500
}

pub async fn list_packets(
    State(stack): State<Arc<StackHandle>>,
    Query(query): Query<PacketListQuery>,
) -> Json<serde_json::Value> {
    let limit = query.limit.clamp(1, 2500);
    Json(serde_json::json!({ "packets": stack.list_packets(limit) }))
}

pub async fn clear_packets(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    stack.clear_packets();
    Json(serde_json::json!({ "ok": true }))
}

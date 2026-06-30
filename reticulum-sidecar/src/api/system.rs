use std::sync::Arc;

use axum::Json;
use axum::extract::State;

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

pub async fn voice_status(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.voice_status().await)
}

pub async fn games_status(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.games_status().await)
}

pub async fn list_identities(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.list_identities().await)
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

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use serde::Deserialize;

use crate::stack::StackHandle;

#[derive(Debug, Deserialize)]
pub struct PropagationSyncBody {
    pub propagation_id: String,
}

pub async fn list_propagation(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.list_propagation().await)
}

pub async fn set_preferred_propagation(
    State(stack): State<Arc<StackHandle>>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    match stack.set_preferred_propagation(&id).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn start_propagation_sync(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<PropagationSyncBody>,
) -> Json<serde_json::Value> {
    match stack.start_propagation_sync(&body.propagation_id).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn cancel_propagation_sync(
    State(stack): State<Arc<StackHandle>>,
) -> Json<serde_json::Value> {
    match stack.cancel_propagation_sync().await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn enable_propagation(
    State(stack): State<Arc<StackHandle>>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    match stack.set_propagation_enabled(&id, true).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn disable_propagation(
    State(stack): State<Arc<StackHandle>>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    match stack.set_propagation_enabled(&id, false).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

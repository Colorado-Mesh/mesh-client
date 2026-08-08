use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use serde::Deserialize;

use crate::stack::StackHandle;

#[derive(Debug, Deserialize)]
pub struct PropagationAutoSyncIntervalBody {
    pub interval_sec: u32,
}

#[derive(Debug, Deserialize)]
pub struct PropagationModeBody {
    /// `off` | `auto` | `manual` (renderer Network → Propagation nodes selector).
    pub mode: String,
}

#[derive(Debug, Deserialize)]
pub struct PropagationSyncBody {
    /// Configured list id (`local-prop` or `pn-…`). Mutually exclusive with `destination_hash`.
    #[serde(default)]
    pub propagation_id: Option<String>,
    /// One-time sync by LXMF propagation destination hash (32 hex). Does not add to the
    /// configured list or change Preferred. Mutually exclusive with `propagation_id`.
    #[serde(default)]
    pub destination_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddPropagationBody {
    pub destination_hash: String,
    pub name: Option<String>,
    #[serde(default)]
    pub skip_probe: bool,
}

#[derive(Debug, Deserialize)]
pub struct RenamePropagationBody {
    pub name: String,
}

pub async fn set_pn_hosting_policy(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<crate::stack::PnHostingPolicy>,
) -> Json<serde_json::Value> {
    match stack.set_pn_hosting_policy(body).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn add_propagation_node(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<AddPropagationBody>,
) -> Json<serde_json::Value> {
    match stack
        .add_propagation_node(&body.destination_hash, body.name, body.skip_probe)
        .await
    {
        Ok(res) => Json(res),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn remove_propagation_node(
    State(stack): State<Arc<StackHandle>>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    match stack.remove_propagation_node(&id).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn rename_propagation_node(
    State(stack): State<Arc<StackHandle>>,
    Path(id): Path<String>,
    Json(body): Json<RenamePropagationBody>,
) -> Json<serde_json::Value> {
    match stack.rename_propagation_node(&id, &body.name).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn list_propagation(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.list_propagation().await)
}

pub async fn list_discovered_propagation(
    State(stack): State<Arc<StackHandle>>,
) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "discovered": stack.list_discovered_propagation(),
    }))
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

pub async fn set_propagation_auto_sync_interval(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<PropagationAutoSyncIntervalBody>,
) -> Json<serde_json::Value> {
    match stack
        .set_propagation_auto_sync_interval(body.interval_sec)
        .await
    {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn set_propagation_mode(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<PropagationModeBody>,
) -> Json<serde_json::Value> {
    match stack.set_propagation_mode(&body.mode).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn start_propagation_sync(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<PropagationSyncBody>,
) -> Json<serde_json::Value> {
    let id = body
        .propagation_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let hash = body
        .destination_hash
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let result = match (id, hash) {
        (Some(propagation_id), None) => stack.start_propagation_sync(propagation_id).await,
        (None, Some(destination_hash)) => {
            stack.start_propagation_sync_by_hash(destination_hash).await
        }
        (Some(_), Some(_)) => {
            Err("provide exactly one of propagation_id or destination_hash".into())
        }
        (None, None) => Err("propagation_id or destination_hash required".into()),
    };
    match result {
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

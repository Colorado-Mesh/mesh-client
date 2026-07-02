use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};

use crate::stack::{LxmfReactionRequest, LxmfResourceRequest, LxmfSendRequest, StackHandle};

pub async fn lxmf_send(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<LxmfSendRequest>,
) -> Json<serde_json::Value> {
    match stack.lxmf_send(body).await {
        Ok(payload) => Json(serde_json::json!({ "ok": true, "message": payload })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn lxmf_reaction(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<LxmfReactionRequest>,
) -> Json<serde_json::Value> {
    match stack.lxmf_reaction(body).await {
        Ok(payload) => Json(serde_json::json!({ "ok": true, "message": payload })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn list_contacts(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    let contacts = stack.list_contacts().await;
    Json(serde_json::json!({ "contacts": contacts }))
}

pub async fn list_peers(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    let peers = stack.list_peers().await;
    Json(serde_json::json!({ "peers": peers }))
}

#[derive(Debug, serde::Deserialize)]
pub struct PingBody {
    pub destination_hash: String,
}

pub async fn ping(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<PingBody>,
) -> Json<serde_json::Value> {
    match stack.ping_destination(&body.destination_hash).await {
        Ok(res) => Json(res),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn peer_path(
    State(stack): State<Arc<StackHandle>>,
    Path(hash): Path<String>,
) -> Json<serde_json::Value> {
    match stack.request_peer_path(&hash).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn peer_probe(
    State(stack): State<Arc<StackHandle>>,
    Path(hash): Path<String>,
) -> Json<serde_json::Value> {
    match stack.probe_peer(&hash).await {
        Ok(res) => Json(res),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn lxmf_send_resource(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<LxmfResourceRequest>,
) -> Json<serde_json::Value> {
    match stack.lxmf_send_resource(body).await {
        Ok(payload) => Json(serde_json::json!({ "ok": true, "message": payload })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn lxmf_delete_message(
    State(stack): State<Arc<StackHandle>>,
    Path(hash): Path<String>,
) -> Json<serde_json::Value> {
    match stack.lxmf_delete_message(&hash).await {
        Ok(removed) => Json(serde_json::json!({ "ok": true, "removed": removed })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

//! LRGP (Lightweight Reticulum Gaming Protocol) game HTTP API.

use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use serde::Deserialize;

use crate::api::validate::{MAX_DEST_HASH_CHARS, reject_oversize};
use crate::stack::StackHandle;

fn reject_oversize_session_id(session_id: &str) -> Option<String> {
    reject_oversize("session_id", session_id, MAX_DEST_HASH_CHARS)
}

fn oversize_rejection(err: &str) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": false, "error": err }))
}

pub async fn games_status(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.games_status().await)
}

pub async fn games_apps(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.games_apps().await)
}

#[derive(Debug, Deserialize)]
pub struct GamesSessionsQuery {
    #[serde(default)]
    pub peer: Option<String>,
}

pub async fn games_sessions(
    State(stack): State<Arc<StackHandle>>,
    Query(query): Query<GamesSessionsQuery>,
) -> Json<serde_json::Value> {
    Json(stack.games_sessions(query.peer.as_deref()).await)
}

pub async fn games_session_detail(
    State(stack): State<Arc<StackHandle>>,
    Path(session_id): Path<String>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize_session_id(&session_id) {
        return oversize_rejection(&err);
    }
    Json(stack.games_session_detail(&session_id).await)
}

#[derive(Debug, Deserialize)]
pub struct GameActionBody {
    pub dest_hash: String,
    pub app_id: String,
    pub command: String,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub payload: Option<serde_json::Value>,
    /// Accepted for API forward-compatibility; delivery method is currently
    /// auto-selected (Direct-preferred, Propagated fallback) like chat sends.
    #[serde(default)]
    pub delivery_method: Option<String>,
}

pub async fn games_action(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<GameActionBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize("dest_hash", &body.dest_hash, MAX_DEST_HASH_CHARS) {
        return oversize_rejection(&err);
    }
    if let Some(err) = reject_oversize("app_id", &body.app_id, MAX_DEST_HASH_CHARS) {
        return oversize_rejection(&err);
    }
    if let Some(err) = reject_oversize("command", &body.command, MAX_DEST_HASH_CHARS) {
        return oversize_rejection(&err);
    }
    if let Some(session_id) = body.session_id.as_deref() {
        if let Some(err) = reject_oversize_session_id(session_id) {
            return oversize_rejection(&err);
        }
    }
    tracing::debug!(
        target: "games",
        requested_delivery_method = ?body.delivery_method,
        "game action delivery method hint (auto-selected)"
    );
    match stack
        .games_send_action(
            &body.dest_hash,
            &body.app_id,
            &body.command,
            body.session_id.as_deref(),
            body.payload.as_ref(),
        )
        .await
    {
        Ok(payload) => Json(payload),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn games_session_resend(
    State(stack): State<Arc<StackHandle>>,
    Path(session_id): Path<String>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize_session_id(&session_id) {
        return oversize_rejection(&err);
    }
    match stack.games_resend_action(&session_id).await {
        Ok(payload) => Json(payload),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn games_session_read(
    State(stack): State<Arc<StackHandle>>,
    Path(session_id): Path<String>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize_session_id(&session_id) {
        return oversize_rejection(&err);
    }
    match stack.games_mark_read(&session_id).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn games_session_delete(
    State(stack): State<Arc<StackHandle>>,
    Path(session_id): Path<String>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize_session_id(&session_id) {
        return oversize_rejection(&err);
    }
    match stack.games_delete_session(&session_id).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

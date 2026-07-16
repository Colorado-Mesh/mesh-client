use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::Deserialize;

use crate::stack::StackHandle;

#[derive(Debug, Deserialize)]
pub struct RrcUpsertHubBody {
    pub dest_hash: String,
    pub label: Option<String>,
    pub favorited: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct RrcFavoriteBody {
    pub dest_hash: String,
    pub favorited: bool,
}

#[derive(Debug, Deserialize)]
pub struct RrcConnectBody {
    pub dest_hash: String,
    pub nickname: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RrcRoomBody {
    pub room: String,
    pub key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RrcSendBody {
    pub room: Option<String>,
    pub body: String,
    #[serde(rename = "type")]
    pub msg_type: Option<String>,
    /// When set, send rrcd direct NOTICE (K_DST); room must be omitted.
    pub dst_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RrcNickBody {
    pub nickname: String,
}

pub async fn list_rrc_hubs(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    let hubs = stack.list_rrc_hubs().await;
    Json(serde_json::json!({ "hubs": hubs }))
}

pub async fn upsert_rrc_hub(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RrcUpsertHubBody>,
) -> Json<serde_json::Value> {
    match stack
        .upsert_rrc_hub(&body.dest_hash, body.label, body.favorited)
        .await
    {
        Ok(hub) => Json(serde_json::json!({ "ok": true, "hub": hub })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn favorite_rrc_hub(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RrcFavoriteBody>,
) -> Json<serde_json::Value> {
    match stack.set_rrc_favorite(&body.dest_hash, body.favorited).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn rrc_connect(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RrcConnectBody>,
) -> Json<serde_json::Value> {
    Json(stack.rrc_connect(&body.dest_hash, body.nickname).await)
}

pub async fn rrc_disconnect(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.rrc_disconnect().await)
}

pub async fn rrc_status(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.rrc_status().await)
}

pub async fn rrc_join(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RrcRoomBody>,
) -> Json<serde_json::Value> {
    Json(stack.rrc_join(&body.room, body.key.as_deref()).await)
}

pub async fn rrc_part(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RrcRoomBody>,
) -> Json<serde_json::Value> {
    Json(stack.rrc_part(&body.room).await)
}

pub async fn rrc_send(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RrcSendBody>,
) -> Json<serde_json::Value> {
    Json(
        stack
            .rrc_send(
                body.room.as_deref(),
                &body.body,
                body.msg_type.as_deref(),
                body.dst_hash.as_deref(),
            )
            .await,
    )
}

pub async fn rrc_set_nick(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RrcNickBody>,
) -> Json<serde_json::Value> {
    Json(stack.rrc_set_nick(&body.nickname).await)
}

pub async fn rrc_rooms(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.rrc_rooms().await)
}

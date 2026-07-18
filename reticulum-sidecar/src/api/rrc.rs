use std::sync::Arc;

use axum::Json;
use axum::extract::{Query, State};
use serde::Deserialize;

use crate::api::validate::reject_oversize;
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

/// `dest_hash: None` (or empty) tears down every tracked hub session.
#[derive(Debug, Deserialize)]
pub struct RrcDisconnectBody {
    pub dest_hash: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RrcRoomBody {
    pub hub_dest_hash: String,
    pub room: String,
    pub key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RrcSendBody {
    pub hub_dest_hash: String,
    pub room: Option<String>,
    pub body: String,
    #[serde(rename = "type")]
    pub msg_type: Option<String>,
    /// When set, send rrcd direct NOTICE (K_DST); room must be omitted.
    pub dst_hash: Option<String>,
}

/// `hub_dest_hash: None` sets the nickname on every tracked hub session.
#[derive(Debug, Deserialize)]
pub struct RrcNickBody {
    pub hub_dest_hash: Option<String>,
    pub nickname: String,
}

/// `hub_dest_hash: None` (or empty) aggregates rooms across every hub.
#[derive(Debug, Deserialize, Default)]
pub struct RrcRoomsQuery {
    pub hub_dest_hash: Option<String>,
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
    match stack
        .set_rrc_favorite(&body.dest_hash, body.favorited)
        .await
    {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

/// Field length limits for RRC HTTP bodies (UTF-8 character count).
const MAX_NICK_CHARS: usize = 64;
const MAX_ROOM_CHARS: usize = 128;
const MAX_ROOM_KEY_CHARS: usize = 128;
const MAX_BODY_CHARS: usize = 8_192;

pub async fn rrc_connect(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RrcConnectBody>,
) -> Json<serde_json::Value> {
    if let Some(nick) = body.nickname.as_deref() {
        if let Some(err) = reject_oversize("nickname", nick, MAX_NICK_CHARS) {
            return Json(serde_json::json!({ "ok": false, "error": err }));
        }
    }
    Json(stack.rrc_connect(&body.dest_hash, body.nickname).await)
}

pub async fn rrc_disconnect(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RrcDisconnectBody>,
) -> Json<serde_json::Value> {
    let dest_hash = body.dest_hash.as_deref().filter(|h| !h.trim().is_empty());
    Json(stack.rrc_disconnect(dest_hash).await)
}

pub async fn rrc_status(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.rrc_status().await)
}

pub async fn rrc_join(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RrcRoomBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize("room", &body.room, MAX_ROOM_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    if let Some(key) = body.key.as_deref() {
        if let Some(err) = reject_oversize("room key", key, MAX_ROOM_KEY_CHARS) {
            return Json(serde_json::json!({ "ok": false, "error": err }));
        }
    }
    Json(
        stack
            .rrc_join(&body.hub_dest_hash, &body.room, body.key.as_deref())
            .await,
    )
}

pub async fn rrc_part(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RrcRoomBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize("room", &body.room, MAX_ROOM_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    Json(stack.rrc_part(&body.hub_dest_hash, &body.room).await)
}

pub async fn rrc_send(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RrcSendBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize("body", &body.body, MAX_BODY_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    if let Some(room) = body.room.as_deref() {
        if let Some(err) = reject_oversize("room", room, MAX_ROOM_CHARS) {
            return Json(serde_json::json!({ "ok": false, "error": err }));
        }
    }
    Json(
        stack
            .rrc_send(
                &body.hub_dest_hash,
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
    if let Some(err) = reject_oversize("nickname", &body.nickname, MAX_NICK_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    let hub_dest_hash = body
        .hub_dest_hash
        .as_deref()
        .filter(|h| !h.trim().is_empty());
    Json(stack.rrc_set_nick(hub_dest_hash, &body.nickname).await)
}

pub async fn rrc_rooms(
    State(stack): State<Arc<StackHandle>>,
    Query(query): Query<RrcRoomsQuery>,
) -> Json<serde_json::Value> {
    let hub_dest_hash = query
        .hub_dest_hash
        .as_deref()
        .filter(|h| !h.trim().is_empty());
    Json(stack.rrc_rooms(hub_dest_hash).await)
}

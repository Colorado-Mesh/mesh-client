use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use base64::Engine as _;
use serde::Deserialize;

use crate::api::validate::{MAX_DEST_HASH_CHARS, reject_oversize};
use crate::stack::StackHandle;

/// Field length limits for rnsh HTTP bodies.
const MAX_SESSION_ID_CHARS: usize = 64;
/// One rnsh input chunk; generous for paste-bursts while bounding request size
/// well under the router's 4 MiB body limit.
const MAX_INPUT_CHARS: usize = 262_144;

#[derive(Debug, Deserialize)]
pub struct RnshConnectBody {
    pub destination_hash: String,
}

#[derive(Debug, Deserialize)]
pub struct RnshInputBody {
    pub session_id: String,
    pub data: String,
    /// `"base64"` decodes `data`; any other value (or omitted) sends `data`
    /// as literal UTF-8 bytes.
    #[serde(default)]
    pub encoding: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RnshResizeBody {
    pub session_id: String,
    pub rows: Option<u32>,
    pub cols: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct RnshDisconnectBody {
    pub session_id: String,
}

pub async fn rnsh_connect(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RnshConnectBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize(
        "destination_hash",
        &body.destination_hash,
        MAX_DEST_HASH_CHARS,
    ) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    Json(stack.rnsh_connect(&body.destination_hash).await)
}

pub async fn rnsh_input(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RnshInputBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize("session_id", &body.session_id, MAX_SESSION_ID_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    if let Some(err) = reject_oversize("data", &body.data, MAX_INPUT_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    let bytes = if body.encoding.as_deref() == Some("base64") {
        match base64::engine::general_purpose::STANDARD.decode(body.data.as_bytes()) {
            Ok(decoded) => decoded,
            Err(e) => {
                return Json(serde_json::json!({
                    "ok": false,
                    "error": format!("invalid base64 data: {e}"),
                }));
            }
        }
    } else {
        body.data.into_bytes()
    };
    Json(stack.rnsh_input(&body.session_id, bytes).await)
}

pub async fn rnsh_resize(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RnshResizeBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize("session_id", &body.session_id, MAX_SESSION_ID_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    Json(
        stack
            .rnsh_resize(&body.session_id, body.rows, body.cols)
            .await,
    )
}

pub async fn rnsh_disconnect(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RnshDisconnectBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize("session_id", &body.session_id, MAX_SESSION_ID_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    Json(stack.rnsh_disconnect(&body.session_id).await)
}

pub async fn rnsh_status(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.rnsh_status().await)
}

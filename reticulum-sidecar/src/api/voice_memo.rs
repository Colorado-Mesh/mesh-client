//! Voice memo encode HTTP endpoints (dedicated IPC; not generic proxy).

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::Deserialize;

use crate::api::validate::{MAX_DEST_HASH_CHARS, reject_oversize};
use crate::stack::StackHandle;

const MAX_SAMPLES_B64_CHARS: usize = 512 * 1024;
const MAX_SESSION_ID_CHARS: usize = 64;

#[derive(Debug, Deserialize)]
pub struct VoiceMemoSessionBody {
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
pub struct VoiceMemoAudioBody {
    pub session_id: String,
    #[serde(default = "default_channels")]
    pub channels: u8,
    pub samples_b64: String,
}

fn default_channels() -> u8 {
    1
}

pub async fn voice_memo_start(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.voice_memo_start())
}

pub async fn voice_memo_audio(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<VoiceMemoAudioBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize("session_id", &body.session_id, MAX_SESSION_ID_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    if let Some(err) = reject_oversize("samples_b64", &body.samples_b64, MAX_SAMPLES_B64_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    Json(stack.voice_memo_audio(&body.session_id, body.channels, &body.samples_b64))
}

pub async fn voice_memo_stop(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<VoiceMemoSessionBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize("session_id", &body.session_id, MAX_SESSION_ID_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    // Reuse dest-hash char budget as a generic short-id cap when session_id is huge.
    let _ = MAX_DEST_HASH_CHARS;
    Json(stack.voice_memo_stop(&body.session_id))
}

pub async fn voice_memo_cancel(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<VoiceMemoSessionBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize("session_id", &body.session_id, MAX_SESSION_ID_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    Json(stack.voice_memo_cancel(&body.session_id))
}

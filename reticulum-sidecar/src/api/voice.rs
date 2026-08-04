use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::Deserialize;

use crate::api::validate::{MAX_DEST_HASH_CHARS, reject_oversize};
use crate::stack::StackHandle;

const MAX_SAMPLES_B64_CHARS: usize = 512 * 1024;

#[derive(Debug, Deserialize)]
pub struct VoiceCallBody {
    pub identity_hash: String,
}

#[derive(Debug, Deserialize)]
pub struct VoiceMuteBody {
    pub muted: bool,
}

#[derive(Debug, Deserialize)]
pub struct VoiceAudioBody {
    #[serde(default)]
    pub profile: Option<u32>,
    #[serde(default = "default_channels")]
    pub channels: u8,
    pub samples_b64: String,
}

fn default_channels() -> u8 {
    1
}

pub async fn voice_status(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.voice_status().await)
}

pub async fn voice_call(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<VoiceCallBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize("identity_hash", &body.identity_hash, MAX_DEST_HASH_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    Json(stack.voice_call(&body.identity_hash).await)
}

pub async fn voice_answer(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.voice_answer().await)
}

pub async fn voice_reject(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.voice_reject().await)
}

pub async fn voice_hangup(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.voice_hangup().await)
}

pub async fn voice_mute(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<VoiceMuteBody>,
) -> Json<serde_json::Value> {
    Json(stack.voice_mute(body.muted).await)
}

pub async fn voice_audio(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<VoiceAudioBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize("samples_b64", &body.samples_b64, MAX_SAMPLES_B64_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    Json(
        stack
            .voice_audio(body.profile, body.channels, &body.samples_b64)
            .await,
    )
}

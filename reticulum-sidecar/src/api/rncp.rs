use std::sync::Arc;

use axum::Json;
use serde::Deserialize;

use axum::extract::State;

use crate::api::validate::{MAX_DEST_HASH_CHARS, reject_oversize, reject_oversize_list};
use crate::stack::StackHandle;

/// Field length limits for rncp HTTP bodies.
const MAX_TRANSFER_ID_CHARS: usize = 64;
/// Local/remote path fields never carry file contents — only a filesystem
/// path string — so a generous but bounded cap is enough to stop abuse.
const MAX_PATH_CHARS: usize = 4_096;
const MAX_ALLOWED_LIST_LEN: usize = 256;

#[derive(Debug, Deserialize)]
pub struct RncpSendBody {
    pub destination_hash: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct RncpFetchBody {
    pub destination_hash: String,
    pub remote_path: String,
    pub save_path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RncpTransferIdBody {
    pub transfer_id: String,
}

#[derive(Debug, Deserialize)]
pub struct RncpListenerBody {
    pub enabled: bool,
    pub save_dir: Option<String>,
    #[serde(default)]
    pub allow_fetch: bool,
    pub fetch_jail: Option<String>,
    #[serde(default)]
    pub overwrite: bool,
    #[serde(default)]
    pub allowed: Vec<String>,
    #[serde(default)]
    pub blocked: Vec<String>,
}

fn reject_oversize_list_hashes(label: &str, values: &[String]) -> Option<String> {
    reject_oversize_list(label, values, MAX_ALLOWED_LIST_LEN, MAX_DEST_HASH_CHARS)
}

pub async fn rncp_send(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RncpSendBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize(
        "destination_hash",
        &body.destination_hash,
        MAX_DEST_HASH_CHARS,
    ) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    if let Some(err) = reject_oversize("path", &body.path, MAX_PATH_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    Json(stack.rncp_send(&body.destination_hash, &body.path).await)
}

pub async fn rncp_fetch(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RncpFetchBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize(
        "destination_hash",
        &body.destination_hash,
        MAX_DEST_HASH_CHARS,
    ) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    if let Some(err) = reject_oversize("remote_path", &body.remote_path, MAX_PATH_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    if let Some(save_path) = body.save_path.as_deref() {
        if let Some(err) = reject_oversize("save_path", save_path, MAX_PATH_CHARS) {
            return Json(serde_json::json!({ "ok": false, "error": err }));
        }
    }
    Json(
        stack
            .rncp_fetch(&body.destination_hash, &body.remote_path, body.save_path)
            .await,
    )
}

pub async fn rncp_cancel(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RncpTransferIdBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize("transfer_id", &body.transfer_id, MAX_TRANSFER_ID_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    Json(stack.rncp_cancel(&body.transfer_id).await)
}

pub async fn rncp_accept(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RncpTransferIdBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize("transfer_id", &body.transfer_id, MAX_TRANSFER_ID_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    Json(stack.rncp_accept(&body.transfer_id).await)
}

pub async fn rncp_reject(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RncpTransferIdBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize("transfer_id", &body.transfer_id, MAX_TRANSFER_ID_CHARS) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    Json(stack.rncp_reject(&body.transfer_id).await)
}

pub async fn rncp_status(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.rncp_status().await)
}

pub async fn get_rncp_listener(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.rncp_listener_status().await)
}

pub async fn set_rncp_listener(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<RncpListenerBody>,
) -> Json<serde_json::Value> {
    if let Some(save_dir) = body.save_dir.as_deref() {
        if let Some(err) = reject_oversize("save_dir", save_dir, MAX_PATH_CHARS) {
            return Json(serde_json::json!({ "ok": false, "error": err }));
        }
    }
    if let Some(fetch_jail) = body.fetch_jail.as_deref() {
        if let Some(err) = reject_oversize("fetch_jail", fetch_jail, MAX_PATH_CHARS) {
            return Json(serde_json::json!({ "ok": false, "error": err }));
        }
    }
    if let Some(err) = reject_oversize_list_hashes("allowed", &body.allowed) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    if let Some(err) = reject_oversize_list_hashes("blocked", &body.blocked) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    Json(
        stack
            .rncp_set_listener(
                body.enabled,
                body.save_dir,
                body.allow_fetch,
                body.fetch_jail,
                body.overwrite,
                body.allowed,
                body.blocked,
            )
            .await,
    )
}

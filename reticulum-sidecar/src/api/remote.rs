//! rnsh/rncp path-capability gating and self-identity lookup.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::Deserialize;

use crate::api::validate::{MAX_DEST_HASH_CHARS, reject_oversize};
use crate::stack::StackHandle;

#[derive(Debug, Deserialize)]
pub struct PathCapabilityBody {
    pub destination_hash: String,
}

pub async fn path_capability(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<PathCapabilityBody>,
) -> Json<serde_json::Value> {
    if let Some(err) = reject_oversize(
        "destination_hash",
        &body.destination_hash,
        MAX_DEST_HASH_CHARS,
    ) {
        return Json(serde_json::json!({ "ok": false, "error": err }));
    }
    Json(stack.path_capability(&body.destination_hash))
}

pub async fn remote_identity(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.remote_identity().await)
}

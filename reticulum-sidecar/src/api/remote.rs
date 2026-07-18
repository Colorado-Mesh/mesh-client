//! rnsh/rncp path-capability gating and self-identity lookup.

use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use serde::Deserialize;

use crate::stack::StackHandle;

const MAX_DEST_HASH_CHARS: usize = 64;

#[derive(Debug, Deserialize)]
pub struct PathCapabilityBody {
    pub destination_hash: String,
}

pub async fn path_capability(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<PathCapabilityBody>,
) -> Json<serde_json::Value> {
    if body.destination_hash.chars().count() > MAX_DEST_HASH_CHARS {
        return Json(serde_json::json!({
            "ok": false,
            "error": format!(
                "destination_hash exceeds maximum length of {MAX_DEST_HASH_CHARS} characters"
            ),
        }));
    }
    Json(stack.path_capability(&body.destination_hash))
}

pub async fn remote_identity(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    Json(stack.remote_identity().await)
}

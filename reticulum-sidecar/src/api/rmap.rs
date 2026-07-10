use std::sync::Arc;

use axum::Json;
use axum::extract::State;

use crate::stack::StackHandle;

pub async fn list_rmap_discovered(
    State(stack): State<Arc<StackHandle>>,
) -> Json<serde_json::Value> {
    let rows = stack.list_rmap_discovered().await;
    Json(serde_json::json!({ "discovered": rows }))
}

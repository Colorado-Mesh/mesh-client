use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use serde::Deserialize;

use crate::stack::StackHandle;

#[derive(Debug, Deserialize)]
pub struct NomadFavoriteBody {
    pub destination_hash: String,
    pub favorited: bool,
}

pub async fn list_nomad_nodes(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    let nodes = stack.list_nomad_nodes().await;
    Json(serde_json::json!({ "nodes": nodes }))
}

pub async fn favorite_nomad_node(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<NomadFavoriteBody>,
) -> Json<serde_json::Value> {
    match stack
        .set_nomad_favorite(&body.destination_hash, body.favorited)
        .await
    {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn get_nomad_page(
    State(stack): State<Arc<StackHandle>>,
    Path((hash, path)): Path<(String, String)>,
) -> Json<serde_json::Value> {
    Json(stack.nomad_page(&hash, &path).await)
}

pub async fn get_nomad_file(
    State(stack): State<Arc<StackHandle>>,
    Path(hash): Path<String>,
) -> Json<serde_json::Value> {
    Json(stack.nomad_file(&hash).await)
}

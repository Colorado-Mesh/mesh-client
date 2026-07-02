use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
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

#[derive(Debug, Deserialize)]
pub struct NomadPageQuery {
    pub path: String,
}

pub async fn get_nomad_page(
    State(stack): State<Arc<StackHandle>>,
    Path(hash): Path<String>,
    Query(query): Query<NomadPageQuery>,
) -> Json<serde_json::Value> {
    Json(stack.nomad_page(&hash, &query.path).await)
}

#[derive(Debug, Deserialize)]
pub struct NomadFileQuery {
    pub path: String,
}

pub async fn get_nomad_file(
    State(stack): State<Arc<StackHandle>>,
    Path(hash): Path<String>,
    Query(query): Query<NomadFileQuery>,
) -> Json<serde_json::Value> {
    Json(stack.nomad_file(&hash, &query.path).await)
}

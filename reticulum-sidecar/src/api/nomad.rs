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
    pub data: Option<String>,
}

pub async fn get_nomad_page(
    State(stack): State<Arc<StackHandle>>,
    Path(hash): Path<String>,
    Query(query): Query<NomadPageQuery>,
) -> Json<serde_json::Value> {
    Json(
        stack
            .nomad_page(&hash, &query.path, query.data.as_deref())
            .await,
    )
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

pub async fn get_nomad_serving(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    let status = stack.nomad_serving_status().await;
    Json(serde_json::json!({ "ok": true, "serving": status }))
}

#[derive(Debug, Deserialize)]
pub struct NomadServingPutBody {
    pub enabled: bool,
    pub display_name: Option<String>,
}

pub async fn put_nomad_serving(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<NomadServingPutBody>,
) -> Json<serde_json::Value> {
    match stack
        .set_nomad_serving(body.enabled, body.display_name)
        .await
    {
        Ok(serving) => Json(serde_json::json!({ "ok": true, "serving": serving })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn list_nomad_serving_pages(
    State(stack): State<Arc<StackHandle>>,
) -> Json<serde_json::Value> {
    match stack.list_nomad_serving_pages().await {
        Ok(pages) => Json(serde_json::json!({ "ok": true, "pages": pages })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

#[derive(Debug, Deserialize)]
pub struct NomadServingPageQuery {
    pub path: String,
}

pub async fn get_nomad_serving_page(
    State(stack): State<Arc<StackHandle>>,
    Query(query): Query<NomadServingPageQuery>,
) -> Json<serde_json::Value> {
    match stack.read_nomad_serving_page(&query.path).await {
        Ok(content) => {
            Json(serde_json::json!({ "ok": true, "path": query.path, "content": content }))
        }
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

#[derive(Debug, Deserialize)]
pub struct NomadServingPageBody {
    pub path: String,
    pub content: String,
}

pub async fn put_nomad_serving_page(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<NomadServingPageBody>,
) -> Json<serde_json::Value> {
    match stack
        .write_nomad_serving_page(&body.path, &body.content)
        .await
    {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn delete_nomad_serving_page(
    State(stack): State<Arc<StackHandle>>,
    Query(query): Query<NomadServingPageQuery>,
) -> Json<serde_json::Value> {
    match stack.delete_nomad_serving_page(&query.path).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn list_nomad_serving_files(
    State(stack): State<Arc<StackHandle>>,
) -> Json<serde_json::Value> {
    match stack.list_nomad_serving_files().await {
        Ok(files) => Json(serde_json::json!({ "ok": true, "files": files })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

#[derive(Debug, Deserialize)]
pub struct NomadServingFileBody {
    pub path: String,
    pub content_base64: String,
}

pub async fn put_nomad_serving_file(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<NomadServingFileBody>,
) -> Json<serde_json::Value> {
    match stack
        .write_nomad_serving_file(&body.path, &body.content_base64)
        .await
    {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn delete_nomad_serving_file(
    State(stack): State<Arc<StackHandle>>,
    Query(query): Query<NomadServingPageQuery>,
) -> Json<serde_json::Value> {
    match stack.delete_nomad_serving_file(&query.path).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

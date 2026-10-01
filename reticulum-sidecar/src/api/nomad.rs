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
pub struct NomadIdentifyBody {
    pub destination_hash: String,
    pub identify: bool,
}

pub async fn identify_nomad_node(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<NomadIdentifyBody>,
) -> Json<serde_json::Value> {
    match stack
        .set_nomad_identify(&body.destination_hash, body.identify)
        .await
    {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn clear_nomad_identify(
    State(stack): State<Arc<StackHandle>>,
) -> Json<serde_json::Value> {
    match stack.clear_nomad_identify_all().await {
        Ok(cleared) => Json(serde_json::json!({ "ok": true, "cleared": cleared })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

#[derive(Debug, Deserialize)]
pub struct NomadPageQuery {
    pub path: String,
    pub data: Option<String>,
    /// When true, RequestPath even if a cached path exists (stale-route retry).
    #[serde(default)]
    pub force_path_refresh: bool,
    /// Send LINKIDENTIFY on the Link. Absent means anonymous (NomadNet default).
    #[serde(default)]
    pub identify: bool,
    /// Client correlation id echoed on `nomad.page_progress` WS events.
    pub request_id: Option<String>,
}

pub async fn get_nomad_page(
    State(stack): State<Arc<StackHandle>>,
    Path(hash): Path<String>,
    Query(query): Query<NomadPageQuery>,
) -> Json<serde_json::Value> {
    Json(
        stack
            .nomad_page(
                &hash,
                &query.path,
                query.data.as_deref(),
                query.force_path_refresh,
                query.request_id.as_deref(),
                query.identify,
            )
            .await,
    )
}

#[derive(Debug, Deserialize)]
pub struct NomadFileQuery {
    pub path: String,
    /// When true, RequestPath even if a cached path exists (stale-route retry).
    #[serde(default)]
    pub force_path_refresh: bool,
    /// Send LINKIDENTIFY on the Link. Absent means anonymous.
    #[serde(default)]
    pub identify: bool,
}

pub async fn get_nomad_file(
    State(stack): State<Arc<StackHandle>>,
    Path(hash): Path<String>,
    Query(query): Query<NomadFileQuery>,
) -> Json<serde_json::Value> {
    Json(
        stack
            .nomad_file(&hash, &query.path, query.force_path_refresh, query.identify)
            .await,
    )
}

#[derive(Debug, Deserialize)]
pub struct NomadMediaQuery {
    /// Media resource path from the Micron image URL (e.g. `/media/header.webp`).
    pub path: String,
    /// When true, RequestPath even if a cached path exists (stale-route retry).
    #[serde(default)]
    pub force_path_refresh: bool,
    /// Send LINKIDENTIFY on the Link. Absent means anonymous.
    #[serde(default)]
    pub identify: bool,
}

pub async fn get_nomad_media(
    State(stack): State<Arc<StackHandle>>,
    Path(hash): Path<String>,
    Query(query): Query<NomadMediaQuery>,
) -> Json<serde_json::Value> {
    Json(
        stack
            .nomad_media(&hash, &query.path, query.force_path_refresh, query.identify)
            .await,
    )
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

/// `path` is the page (e.g. `index.mu`); the sidecar resolves `index.mu.allowed`.
pub async fn get_nomad_serving_page_acl(
    State(stack): State<Arc<StackHandle>>,
    Query(query): Query<NomadServingPageQuery>,
) -> Json<serde_json::Value> {
    match stack.read_nomad_serving_page_acl(&query.path).await {
        Ok(content) => Json(serde_json::json!({
            "ok": true,
            "path": query.path,
            "exists": content.is_some(),
            "content": content.unwrap_or_default(),
        })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn put_nomad_serving_page_acl(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<NomadServingPageBody>,
) -> Json<serde_json::Value> {
    match stack
        .write_nomad_serving_page_acl(&body.path, &body.content)
        .await
    {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn delete_nomad_serving_page_acl(
    State(stack): State<Arc<StackHandle>>,
    Query(query): Query<NomadServingPageQuery>,
) -> Json<serde_json::Value> {
    match stack.delete_nomad_serving_page_acl(&query.path).await {
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

#[derive(Debug, Deserialize)]
pub struct NomadServingContentSourceBody {
    /// Absolute directory path of the watched Nomad content folder.
    pub path: String,
}

pub async fn put_nomad_serving_content_source(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<NomadServingContentSourceBody>,
) -> Json<serde_json::Value> {
    match stack.set_nomad_content_source(body.path).await {
        Ok(serving) => Json(serde_json::json!({ "ok": true, "serving": serving })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

#[cfg(test)]
mod force_path_refresh_query_tests {
    use super::*;

    #[test]
    fn nomad_page_query_defaults_force_path_refresh_false() {
        let q: NomadPageQuery =
            serde_urlencoded::from_str("path=%2Fpage%2Findex.mu").expect("query");
        assert!(!q.force_path_refresh);
        assert!(q.request_id.is_none());
        assert_eq!(q.path, "/page/index.mu");
    }

    #[test]
    fn nomad_page_query_parses_force_path_refresh_true() {
        let q: NomadPageQuery =
            serde_urlencoded::from_str("path=%2Fpage%2Findex.mu&force_path_refresh=true")
                .expect("query");
        assert!(q.force_path_refresh);
    }

    #[test]
    fn nomad_page_query_parses_request_id() {
        let q: NomadPageQuery =
            serde_urlencoded::from_str("path=%2Fpage%2Findex.mu&request_id=load-42")
                .expect("query");
        assert_eq!(q.request_id.as_deref(), Some("load-42"));
    }

    #[test]
    fn nomad_file_query_parses_force_path_refresh_true() {
        let q: NomadFileQuery =
            serde_urlencoded::from_str("path=%2Ffile%2Fx.bin&force_path_refresh=true")
                .expect("query");
        assert!(q.force_path_refresh);
        assert_eq!(q.path, "/file/x.bin");
    }

    #[test]
    fn nomad_media_query_parses_path() {
        let q: NomadMediaQuery =
            serde_urlencoded::from_str("path=%2Fmedia%2Fheader.webp").expect("query");
        assert!(!q.force_path_refresh);
        assert_eq!(q.path, "/media/header.webp");
    }

    #[test]
    fn nomad_queries_default_identify_false() {
        let page: NomadPageQuery =
            serde_urlencoded::from_str("path=%2Fpage%2Findex.mu").expect("query");
        let file: NomadFileQuery =
            serde_urlencoded::from_str("path=%2Ffile%2Fx.bin").expect("query");
        let media: NomadMediaQuery =
            serde_urlencoded::from_str("path=%2Fmedia%2Fheader.webp").expect("query");
        assert!(!page.identify);
        assert!(!file.identify);
        assert!(!media.identify);
    }

    #[test]
    fn nomad_queries_parse_identify_true() {
        let page: NomadPageQuery =
            serde_urlencoded::from_str("path=%2Fpage%2Findex.mu&identify=true").expect("query");
        let file: NomadFileQuery =
            serde_urlencoded::from_str("path=%2Ffile%2Fx.bin&identify=true").expect("query");
        let media: NomadMediaQuery =
            serde_urlencoded::from_str("path=%2Fmedia%2Fheader.webp&identify=true").expect("query");
        assert!(page.identify);
        assert!(file.identify);
        assert!(media.identify);
    }
}

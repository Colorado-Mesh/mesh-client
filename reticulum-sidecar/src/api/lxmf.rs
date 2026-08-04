use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, Query, State};
use serde::Deserialize;

use crate::stack::{LxmfReactionRequest, LxmfSendRequest, StackHandle};

pub async fn lxmf_send(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<LxmfSendRequest>,
) -> Json<serde_json::Value> {
    match stack.lxmf_send(body).await {
        Ok(payload) => Json(serde_json::json!({ "ok": true, "message": payload })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn lxmf_reaction(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<LxmfReactionRequest>,
) -> Json<serde_json::Value> {
    match stack.lxmf_reaction(body).await {
        Ok(payload) => Json(serde_json::json!({ "ok": true, "message": payload })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn list_contacts(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    let contacts = stack.list_contacts().await;
    Json(serde_json::json!({ "contacts": contacts }))
}

pub async fn clear_contacts(State(stack): State<Arc<StackHandle>>) -> Json<serde_json::Value> {
    match stack.clear_contacts().await {
        Ok(cleared) => Json(serde_json::json!({ "ok": true, "cleared": cleared })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

#[derive(Debug, Deserialize)]
pub struct ListPeersQuery {
    /// When `1` or `true`, force a live GetPathTable (manual Refresh).
    #[serde(default)]
    pub refresh: Option<String>,
}

/// Parse `?refresh=` for live path-table bypass (`1` / `true` / `yes`, case- and whitespace-tolerant).
pub fn peers_query_forces_refresh(refresh: Option<&str>) -> bool {
    matches!(
        refresh
            .map(str::trim)
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("1" | "true" | "yes")
    )
}

pub async fn list_peers(
    State(stack): State<Arc<StackHandle>>,
    Query(q): Query<ListPeersQuery>,
) -> Json<serde_json::Value> {
    let force = peers_query_forces_refresh(q.refresh.as_deref());
    let peers = stack.list_peers_with_refresh(force).await;
    Json(serde_json::json!({ "peers": peers }))
}

#[cfg(test)]
mod peers_query_tests {
    use super::peers_query_forces_refresh;

    #[test]
    fn peers_query_forces_refresh_accepts_truthy_variants() {
        assert!(peers_query_forces_refresh(Some("1")));
        assert!(peers_query_forces_refresh(Some(" true ")));
        assert!(peers_query_forces_refresh(Some("YES")));
        assert!(!peers_query_forces_refresh(None));
        assert!(!peers_query_forces_refresh(Some("0")));
        assert!(!peers_query_forces_refresh(Some("no")));
        assert!(!peers_query_forces_refresh(Some("maybe")));
    }
}

#[derive(Debug, serde::Deserialize)]
pub struct PingBody {
    pub destination_hash: String,
}

pub async fn ping(
    State(stack): State<Arc<StackHandle>>,
    Json(body): Json<PingBody>,
) -> Json<serde_json::Value> {
    match stack.ping_destination(&body.destination_hash).await {
        Ok(res) => Json(res),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn peer_path(
    State(stack): State<Arc<StackHandle>>,
    Path(hash): Path<String>,
) -> Json<serde_json::Value> {
    match stack.request_peer_path(&hash).await {
        Ok(()) => Json(serde_json::json!({ "ok": true })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn peer_probe(
    State(stack): State<Arc<StackHandle>>,
    Path(hash): Path<String>,
) -> Json<serde_json::Value> {
    match stack.probe_peer(&hash).await {
        Ok(res) => Json(res),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

pub async fn lxmf_delete_message(
    State(stack): State<Arc<StackHandle>>,
    Path(hash): Path<String>,
) -> Json<serde_json::Value> {
    match stack.lxmf_delete_message(&hash).await {
        Ok(removed) => Json(serde_json::json!({ "ok": true, "removed": removed })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

#[derive(Debug, Deserialize)]
pub struct RecentLxmfQuery {
    /// Exclusive lower-bound cursor on payload `timestamp` (ms). Omit with `since_seq` to return
    /// the full ring. Rows are chronological (oldest→newest). With `since_seq`, keep rows after
    /// the complete `(since_ts, since_seq)` cursor so same-ms twins remain recoverable.
    #[serde(default)]
    pub since_ts: Option<i64>,
    /// Opaque monotonic `ring_seq` stamped by the inbound ring. Pair with `since_ts`; ignored when
    /// `since_ts` is omitted. Without `since_seq`, filtering is timestamp-only exclusive.
    #[serde(default)]
    pub since_seq: Option<u64>,
    /// Max rows (default 200, capped at 500).
    #[serde(default)]
    pub limit: Option<usize>,
}

/// Recent inbound LXMF payloads buffered for WS lag / reconnect catch-up.
pub async fn list_recent_lxmf(
    State(stack): State<Arc<StackHandle>>,
    Query(q): Query<RecentLxmfQuery>,
) -> Json<serde_json::Value> {
    let limit = q.limit.unwrap_or(200).clamp(1, 500);
    let messages = stack.list_recent_inbound_lxmf(q.since_ts, q.since_seq, limit);
    let ring_len = stack.inbound_lxmf_ring_len();
    Json(serde_json::json!({ "messages": messages, "ring_len": ring_len }))
}

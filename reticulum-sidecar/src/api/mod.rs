//! HTTP + WebSocket API (Ratspeak-aligned contract; see docs/reticulum-sidecar-ipc.md).

mod interfaces;
mod lxmf;
mod status;
mod ws;

use std::sync::Arc;

use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::CorsLayer;

use crate::state::AppState;

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/v1/status", get(status::status))
        .route("/api/v1/app/info", get(status::app_info))
        .route("/api/v1/interfaces", get(interfaces::list_interfaces))
        .route("/api/v1/lxmf/send", post(lxmf::lxmf_send))
        .route("/api/v1/contacts", get(lxmf::list_contacts))
        .route("/ws", get(ws::ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

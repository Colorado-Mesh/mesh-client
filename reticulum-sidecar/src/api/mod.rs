//! HTTP + WebSocket API (Ratspeak-aligned contract; see docs/reticulum-sidecar-ipc.md).

mod identity;
mod interfaces;
mod lxmf;
mod status;
mod ws;

use std::sync::Arc;

use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::CorsLayer;

use crate::stack::StackHandle;

pub fn router(stack: Arc<StackHandle>) -> Router {
    Router::new()
        .route("/api/v1/status", get(status::status))
        .route("/api/v1/app/info", get(status::app_info))
        .route("/api/v1/identity/status", get(identity::identity_status))
        .route("/api/v1/identity/generate", post(identity::identity_generate))
        .route("/api/v1/identity/import", post(identity::identity_import))
        .route("/api/v1/identity/export", post(identity::identity_export))
        .route(
            "/api/v1/identity/display-name",
            post(identity::identity_set_display_name),
        )
        .route("/api/v1/interfaces", get(interfaces::list_interfaces))
        .route("/api/v1/interfaces", post(interfaces::add_interface))
        .route(
            "/api/v1/interfaces/{id}/enable",
            post(interfaces::enable_interface),
        )
        .route(
            "/api/v1/interfaces/{id}/disable",
            post(interfaces::disable_interface),
        )
        .route("/api/v1/rnode/presets", get(interfaces::rnode_presets))
        .route("/api/v1/serial/ports", get(interfaces::serial_ports))
        .route("/api/v1/ble/availability", get(interfaces::ble_availability))
        .route("/api/v1/lxmf/send", post(lxmf::lxmf_send))
        .route("/api/v1/lxmf/reaction", post(lxmf::lxmf_reaction))
        .route("/api/v1/contacts", get(lxmf::list_contacts))
        .route("/api/v1/peers", get(lxmf::list_peers))
        .route("/api/v1/peers/{hash}/path", post(lxmf::peer_path))
        .route("/api/v1/peers/{hash}/probe", post(lxmf::peer_probe))
        .route("/api/v1/propagation", get(lxmf::list_propagation))
        .route(
            "/api/v1/propagation/{id}/enable",
            post(lxmf::enable_propagation),
        )
        .route(
            "/api/v1/propagation/{id}/disable",
            post(lxmf::disable_propagation),
        )
        .route("/ws", get(ws::ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(stack)
}

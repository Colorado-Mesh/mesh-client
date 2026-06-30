//! HTTP + WebSocket API (Ratspeak-aligned contract; see docs/reticulum-sidecar-ipc.md).

mod config;
mod identity;
mod interfaces;
mod lxmf;
mod status;
mod system;
mod ws;

use std::sync::Arc;

use axum::Router;
use axum::routing::{get, post, put};
use tower_http::cors::CorsLayer;

use crate::stack::StackHandle;

pub fn router(stack: Arc<StackHandle>) -> Router {
    Router::new()
        .route("/api/v1/status", get(status::status))
        .route("/api/v1/app/info", get(status::app_info))
        .route("/api/v1/identity/status", get(identity::identity_status))
        .route(
            "/api/v1/identity/generate",
            post(identity::identity_generate),
        )
        .route("/api/v1/identity/import", post(identity::identity_import))
        .route("/api/v1/identity/export", post(identity::identity_export))
        .route(
            "/api/v1/identity/display-name",
            post(identity::identity_set_display_name),
        )
        .route("/api/v1/interfaces", get(interfaces::list_interfaces))
        .route("/api/v1/interfaces", post(interfaces::add_interface))
        .route(
            "/api/v1/interfaces/{id}",
            put(config::update_interface).delete(config::delete_interface),
        )
        .route(
            "/api/v1/interfaces/{id}/enable",
            post(interfaces::enable_interface),
        )
        .route(
            "/api/v1/interfaces/{id}/disable",
            post(interfaces::disable_interface),
        )
        .route(
            "/api/v1/config",
            get(config::get_config).put(config::put_config),
        )
        .route("/api/v1/config/import", post(config::import_config))
        .route("/api/v1/config/export", get(config::export_config))
        .route(
            "/api/v1/stack/settings",
            get(config::get_stack_settings).put(config::put_stack_settings),
        )
        .route("/api/v1/rnode/presets", get(interfaces::rnode_presets))
        .route("/api/v1/serial/ports", get(interfaces::serial_ports))
        .route(
            "/api/v1/ble/availability",
            get(interfaces::ble_availability),
        )
        .route("/api/v1/lxmf/send", post(lxmf::lxmf_send))
        .route("/api/v1/lxmf/reaction", post(lxmf::lxmf_reaction))
        .route("/api/v1/lxmf/resource", post(lxmf::lxmf_send_resource))
        .route(
            "/api/v1/lxmf/messages/{hash}",
            axum::routing::delete(lxmf::lxmf_delete_message),
        )
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
        .route("/api/v1/stack/restart", post(system::stack_restart))
        .route("/api/v1/system/factory-reset", post(system::factory_reset))
        .route("/api/v1/diagnostics", get(system::diagnostics))
        .route("/api/v1/voice/status", get(system::voice_status))
        .route("/api/v1/games/status", get(system::games_status))
        .route("/api/v1/identities", get(system::list_identities))
        .route("/api/v1/identities/switch", post(system::switch_identity))
        .route("/ws", get(ws::ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(stack)
}

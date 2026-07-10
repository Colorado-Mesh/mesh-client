//! HTTP + WebSocket API (Ratspeak-aligned contract; see docs/reticulum-sidecar-ipc.md).

mod config;
mod identity;
mod interfaces;
mod lxmf;
mod nomad;
mod propagation;
mod rmap;
mod status;
mod system;
mod ws;

use std::sync::Arc;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{delete, get, post, put};
use http::HeaderValue;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};

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
            "/api/v1/interfaces/primary-local-rnode",
            post(interfaces::set_primary_local_rnode),
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
        .route("/api/v1/config/audit", get(config::config_audit))
        .route("/api/v1/config/repair", post(config::config_repair))
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
        .route("/api/v1/ble/scan", get(interfaces::ble_scan))
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
        .route("/api/v1/ping", post(lxmf::ping))
        .route("/api/v1/topology", get(system::topology))
        .route("/api/v1/rmap/discovered", get(rmap::list_rmap_discovered))
        .route("/api/v1/packets", get(system::list_packets).delete(system::clear_packets))
        .route("/api/v1/announces", delete(system::clear_announces))
        .route("/api/v1/propagation", get(propagation::list_propagation))
        .route("/api/v1/propagation/add", post(propagation::add_propagation_node))
        .route(
            "/api/v1/propagation/{id}/preferred",
            post(propagation::set_preferred_propagation),
        )
        .route(
            "/api/v1/propagation/sync",
            post(propagation::start_propagation_sync),
        )
        .route(
            "/api/v1/propagation/sync/cancel",
            post(propagation::cancel_propagation_sync),
        )
        .route(
            "/api/v1/propagation/auto-sync-interval",
            post(propagation::set_propagation_auto_sync_interval),
        )
        .route(
            "/api/v1/propagation/{id}/enable",
            post(propagation::enable_propagation),
        )
        .route(
            "/api/v1/propagation/{id}/disable",
            post(propagation::disable_propagation),
        )
        .route(
            "/api/v1/nomadnetwork/nodes",
            get(nomad::list_nomad_nodes),
        )
        .route(
            "/api/v1/nomadnetwork/nodes/favorite",
            post(nomad::favorite_nomad_node),
        )
        .route(
            "/api/v1/nomadnetwork/page/{hash}",
            get(nomad::get_nomad_page),
        )
        .route(
            "/api/v1/nomadnetwork/file/{hash}",
            get(nomad::get_nomad_file),
        )
        .route("/api/v1/stack/restart", post(system::stack_restart))
        .route("/api/v1/system/factory-reset", post(system::factory_reset))
        .route("/api/v1/diagnostics", get(system::diagnostics))
        .route("/api/v1/voice/status", get(system::voice_status))
        .route("/api/v1/games/status", get(system::games_status))
        .route("/api/v1/identities", get(system::list_identities))
        .route("/api/v1/identities/switch", post(system::switch_identity))
        .route("/ws", get(ws::ws_handler))
        .layer(DefaultBodyLimit::max(4 * 1024 * 1024))
        .layer(localhost_cors_layer())
        .with_state(stack)
}

fn localhost_cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(
            |origin: &HeaderValue, _request_parts| is_localhost_origin(origin),
        ))
        .allow_methods(Any)
        .allow_headers(Any)
}

fn is_localhost_origin(origin: &HeaderValue) -> bool {
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    let origin = origin.trim_end_matches('/');
    origin == "http://localhost"
        || origin == "https://localhost"
        || origin.starts_with("http://localhost:")
        || origin.starts_with("https://localhost:")
        || origin == "http://127.0.0.1"
        || origin == "https://127.0.0.1"
        || origin.starts_with("http://127.0.0.1:")
        || origin.starts_with("https://127.0.0.1:")
}

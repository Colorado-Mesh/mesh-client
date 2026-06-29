//! Headless Reticulum sidecar for mesh-client.
//!
//! IPC contract aligns with Ratspeak `ratspeak-tauri` commands (see docs/reticulum-sidecar-ipc.md).
//! rsReticulum/rsLXMF stack wiring lands in follow-up PRs once sibling crates are pinned.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use clap::Parser;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tracing::info;

#[derive(Parser, Debug)]
#[command(name = "mesh-client-reticulum")]
struct Args {
    #[arg(long, default_value = "127.0.0.1")]
    host: String,
    #[arg(long, default_value_t = 19437)]
    port: u16,
    #[arg(long)]
    headless: bool,
    #[arg(long)]
    reticulum_config_dir: Option<String>,
    #[arg(long)]
    storage_dir: Option<String>,
}

#[derive(Clone)]
struct AppState {
    version: String,
    event_tx: broadcast::Sender<String>,
}

#[derive(Serialize)]
struct StatusResponse {
    status: &'static str,
    version: String,
    rns_ready: bool,
    lxmf_ready: bool,
}

#[derive(Serialize)]
struct AppInfoResponse {
    sidecar_version: String,
    rns_version: Option<String>,
    lxmf_version: Option<String>,
}

async fn status(State(state): State<Arc<AppState>>) -> Json<StatusResponse> {
    Json(StatusResponse {
        status: "ok",
        version: state.version.clone(),
        rns_ready: false,
        lxmf_ready: false,
    })
}

async fn app_info(State(state): State<Arc<AppState>>) -> Json<AppInfoResponse> {
    Json(AppInfoResponse {
        sidecar_version: state.version.clone(),
        rns_version: None,
        lxmf_version: None,
    })
}

async fn list_interfaces() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "interfaces": [] }))
}

async fn lxmf_send() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": false, "error": "not_implemented" }))
}

async fn list_contacts() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "contacts": [] }))
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

async fn handle_ws(mut socket: WebSocket, state: Arc<AppState>) {
    let mut rx = state.event_tx.subscribe();
    loop {
        tokio::select! {
            evt = rx.recv() => {
                match evt {
                    Ok(payload) => {
                        if socket.send(Message::Text(payload.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            incoming = socket.next() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
        }
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let args = Args::parse();
    if args.headless {
        info!("mesh-client-reticulum headless mode");
    }
    if let Some(ref dir) = args.reticulum_config_dir {
        info!(config_dir = %dir, "reticulum config dir");
    }
    if let Some(ref dir) = args.storage_dir {
        info!(storage_dir = %dir, "lxmf storage dir");
    }

    let (event_tx, _) = broadcast::channel::<String>(256);
    let state = Arc::new(AppState {
        version: env!("CARGO_PKG_VERSION").to_string(),
        event_tx,
    });

    let app = Router::new()
        .route("/api/v1/status", get(status))
        .route("/api/v1/app/info", get(app_info))
        .route("/api/v1/interfaces", get(list_interfaces))
        .route("/api/v1/lxmf/send", post(lxmf_send))
        .route("/api/v1/contacts", get(list_contacts))
        .route("/ws", get(ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let addr: SocketAddr = format!("{}:{}", args.host, args.port)
        .parse()
        .expect("valid listen address");
    info!(%addr, "listening");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}

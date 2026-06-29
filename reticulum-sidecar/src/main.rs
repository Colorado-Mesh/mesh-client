//! Headless Reticulum sidecar for mesh-client.
//!
//! IPC contract aligns with Ratspeak `ratspeak-tauri` commands (see docs/reticulum-sidecar-ipc.md).
//! rsReticulum/rsLXMF stack wiring lands behind the `rns-stack` Cargo feature.

mod api;
mod lxmf_stack;
mod rns_stack;
mod state;

use std::net::SocketAddr;
use std::sync::Arc;

use clap::Parser;
use tracing::info;

use crate::lxmf_stack::LxmfStack;
use crate::rns_stack::RnsStack;
use crate::state::AppState;

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

    let rns = RnsStack::init(args.reticulum_config_dir.as_deref());
    let lxmf = LxmfStack::init(args.storage_dir.as_deref());

    let (event_tx, _) = tokio::sync::broadcast::channel::<String>(256);
    let state = Arc::new(AppState::new(
        env!("CARGO_PKG_VERSION").to_string(),
        event_tx,
        rns,
        lxmf,
    ));

    let app = api::router(state);

    let addr: SocketAddr = format!("{}:{}", args.host, args.port)
        .parse()
        .expect("valid listen address");
    info!(%addr, "listening");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}

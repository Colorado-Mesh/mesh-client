//! Headless Reticulum sidecar for mesh-client.
//!
//! IPC contract aligns with Ratspeak `ratspeak-tauri` commands (see docs/reticulum-sidecar-ipc.md).

mod api;
mod stack;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use clap::Parser;
use tokio::sync::broadcast;
use tracing::{error, info};

use crate::stack::StackHandle;

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

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost" | "::1" | "[::1]")
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

    if !is_loopback_host(&args.host)
        && std::env::var("MESH_CLIENT_RETICULUM_BIND_ALL")
            .ok()
            .as_deref()
            != Some("1")
    {
        error!(
            host = %args.host,
            "refusing to bind to non-loopback host without MESH_CLIENT_RETICULUM_BIND_ALL=1"
        );
        std::process::exit(1);
    }

    let config_dir = PathBuf::from(
        args.reticulum_config_dir
            .unwrap_or_else(|| "./reticulum-config".into()),
    );
    let storage_dir = PathBuf::from(
        args.storage_dir
            .unwrap_or_else(|| "./reticulum-storage".into()),
    );

    info!(config_dir = %config_dir.display(), storage_dir = %storage_dir.display(), "data dirs");

    let (event_tx, _) = broadcast::channel::<String>(256);
    let stack = Arc::new(StackHandle::bootstrap(config_dir, storage_dir, event_tx).await);

    let app = api::router(stack);

    let addr: SocketAddr = match format!("{}:{}", args.host, args.port).parse() {
        Ok(addr) => addr,
        Err(e) => {
            error!(host = %args.host, port = args.port, error = %e, "invalid listen address");
            std::process::exit(1);
        }
    };
    info!(%addr, "listening");
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(e) => {
            error!(%addr, error = %e, "failed to bind listen address");
            std::process::exit(1);
        }
    };
    if let Err(e) = axum::serve(listener, app).await {
        error!(error = %e, "HTTP server exited with error");
        std::process::exit(1);
    }
}

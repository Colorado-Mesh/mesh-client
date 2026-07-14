//! Headless Reticulum sidecar for mesh-client.
//!
//! IPC contract aligns with Ratspeak `ratspeak-tauri` commands (see docs/reticulum-sidecar-ipc.md).

mod api;
mod stack;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;

use clap::{Parser, Subcommand};
use tokio::sync::broadcast;
use tracing::{error, info};

use crate::stack::config_audit::validate_config_offline;
use crate::stack::StackHandle;

#[derive(Parser, Debug)]
#[command(name = "mesh-client-reticulum")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

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

#[derive(Subcommand, Debug)]
enum Commands {
    /// Parse and audit an on-disk rnsd config without starting the HTTP stack.
    ValidateConfig {
        #[arg(long)]
        reticulum_config_dir: Option<String>,
        /// Emit JSON on stdout: `{ "ok": bool, "issues": [...], "parse_error": "..."? }`.
        #[arg(long)]
        json: bool,
    },
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost" | "::1" | "[::1]")
}

fn run_validate_config(config_dir: PathBuf, json: bool) -> ExitCode {
    match validate_config_offline(&config_dir) {
        Ok(issues) => {
            let has_error = issues.iter().any(|i| i.severity == "error");
            if json {
                let payload = serde_json::json!({
                    "ok": !has_error,
                    "issues": issues,
                });
                println!("{payload}");
            } else if issues.is_empty() {
                eprintln!("validate-config: ok ({})", config_dir.display());
            } else {
                for issue in &issues {
                    eprintln!(
                        "[{}] {}: {}",
                        issue.severity, issue.kind, issue.message
                    );
                }
            }
            if has_error {
                ExitCode::from(1)
            } else {
                ExitCode::SUCCESS
            }
        }
        Err(e) => {
            if json {
                let payload = serde_json::json!({
                    "ok": false,
                    "issues": [],
                    "parse_error": e,
                });
                println!("{payload}");
            } else {
                eprintln!("validate-config: parse error: {e}");
            }
            ExitCode::from(1)
        }
    }
}

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();

    if let Some(Commands::ValidateConfig {
        reticulum_config_dir,
        json,
    }) = cli.command
    {
        let config_dir = PathBuf::from(
            reticulum_config_dir
                .or(cli.reticulum_config_dir)
                .unwrap_or_else(|| "./reticulum-config".into()),
        );
        return run_validate_config(config_dir, json);
    }

    if cli.headless {
        info!("mesh-client-reticulum headless mode");
    }

    if !is_loopback_host(&cli.host)
        && std::env::var("MESH_CLIENT_RETICULUM_BIND_ALL")
            .ok()
            .as_deref()
            != Some("1")
    {
        error!(
            host = %cli.host,
            "refusing to bind to non-loopback host without MESH_CLIENT_RETICULUM_BIND_ALL=1"
        );
        return ExitCode::from(1);
    }

    let config_dir = PathBuf::from(
        cli.reticulum_config_dir
            .unwrap_or_else(|| "./reticulum-config".into()),
    );
    let storage_dir = PathBuf::from(
        cli.storage_dir
            .unwrap_or_else(|| "./reticulum-storage".into()),
    );

    info!(config_dir = %config_dir.display(), storage_dir = %storage_dir.display(), "data dirs");

    let (event_tx, _) = broadcast::channel::<String>(256);
    let stack = Arc::new(StackHandle::bootstrap(config_dir, storage_dir, event_tx).await);

    let app = api::router(stack);

    let addr: SocketAddr = match format!("{}:{}", cli.host, cli.port).parse() {
        Ok(addr) => addr,
        Err(e) => {
            error!(host = %cli.host, port = cli.port, error = %e, "invalid listen address");
            return ExitCode::from(1);
        }
    };
    info!(%addr, "listening");
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(e) => {
            error!(%addr, error = %e, "failed to bind listen address");
            return ExitCode::from(1);
        }
    };
    if let Err(e) = axum::serve(listener, app).await {
        error!(error = %e, "HTTP server exited with error");
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}

//! Headless Reticulum sidecar for mesh-client.
//!
//! IPC contract aligns with Ratspeak `ratspeak-tauri` commands (see docs/reticulum-sidecar-ipc.md).

// Stub build (no rns-stack): live modules compile as stubs; many symbols are unused until
// the full feature set is enabled. Full-feature Clippy stays strict (-D warnings).
#![cfg_attr(
    not(feature = "rns-stack"),
    allow(
        dead_code,
        unused_imports,
        unused_variables,
        unused_mut,
        unused_assignments,
        clippy::unused_async,
        clippy::unused_async_trait_impl,
        clippy::unused_self,
        clippy::unnecessary_wraps,
        clippy::needless_pass_by_value,
    )
)]

mod api;
mod ble;
mod gatt;
mod stack;

use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;

use clap::{Parser, Subcommand};
use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::broadcast;
use tracing::{error, info};

use crate::stack::StackHandle;
use crate::stack::config_audit::validate_config_offline;

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
    /// Start HTTP/GATT without opening configured Reticulum interfaces or services.
    #[arg(long)]
    ble_only: bool,
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

fn loopback_socket_addr(host: &str, port: u16) -> Result<SocketAddr, String> {
    let bare_host = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    let ip = bare_host
        .parse::<IpAddr>()
        .map_err(|_| "sidecar host must be an explicit loopback IP address".to_string())?;
    if !ip.is_loopback() {
        return Err("sidecar refuses non-loopback listen addresses".to_string());
    }
    Ok(SocketAddr::new(ip, port))
}

#[derive(Deserialize)]
struct SidecarBootstrap {
    auth_token: String,
    capability_issuer_token: String,
    capability_session_id: String,
}

async fn read_bootstrap_from_stdin() -> Result<SidecarBootstrap, String> {
    let mut line = String::new();
    let mut reader = BufReader::new(tokio::io::stdin());
    let bytes = reader
        .read_line(&mut line)
        .await
        .map_err(|e| format!("failed to read sidecar authentication bootstrap: {e}"))?;
    if bytes == 0 {
        return Err("missing sidecar authentication bootstrap".to_string());
    }
    if line.ends_with('\n') {
        line.pop();
        if line.ends_with('\r') {
            line.pop();
        }
    }
    if line.is_empty() || line.contains(['\r', '\n']) {
        return Err("invalid sidecar authentication bootstrap".to_string());
    }
    serde_json::from_str(&line).map_err(|_| "invalid sidecar authentication bootstrap".to_string())
}

fn run_validate_config(config_dir: &Path, json: bool) -> ExitCode {
    match validate_config_offline(config_dir) {
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
                    eprintln!("[{}] {}: {}", issue.severity, issue.kind, issue.message);
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
    // stdout is a pipe to Electron main, which parses the level/target tokens; ANSI codes
    // break that parse (tracing-subscriber does not detect non-TTY writers).
    tracing_subscriber::fmt()
        .with_ansi(false)
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
        return run_validate_config(&config_dir, json);
    }

    if cli.headless {
        info!("mesh-client-reticulum headless mode");
    }

    let addr = match loopback_socket_addr(&cli.host, cli.port) {
        Ok(addr) => addr,
        Err(e) => {
            error!(host = %cli.host, port = cli.port, error = %e, "invalid listen address");
            return ExitCode::from(1);
        }
    };

    let bootstrap = match read_bootstrap_from_stdin().await {
        Ok(bootstrap) => bootstrap,
        Err(e) => {
            error!(error = %e, "sidecar authentication bootstrap failed");
            return ExitCode::from(1);
        }
    };

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
    // Persist + HTTP shell first — do not await live RNS/BLE before binding.
    let stack = Arc::new(Box::pin(StackHandle::bootstrap(config_dir, storage_dir, event_tx)).await);

    let app = match api::router(
        stack.clone(),
        bootstrap.auth_token,
        bootstrap.capability_issuer_token,
        bootstrap.capability_session_id,
    ) {
        Ok(app) => app,
        Err(e) => {
            error!(error = %e, "sidecar authentication bootstrap rejected");
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

    // Accept /api/v1/status (and other routes) while live RNS attach continues.
    let serve = tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            error!(error = %e, "HTTP server exited with error");
        }
    });
    if !cli.ble_only {
        // attach_live's future is large (PropagationBridge / LXMF setup).
        if let Err(e) = Box::pin(stack.attach_live()).await {
            error!(error = %e, "failed to attach live Reticulum stack");
        }
    }
    let _ = serve.await;
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ble_only_start_is_explicit() {
        assert!(!Cli::parse_from(["mesh-client-reticulum"]).ble_only);
        assert!(Cli::parse_from(["mesh-client-reticulum", "--ble-only"]).ble_only);
    }

    #[test]
    fn listen_address_is_strictly_loopback() {
        assert_eq!(
            loopback_socket_addr("127.0.0.1", 19437).unwrap(),
            "127.0.0.1:19437".parse().unwrap()
        );
        assert_eq!(
            loopback_socket_addr("::1", 19437).unwrap(),
            "[::1]:19437".parse().unwrap()
        );
        assert!(loopback_socket_addr("0.0.0.0", 19437).is_err());
        assert!(loopback_socket_addr("localhost", 19437).is_err());
    }
}

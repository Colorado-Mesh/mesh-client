//! Headless Reticulum sidecar for mesh-client.
//!
//! IPC contract aligns with Ratspeak `ratspeak-tauri` commands (see docs/reticulum-sidecar-ipc.md).
//!
//! Mobile library root. This file mirrors the desktop `reticulum-sidecar/src/main.rs` (ported
//! from blob f08b83d7) with the process stdio injected: [`run`] takes the parsed command line,
//! the stdin bootstrap reader and the output sinks, and returns the exit status instead of
//! exiting. The desktop crate is not modified; `mobile/scripts/build-sidecar.mjs` copies it to
//! `mobile/native/.stage/reticulum-sidecar/` and writes this file there as `src/lib.rs`
//! (`[lib] name = "mesh_client_reticulum"`). The iOS in-process embedding
//! (`mobile/native/reticulum-ffi`) drives [`run`]; Android runs the staged copy of the unmodified
//! desktop executable, so only iOS depends on this mirror.
//!
//! `pnpm -C mobile run audit` pins `reticulum-sidecar/src/main.rs` by hash: when it changes, port
//! the change here (keep the injected I/O), then refresh the pins.

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

use std::io::Write;
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use clap::{Parser, Subcommand};
use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::broadcast;
use tracing::{error, info};

use crate::stack::StackHandle;
use crate::stack::config_audit::validate_config_offline;

/// Flush stderr before early exit so Electron's pipe capture sees tracing `error!` lines
/// (stderr is block-buffered when not a TTY).
fn exit_with_error(stderr: &mut dyn Write) -> u8 {
    let _ = stderr.flush();
    1
}

// Sidecar command line. Plain comment on purpose: a doc comment here would become clap's
// `about` text and change `--help` output.
#[derive(Parser, Debug)]
#[command(name = "mesh-client-reticulum")]
pub struct Cli {
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

async fn read_bootstrap_from_stdin<R: AsyncRead + Unpin>(
    stdin: R,
) -> Result<SidecarBootstrap, String> {
    let mut line = String::new();
    let mut reader = BufReader::new(stdin);
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

fn run_validate_config(
    config_dir: &Path,
    json: bool,
    stdout: &mut dyn Write,
    stderr: &mut dyn Write,
) -> u8 {
    match validate_config_offline(config_dir) {
        Ok(issues) => {
            let has_error = issues.iter().any(|i| i.severity == "error");
            if json {
                let payload = serde_json::json!({
                    "ok": !has_error,
                    "issues": issues,
                });
                let _ = writeln!(stdout, "{payload}");
            } else if issues.is_empty() {
                let _ = writeln!(stderr, "validate-config: ok ({})", config_dir.display());
            } else {
                for issue in &issues {
                    let _ = writeln!(
                        stderr,
                        "[{}] {}: {}",
                        issue.severity, issue.kind, issue.message
                    );
                }
            }
            u8::from(has_error)
        }
        Err(e) => {
            if json {
                let payload = serde_json::json!({
                    "ok": false,
                    "issues": [],
                    "parse_error": e,
                });
                let _ = writeln!(stdout, "{payload}");
            } else {
                let _ = writeln!(stderr, "validate-config: parse error: {e}");
            }
            1
        }
    }
}

/// Run the sidecar for one parsed command line and return its process exit status.
///
/// `stdin` carries the one-line authentication bootstrap (see docs/reticulum-sidecar-ipc.md);
/// `stdout`/`stderr` receive `validate-config` output. Tracing goes to the global subscriber the
/// caller installed (the executable writes it to stdout). Returns once the HTTP server exits;
/// embedders stop a running sidecar by dropping this future and its Tokio runtime.
pub async fn run<R: AsyncRead + Unpin>(
    cli: Cli,
    stdin: R,
    stdout: &mut dyn Write,
    stderr: &mut dyn Write,
) -> u8 {
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
        return run_validate_config(&config_dir, json, stdout, stderr);
    }

    if cli.headless {
        info!("mesh-client-reticulum headless mode");
    }

    let addr = match loopback_socket_addr(&cli.host, cli.port) {
        Ok(addr) => addr,
        Err(e) => {
            error!(host = %cli.host, port = cli.port, error = %e, "invalid listen address");
            return exit_with_error(stderr);
        }
    };

    let bootstrap = match read_bootstrap_from_stdin(stdin).await {
        Ok(bootstrap) => bootstrap,
        Err(e) => {
            error!(error = %e, "sidecar authentication bootstrap failed");
            return exit_with_error(stderr);
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
            return exit_with_error(stderr);
        }
    };
    info!(%addr, "listening");
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(listener) => listener,
        Err(e) => {
            error!(%addr, error = %e, "failed to bind listen address");
            return exit_with_error(stderr);
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
    0
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

    /// The iOS embedding has no process stdout: validate-config JSON must reach the injected sink.
    #[tokio::test]
    async fn validate_config_writes_to_injected_stdout() {
        let dir = tempfile::tempdir().unwrap();
        let cli = Cli::parse_from([
            "mesh-client-reticulum",
            "validate-config",
            "--reticulum-config-dir",
            dir.path().to_str().unwrap(),
            "--json",
        ]);
        let (mut out, mut err) = (Vec::new(), Vec::new());
        assert_eq!(run(cli, tokio::io::empty(), &mut out, &mut err).await, 0);
        let payload: serde_json::Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(payload["ok"], true);
        assert_eq!(String::from_utf8_lossy(&err), "");
    }

    #[tokio::test]
    async fn serve_reads_bootstrap_from_injected_stdin() {
        let cli = Cli::parse_from(["mesh-client-reticulum", "--headless", "--port", "0"]);
        let (mut out, mut err) = (Vec::new(), Vec::new());
        assert_eq!(run(cli, tokio::io::empty(), &mut out, &mut err).await, 1);
        let cli = Cli::parse_from(["mesh-client-reticulum", "--headless", "--port", "0"]);
        assert_eq!(
            run(cli, &b"not json\n"[..], &mut out, &mut err).await,
            1,
            "malformed bootstrap must fail before binding"
        );
    }
}

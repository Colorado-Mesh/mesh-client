//! Bluetooth LE helper for Mesh Hub.
//!
//! Hosts Meshtastic / MeshCore GATT sessions (btleplug) behind a loopback HTTP + WebSocket
//! API that the Electron main process drives (`src/main/gatt-sidecar-proxy.ts`).

mod api;
mod gatt;

use std::net::SocketAddr;
use std::process::ExitCode;

use clap::Parser;
use tracing::{error, info};

#[derive(Parser, Debug)]
#[command(name = "mesh-hub-ble")]
struct Cli {
    #[arg(long, default_value = "127.0.0.1")]
    host: String,
    #[arg(long, default_value_t = 19437)]
    port: u16,
    /// Accepted for launcher compatibility; the helper always runs headless.
    #[arg(long)]
    headless: bool,
    /// Accepted for launcher compatibility; reserved for future on-disk state.
    #[arg(long)]
    storage_dir: Option<String>,
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost" | "::1" | "[::1]")
}

#[tokio::main]
async fn main() -> ExitCode {
    // stdout/stderr are pipes to Electron main, which parses the level/target tokens; ANSI
    // codes break that parse (tracing-subscriber does not detect non-TTY writers).
    tracing_subscriber::fmt()
        .with_ansi(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();

    if !is_loopback_host(&cli.host) {
        error!(host = %cli.host, "refusing to bind to a non-loopback host");
        return ExitCode::from(1);
    }

    let addr: SocketAddr = match format!("{}:{}", cli.host, cli.port).parse() {
        Ok(addr) => addr,
        Err(e) => {
            error!(host = %cli.host, port = cli.port, error = %e, "invalid listen address");
            return ExitCode::from(1);
        }
    };

    let gatt = gatt::create_gatt_manager().await;
    let app = api::router(gatt);

    info!(%addr, headless = cli.headless, "listening");
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_loopback_hosts_are_allowed() {
        assert!(is_loopback_host("127.0.0.1"));
        assert!(is_loopback_host("::1"));
        assert!(!is_loopback_host("0.0.0.0"));
        assert!(!is_loopback_host("192.168.1.10"));
    }

    #[test]
    fn parses_launcher_arguments() {
        let cli = Cli::parse_from([
            "mesh-hub-ble",
            "--headless",
            "--host",
            "127.0.0.1",
            "--port",
            "4100",
            "--storage-dir",
            "/tmp/x",
        ]);
        assert!(cli.headless);
        assert_eq!(cli.port, 4100);
        assert_eq!(cli.storage_dir.as_deref(), Some("/tmp/x"));
    }
}

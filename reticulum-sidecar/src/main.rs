//! Headless Reticulum sidecar for mesh-client: the `mesh-client-reticulum` executable
//! (desktop, and Android via the app's native library directory).
//!
//! The sidecar itself lives in the library root (`src/lib.rs`); this binary only installs the
//! stdout tracing subscriber, parses argv and wires the process stdio into [`run`].

use std::io;
use std::process::ExitCode;

use clap::Parser;
use mesh_client_reticulum::{Cli, run};

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
    let code = run(
        cli,
        tokio::io::stdin(),
        &mut io::stdout(),
        &mut io::stderr(),
    )
    .await;
    ExitCode::from(code)
}

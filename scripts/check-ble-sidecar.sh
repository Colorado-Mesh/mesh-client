#!/usr/bin/env bash
# fmt + clippy + test for the Bluetooth helper in ble-sidecar/ (pre-commit when its paths are staged).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR_DIR="${REPO_ROOT}/ble-sidecar"

if ! command -v cargo > /dev/null 2>&1; then
  echo "check:ble-sidecar: cargo not on PATH — skip" >&2
  exit 0
fi

cd "${SIDECAR_DIR}"
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test

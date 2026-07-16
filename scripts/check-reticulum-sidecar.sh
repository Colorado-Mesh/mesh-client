#!/usr/bin/env bash
# Stub-build fmt + clippy + test for reticulum-sidecar (pre-commit).
# Full-feature lint lives in reticulum-sidecar.yaml; coverage threshold in tests.yaml.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR_DIR="${REPO_ROOT}/reticulum-sidecar"

if ! command -v cargo > /dev/null 2>&1; then
  echo "check:reticulum-sidecar: cargo not on PATH — skip" >&2
  exit 0
fi

# Optional path deps must exist on disk even for the stub build.
bash "${REPO_ROOT}/scripts/clone-ratspeak-stack.sh"

cd "${SIDECAR_DIR}"
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test

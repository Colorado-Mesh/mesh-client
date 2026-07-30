#!/usr/bin/env bash
# Full-feature fmt + clippy + test for reticulum-sidecar (pre-commit when sidecar paths staged).
# Coverage threshold still lives only in tests.yaml.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR_DIR="${REPO_ROOT}/reticulum-sidecar"
RNS_FEATURES='rns-stack,rns-ble,rns-rnode-tcp'

if ! command -v cargo > /dev/null 2>&1; then
  echo "check:reticulum-sidecar: cargo not on PATH — skip" >&2
  exit 0
fi

# Optional path deps must exist on disk even for the feature build.
bash "${REPO_ROOT}/scripts/clone-ratspeak-stack.sh"

# Lint sibling rsNomad (path dep); Clippy on the sidecar does not analyze path-dep sources.
bash "${REPO_ROOT}/scripts/check-rsnomad.sh"

cd "${SIDECAR_DIR}"
cargo fmt --check
cargo clippy --all-targets --features "${RNS_FEATURES}" -- -D warnings
cargo test --features "${RNS_FEATURES}"

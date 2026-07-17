#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(cd "${REPO_ROOT}/.." && pwd)}"
NOMAD_DIR="${WORKSPACE_ROOT}/rsNomad"
if ! command -v cargo > /dev/null 2>&1; then
  echo "check:rsnomad-fmt: cargo not on PATH — skip" >&2
  exit 0
fi
if [[ ! -d "${NOMAD_DIR}/.git" ]]; then
  echo "check:rsnomad-fmt: ${NOMAD_DIR} missing — run scripts/clone-ratspeak-stack.sh first" >&2
  exit 1
fi
cd "${NOMAD_DIR}"
cargo fmt --all -- --check

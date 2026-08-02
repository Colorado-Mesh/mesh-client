#!/usr/bin/env bash
# Cap LinkClient wait_for_proof at max(establishment_timeout, 30s), still bounded
# by the overall deadline — restores slow TCP hub Nomad LRPROOFs under MeshChat's
# 45s overall without burning the full window when remaining time is shorter.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PATCH_FILE="${REPO_ROOT}/reticulum-sidecar/patches/rsReticulum-link-client-proof-budget.patch"
RNS_DIR="${RS_RETICULUM_DIR:-$(cd "${REPO_ROOT}/.." && pwd)/rsReticulum}"
LINK_CLIENT_RS="${RNS_DIR}/crates/rns-runtime/src/link_client.rs"

if [[ ! -d "${RNS_DIR}/.git" ]]; then
  echo "error: rsReticulum not found at ${RNS_DIR}" >&2
  exit 1
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "error: patch not found at ${PATCH_FILE}" >&2
  exit 1
fi

short_head() {
  git -C "${RNS_DIR}" rev-parse --short HEAD
}

# Exact overlay already applied (reverse cleanly) — not a lone proof_budget token.
if git -C "${RNS_DIR}" apply --reverse --check "${PATCH_FILE}" > /dev/null 2>&1; then
  echo "link-client proof-budget overlay already present on rsReticulum @ $(short_head)"
  exit 0
fi

apply_err="$(mktemp "${TMPDIR:-/tmp}/mesh-proof-budget-apply.XXXXXX")"
trap 'rm -f "${apply_err}"' EXIT

if git -C "${RNS_DIR}" apply --check "${PATCH_FILE}" > "${apply_err}" 2>&1; then
  git -C "${RNS_DIR}" apply "${PATCH_FILE}"
  echo "applied ${PATCH_FILE} on rsReticulum @ $(short_head)"
  exit 0
fi

# Migrate #756 establishment-only cap → 30s floor (checkout already had the old overlay).
if [[ -f "${LINK_CLIENT_RS}" ]] \
  && grep -qE 'let proof_budget\s*=\s*time_remaining\(deadline\)\?\.min\(link\.establishment_timeout\)\s*;' "${LINK_CLIENT_RS}" \
  && grep -qE 'wait_for_proof\([^;]*proof_budget' "${LINK_CLIENT_RS}"; then
  python3 - "${LINK_CLIENT_RS}" << 'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()
old = re.compile(
    r"[ \t]*// Cap proof wait at link establishment timeout \(6s × hops\)\. Otherwise a\n"
    r"[ \t]*// cached path lets wait_for_proof burn the entire overall deadline\n"
    r"[ \t]*// \(e\.g\. TCP 45s\) even when MeshChat would fail the link stage in ~15s\.\n"
    r"[ \t]*let proof_budget = time_remaining\(deadline\)\?\.min\(link\.establishment_timeout\);\n"
    r"[ \t]*let proof_data = wait_for_proof\(&mut dest_rx, link_id, proof_budget\)\.await\?;\n",
)
new = (
    "        // Cap proof wait at establishment (6s × hops), but floor at 30s so slow\n"
    "        // TCP hub LRPROOFs can succeed under the MeshChat 45s overall\n"
    "        // (45 − 15s transfer grace). Still capped by time remaining.\n"
    "        let proof_budget = time_remaining(deadline)?.min(\n"
    "            link.establishment_timeout\n"
    "                .max(Duration::from_secs(30)),\n"
    "        );\n"
    "        let proof_data = wait_for_proof(&mut dest_rx, link_id, proof_budget).await?;\n"
)
updated, n = old.subn(new, text, count=1)
if n != 1:
    sys.exit("migrate: old establishment-only proof-budget block not found")
path.write_text(updated)
PY
  echo "migrated link-client proof-budget overlay to 30s floor on rsReticulum @ $(short_head)"
  exit 0
fi

# Neither reverse nor forward matched. Accept only the full upstream-equivalent data
# flow: proof_budget floors at 30s via max(establishment, 30s) AND is passed to wait_for_proof.
if [[ -f "${LINK_CLIENT_RS}" ]] \
  && grep -qE 'Duration::from_secs\(30\)' "${LINK_CLIENT_RS}" \
  && grep -qE 'establishment_timeout' "${LINK_CLIENT_RS}" \
  && grep -qE '\.max\(Duration::from_secs\(30\)\)' "${LINK_CLIENT_RS}" \
  && grep -qE 'let proof_budget\s*=' "${LINK_CLIENT_RS}" \
  && grep -qE 'wait_for_proof\([^;]*proof_budget' "${LINK_CLIENT_RS}"; then
  echo "link-client proof-budget capability already upstream on rsReticulum @ $(short_head)"
  exit 0
fi

echo "error: link-client proof-budget overlay could not be applied on rsReticulum @ $(short_head)" >&2
echo "error: neither forward apply nor reverse-check matched; git diagnostic:" >&2
cat "${apply_err}" >&2
exit 1

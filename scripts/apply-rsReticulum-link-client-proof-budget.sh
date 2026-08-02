#!/usr/bin/env bash
# Ensure LinkClient::query uses remaining overall deadline for LRPROOF (v5.25.0 /
# release parity). Older overlays capped at establishment or max(establishment, 30s)
# and false-failed slow TCP hub Nomad pages. Apply **after** the Nomad LinkClient overlay.
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

has_remaining_proof_budget() {
  [[ -f "${LINK_CLIENT_RS}" ]] \
    && grep -qE 'let proof_budget[[:space:]]*=[[:space:]]*time_remaining\(deadline\)[[:space:]]*\?;' "${LINK_CLIENT_RS}" \
    && grep -qE 'wait_for_proof\([^;]*proof_budget' "${LINK_CLIENT_RS}" \
    && ! grep -qE 'proof_budget = time_remaining\(deadline\)\?\.min\(link\.establishment_timeout\)' "${LINK_CLIENT_RS}" \
    && ! grep -qE 'establishment_timeout[[:space:]]*\.max\(Duration::from_secs\(30\)\)' "${LINK_CLIENT_RS}"
}

# Exact remaining-budget overlay already applied (reverse cleanly).
if git -C "${RNS_DIR}" apply --reverse --check "${PATCH_FILE}" > /dev/null 2>&1; then
  echo "link-client proof-budget overlay already present on rsReticulum @ $(short_head)"
  exit 0
fi

# Already on remaining-deadline (including checkouts with local debug edits).
if has_remaining_proof_budget; then
  echo "link-client proof-budget capability already upstream on rsReticulum @ $(short_head)"
  exit 0
fi

apply_err="$(mktemp "${TMPDIR:-/tmp}/mesh-proof-budget-apply.XXXXXX")"
trap 'rm -f "${apply_err}"' EXIT

if git -C "${RNS_DIR}" apply --check "${PATCH_FILE}" > "${apply_err}" 2>&1; then
  git -C "${RNS_DIR}" apply "${PATCH_FILE}"
  echo "applied ${PATCH_FILE} on rsReticulum @ $(short_head)"
  exit 0
fi

# Migrate older establishment / 30s-floor caps → remaining-deadline budget.
if [[ -f "${LINK_CLIENT_RS}" ]] \
  && grep -qE 'let proof_budget[[:space:]]*=' "${LINK_CLIENT_RS}" \
  && grep -qE 'wait_for_proof\([^;]*proof_budget' "${LINK_CLIENT_RS}"; then
  python3 - "${LINK_CLIENT_RS}" << 'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()
patterns = [
    re.compile(
        r"[ \t]*// Cap proof wait at link establishment timeout \(6s × hops\)\. Otherwise a\n"
        r"[ \t]*// cached path lets wait_for_proof burn the entire overall deadline\n"
        r"[ \t]*// \(e\.g\. TCP 45s\) even when MeshChat would fail the link stage in ~15s\.\n"
        r"[ \t]*let proof_budget = time_remaining\(deadline\)\?\.min\(link\.establishment_timeout\);\n",
    ),
    re.compile(
        r"[ \t]*// Cap proof wait at establishment \(6s × hops\), but floor at 30s so slow\n"
        r"[ \t]*// TCP hub LRPROOFs can succeed under the MeshChat 45s overall\n"
        r"[ \t]*// \(45 − 15s transfer grace\)\. Still capped by time remaining\.\n"
        r"[ \t]*let proof_budget = time_remaining\(deadline\)\?\.min\(\n"
        r"[ \t]*link\.establishment_timeout\n"
        r"[ \t]*\.max\(Duration::from_secs\(30\)\),\n"
        r"[ \t]*\);\n",
    ),
    re.compile(
        r"[ \t]*// Release / v5\.25\.0 parity: use remaining overall deadline for LRPROOF\.\n"
        r"[ \t]*// Capping at establishment \(or a 30s floor\) false-failed multi-hop TCP hub\n"
        r"[ \t]*// Nomad pages \(e\.g\. e7d84cef\) that need >30s while remaining is still ~45s\.\n"
        r"[ \t]*let proof_budget = time_remaining\(deadline\)\?;\n",
    ),
]
new = (
    "        // Release / v5.25.0 parity: use remaining overall deadline for LRPROOF.\n"
    "        // Do not cap at establishment (hops×6) or a 30s floor — that false-failed\n"
    "        // multi-hop TCP hub Nomad pages that need the rest of the MeshChat 45s window.\n"
    "        let proof_budget = time_remaining(deadline)?;\n"
)
updated = text
replaced = 0
for pat in patterns:
    updated, n = pat.subn(new, updated, count=1)
    replaced += n
    if replaced:
        break
if replaced != 1:
    # Already remaining but comments differ — accept if the assignment is correct.
    if re.search(
        r"let proof_budget = time_remaining\(deadline\)\?;", text
    ) and "wait_for_proof" in text and "proof_budget" in text:
        sys.exit(0)
    sys.exit(f"migrate: expected one capped proof_budget block, found {replaced}")
path.write_text(updated)
PY
  echo "migrated link-client proof-budget overlay to remaining-deadline on rsReticulum @ $(short_head)"
  exit 0
fi

echo "error: link-client proof-budget overlay could not be applied on rsReticulum @ $(short_head)" >&2
echo "error: neither forward apply nor reverse-check matched; git diagnostic:" >&2
cat "${apply_err}" >&2
exit 1

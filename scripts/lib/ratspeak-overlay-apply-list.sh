#!/usr/bin/env bash
# Single source of apply-script order for clone-ratspeak-stack / ensure-rsReticulum-patches / flake.nix.
# Keep patch basenames in sync with RATSPEAK_PATCH_ENTRIES in scripts/update.sh.
# shellcheck shell=bash

RS_RETICULUM_APPLY_SCRIPTS=(
  apply-rsReticulum-reply-file-query-metadata.sh
  apply-rsReticulum-packet-tap.sh
  apply-rsReticulum-auto-beacon-utun.sh
  apply-rsReticulum-link-client-proof-budget.sh
  apply-rsReticulum-ble-rnode-pairing-transition-debounce.sh
  apply-rsReticulum-ble-rnode-bond-desync.sh
  apply-rsReticulum-discovery-announce-egress.sh
  apply-rsReticulum-path-medium-slots.sh
  apply-rsReticulum-inbound-raw-saturation-log.sh
  apply-rsReticulum-interface-tx-queue-stats.sh
  apply-rsReticulum-ble-rnode-flow-control-ready-timeout.sh
  apply-rsReticulum-ble-rnode-host-rssi-cache.sh
  apply-rsReticulum-response-resource-window-fast.sh
  apply-rsReticulum-rncp-picker-pinned-jail.sh
  apply-rsReticulum-rncp-inbound-admission.sh
)

RS_LXMF_APPLY_SCRIPTS=(
  apply-rsLXMF-file-attachments-list.sh
  apply-rsLXMF-propagation-sync-peering.sh
  apply-rsLXMF-propagation-node-policy-setters.sh
  apply-rsLXMF-propagation-node-deferred-messagestore-load.sh
  apply-rsLXMF-link-delivery-has-pending-to.sh
  apply-rsLXMF-propagation-client-abort-transfer.sh
  apply-rsLXMF-propagation-client-lrproof-diagnostics.sh
)

RS_NOMAD_APPLY_SCRIPTS=(
  apply-rsNomad-picker-pinned-roots.sh
)

apply_ratspeak_rns_overlays() {
  local script_dir="$1"
  local s
  for s in "${RS_RETICULUM_APPLY_SCRIPTS[@]}"; do
    "${script_dir}/${s}" || return 1
  done
}

apply_ratspeak_lxmf_overlays() {
  local script_dir="$1"
  local s
  for s in "${RS_LXMF_APPLY_SCRIPTS[@]}"; do
    "${script_dir}/${s}" || return 1
  done
}

apply_ratspeak_nomad_overlays() {
  local script_dir="$1"
  local s
  for s in "${RS_NOMAD_APPLY_SCRIPTS[@]}"; do
    "${script_dir}/${s}" || return 1
  done
}

# apply_ratspeak_overlays_resetting_stale REPO_DIR APPLY_FN SCRIPT_DIR
# A revised patch file cannot apply over its previous revision, so a dirty
# checkout in the disposable .rsstack workspace is reset to HEAD and every
# overlay re-applied once. Checkouts outside .rsstack may hold real work and
# keep failing loud.
apply_ratspeak_overlays_resetting_stale() {
  local repo_dir="$1" apply_fn="$2" script_dir="$3"
  if "${apply_fn}" "${script_dir}"; then
    return 0
  fi
  if [[ "$(basename "$(dirname "${repo_dir}")")" != '.rsstack' ]] \
    || [[ -z "$(git -C "${repo_dir}" status --porcelain)" ]]; then
    return 1
  fi
  echo "warning: discarding stale overlays in ${repo_dir} and re-applying from $(git -C "${repo_dir}" rev-parse --short HEAD)" >&2
  git -C "${repo_dir}" reset --hard HEAD > /dev/null
  git -C "${repo_dir}" clean -fd > /dev/null
  "${apply_fn}" "${script_dir}"
}

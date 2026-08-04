#!/usr/bin/env bash
# Single source of apply-script order for clone-ratspeak-stack / ensure-rsReticulum-patches.
# Keep patch basenames in sync with RATSPEAK_PATCH_ENTRIES in scripts/update.sh.
# shellcheck shell=bash

RS_RETICULUM_APPLY_SCRIPTS=(
  apply-rsReticulum-packet-tap.sh
  apply-rsReticulum-auto-beacon-utun.sh
  apply-rsReticulum-link-client-nomad.sh
  apply-rsReticulum-link-client-proof-budget.sh
  apply-rsReticulum-ble-rnode-pairing-transition-debounce.sh
  apply-rsReticulum-discovery-announce-egress.sh
  apply-rsReticulum-path-medium-slots.sh
  apply-rsReticulum-inbound-raw-saturation-log.sh
)

RS_LXMF_APPLY_SCRIPTS=(
  apply-rsLXMF-propagation-sync-peering.sh
  apply-rsLXMF-propagation-node-policy-setters.sh
  apply-rsLXMF-link-delivery-has-pending-to.sh
)

apply_ratspeak_rns_overlays() {
  local script_dir="$1"
  local s
  for s in "${RS_RETICULUM_APPLY_SCRIPTS[@]}"; do
    "${script_dir}/${s}"
  done
}

apply_ratspeak_lxmf_overlays() {
  local script_dir="$1"
  local s
  for s in "${RS_LXMF_APPLY_SCRIPTS[@]}"; do
    "${script_dir}/${s}"
  done
}

#!/usr/bin/env bash
# Shared fail-loud overlay apply helper (keeps git apply stderr on failure).
# shellcheck shell=bash

# apply_ratspeak_overlay_or_die REPO_DIR PATCH_FILE ERROR_LABEL
# ERROR_LABEL is a short name used in the error line (e.g. "packet-tap").
apply_ratspeak_overlay_or_die() {
  local repo_dir="$1"
  local patch_file="$2"
  local error_label="$3"
  local check_out='' apply_out=''
  local short_head
  short_head="$(git -C "${repo_dir}" rev-parse --short HEAD 2> /dev/null || echo '?')"

  if ! check_out="$(git -C "${repo_dir}" apply --check "${patch_file}" 2>&1)"; then
    echo "error: ${error_label} patch did not apply on $(basename "${repo_dir}") @ ${short_head}" >&2
    if [[ -n "${check_out}" ]]; then
      printf '%s\n' "${check_out}" >&2
    fi
    echo "error: regenerate overlay (reticulum-sidecar/patches/README.md) or set RS_*_REF to a compatible commit and re-run clone-ratspeak-stack.sh" >&2
    return 1
  fi
  if ! apply_out="$(git -C "${repo_dir}" apply "${patch_file}" 2>&1)"; then
    echo "error: ${error_label} patch apply failed on $(basename "${repo_dir}") @ ${short_head}" >&2
    if [[ -n "${apply_out}" ]]; then
      printf '%s\n' "${apply_out}" >&2
    fi
    echo "error: regenerate overlay (reticulum-sidecar/patches/README.md) or set RS_*_REF to a compatible commit and re-run clone-ratspeak-stack.sh" >&2
    return 1
  fi
  echo "applied ${patch_file} on $(basename "${repo_dir}") @ ${short_head}"
  return 0
}

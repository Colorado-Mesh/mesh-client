#!/bin/sh
# Electron2 BaseApp provides zypak-wrapper; Chromium binary comes from node_modules/electron.
set -eu

APP_ROOT=/app/lib/mesh-client
ELECTRON="${APP_ROOT}/electron/electron"
# package.json "main"; launch via "." from APP_ROOT
MAIN_REL=dist-electron/main/index.js

export TMPDIR="${XDG_RUNTIME_DIR:-/tmp}/app/${FLATPAK_ID:-org.coloradomesh.MeshClient}"
mkdir -p "$TMPDIR"
export CHROME_WRAPPER=/app/bin/mesh-client

for path in "$ELECTRON" "${APP_ROOT}/${MAIN_REL}" "${APP_ROOT}/package.json"; do
  if [ ! -e "$path" ]; then
    echo "mesh-client: missing ${path}" >&2
    exit 1
  fi
done

# VMware guests need vmwgfx/3D enabled in the VM (especially macOS hosts); see docs/troubleshooting.md.
# When vmwgfx is present but Mesa DRI fails in the Flatpak sandbox, auto software rendering.
# Bare-metal aarch64 and x86_64 use full GPU acceleration by default (same finish-args).
gpu_args=
if [ "${MESH_CLIENT_ENABLE_GPU:-}" != "1" ] && [ "${MESH_CLIENT_DISABLE_GPU:-}" != "0" ]; then
  case "${MESH_CLIENT_DISABLE_GPU:-}" in
    1) ;;
    *)
      # Check each DRM card uevent explicitly (avoid recursive grep over many cards).
      vmwgfx=0
      for uevent in /sys/class/drm/card*/device/uevent; do
        [ -f "$uevent" ] || continue
        if grep -Fq 'DRIVER=vmwgfx' "$uevent" 2> /dev/null; then
          vmwgfx=1
          break
        fi
      done
      if [ "$vmwgfx" = 1 ]; then
        export MESH_CLIENT_DISABLE_GPU=1
      fi
      ;;
  esac
fi
if [ "${MESH_CLIENT_DISABLE_GPU:-}" = "1" ]; then
  gpu_args=--disable-gpu
fi

electron_args=--disable-setuid-sandbox
if [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then
  electron_args="${electron_args} --ozone-platform-hint=wayland"
fi

cd "$APP_ROOT"

retry_log="${TMPDIR}/mesh-client-sandbox.log"

# Explicit opt-in: single attempt with --no-sandbox (outer bubblewrap sandbox still active).
if [ "${MESH_CLIENT_NO_SANDBOX:-}" = "1" ]; then
  # shellcheck disable=SC2086
  exec zypak-wrapper "$ELECTRON" $gpu_args $electron_args --no-sandbox . "$@"
fi

# First attempt keeps the zypak/Chromium sandbox. On hosts blocking unprivileged user
# namespaces (Ubuntu 23.10+ AppArmor, etc.) Chromium fatals with "No usable sandbox!";
# retry once with --no-sandbox (same as scripts/start-electron.mjs fallback).
# shellcheck disable=SC2086
if zypak-wrapper "$ELECTRON" $gpu_args $electron_args . "$@" 2> "$retry_log"; then
  if [ -s "$retry_log" ]; then
    cat "$retry_log" >&2
  fi
  exit 0
fi
retry_code=$?
if grep -q 'No usable sandbox!' "$retry_log"; then
  echo "mesh-client: host blocks user namespaces; retrying with --no-sandbox (outer Flatpak sandbox still active)" >&2
  # shellcheck disable=SC2086
  exec zypak-wrapper "$ELECTRON" $gpu_args $electron_args --no-sandbox . "$@"
fi
cat "$retry_log" >&2
exit $retry_code

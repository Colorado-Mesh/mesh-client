#!/usr/bin/env bash
# Mesh-client headless container entrypoint.
#
# Starts a private Xvfb display, forwards the MESH_CLIENT_REMOTE_* configuration,
# and execs the packaged Electron binary with container-safe Chromium flags so the
# process shuts down cleanly on container stop (exec keeps PID 1 = the app).
set -euo pipefail

# Container mode is auto-detected (no MESH_CLIENT_HEADLESS needed).
: "${MESH_CLIENT_REMOTE_HOST:=0.0.0.0}" && export MESH_CLIENT_REMOTE_HOST
: "${MESH_CLIENT_REMOTE_PORT:=8000}" && export MESH_CLIENT_REMOTE_PORT
: "${MESH_CLIENT_REMOTE_VIEWPORT:=1280x800}" && export MESH_CLIENT_REMOTE_VIEWPORT

# Locate the packaged binary (PATH symlink from the deb, deb install dir, or override).
if [[ -z "${MESH_CLIENT_BIN:-}" ]]; then
  MESH_CLIENT_BIN="$(command -v mesh-client 2> /dev/null || command -v Mesh-client 2> /dev/null || true)"
fi
if [[ -z "$MESH_CLIENT_BIN" ]]; then
  MESH_CLIENT_BIN="$(find /opt -maxdepth 2 -type f \( -name mesh-client -o -name 'Mesh-client' \) 2> /dev/null | head -n 1 || true)"
fi
if [[ -z "$MESH_CLIENT_BIN" ]]; then
  echo "error: mesh-client binary not found (install the .deb or set MESH_CLIENT_BIN)" >&2
  exit 1
fi

# Private virtual display sized to the logical window (fallback if not WxH).
if [[ "$MESH_CLIENT_REMOTE_VIEWPORT" =~ ^([0-9]+)x([0-9]+)$ ]]; then
  screen_w="${BASH_REMATCH[1]}"
  screen_h="${BASH_REMATCH[2]}"
else
  screen_w=1600
  screen_h=1000
fi
Xvfb :99 -screen 0 "${screen_w}x${screen_h}x24" -nolisten tcp &
xvfb_pid=$!
export DISPLAY=:99
trap 'kill "$xvfb_pid" 2>/dev/null || true' EXIT

# Chromium cannot use its SUID sandbox as container root and /dev/shm is small in
# Docker; the app has no GPU in a container, so disable GPU/compositing (capturePage
# renders fine with software rasterization).
read -r -a extra_args <<< "${MESH_CLIENT_EXTRA_ARGS:-}"
exec "$MESH_CLIENT_BIN" \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-gpu-compositing \
  "${extra_args[@]}"

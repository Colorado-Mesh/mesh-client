#!/usr/bin/env bash
# Mesh-client headless container entrypoint.
#
# Starts a private Xvfb display, forwards the MESH_CLIENT_REMOTE_* configuration,
# and runs the packaged Electron binary with container-safe Chromium flags.
# Electron is kept as a child (not exec) so EXIT traps can tear down Xvfb.
set -euo pipefail

# Container mode is auto-detected (no MESH_CLIENT_HEADLESS needed).
: "${MESH_CLIENT_REMOTE_HOST:=0.0.0.0}" && export MESH_CLIENT_REMOTE_HOST
: "${MESH_CLIENT_REMOTE_PORT:=8000}" && export MESH_CLIENT_REMOTE_PORT
: "${MESH_CLIENT_REMOTE_VIEWPORT:=1280x800}" && export MESH_CLIENT_REMOTE_VIEWPORT
# Unattended schema upgrades (irreversible); required in headless — see docs/headless-server.md.
: "${MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE:=1}" && export MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE

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

# Private virtual display sized to the logical window (fallback matches app defaults).
if [[ "$MESH_CLIENT_REMOTE_VIEWPORT" =~ ^([0-9]+)x([0-9]+)$ ]]; then
  screen_w="${BASH_REMATCH[1]}"
  screen_h="${BASH_REMATCH[2]}"
else
  screen_w=1280
  screen_h=800
fi
Xvfb :99 -screen 0 "${screen_w}x${screen_h}x24" -nolisten tcp &
xvfb_pid=$!
export DISPLAY=:99

# Wait until the X11 socket exists (or Xvfb dies) before starting Electron.
display_ready=0
for _ in $(seq 1 50); do
  if [[ -S /tmp/.X11-unix/X99 ]]; then
    display_ready=1
    break
  fi
  if ! kill -0 "$xvfb_pid" 2> /dev/null; then
    echo "error: Xvfb failed to start" >&2
    exit 1
  fi
  sleep 0.1
done
if [[ "$display_ready" -ne 1 ]]; then
  echo "error: Xvfb display :99 not ready" >&2
  kill "$xvfb_pid" 2> /dev/null || true
  exit 1
fi

# Chromium cannot use its SUID sandbox as container root and /dev/shm is small in
# Docker; the app has no GPU in a container, so disable GPU/compositing (capturePage
# renders fine with software rasterization).
read -r -a extra_args <<< "${MESH_CLIENT_EXTRA_ARGS:-}"

app_pid=""
cleanup() {
  if [[ -n "$app_pid" ]] && kill -0 "$app_pid" 2> /dev/null; then
    kill "$app_pid" 2> /dev/null || true
    wait "$app_pid" 2> /dev/null || true
  fi
  if kill -0 "$xvfb_pid" 2> /dev/null; then
    kill "$xvfb_pid" 2> /dev/null || true
    wait "$xvfb_pid" 2> /dev/null || true
  fi
}
trap cleanup EXIT INT TERM

"$MESH_CLIENT_BIN" \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-gpu-compositing \
  "${extra_args[@]}" &
app_pid=$!
wait "$app_pid"
exit_code=$?
app_pid=""
exit "$exit_code"

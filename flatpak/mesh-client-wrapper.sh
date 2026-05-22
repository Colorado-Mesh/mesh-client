#!/bin/sh
# Electron2 BaseApp provides zypak-wrapper; Chromium binary comes from node_modules/electron.
export TMPDIR="${XDG_RUNTIME_DIR:-/tmp}/app/${FLATPAK_ID:-org.coloradomesh.MeshClient}"

# VMware / virtualized guests: Mesa often cannot use vmwgfx DRI inside the Flatpak sandbox
# ("vmwgfx: driver missing", GPU process SIGSEGV). index.ts disables HW accel when set.
# Bare-metal aarch64 and x86_64 use full GPU acceleration by default (same finish-args).
gpu_args=
if [ "${MESH_CLIENT_ENABLE_GPU:-}" != "1" ] && [ "${MESH_CLIENT_DISABLE_GPU:-}" != "0" ]; then
  case "${MESH_CLIENT_DISABLE_GPU:-}" in
    1) ;;
    *)
      if grep -rq 'DRIVER=vmwgfx' /sys/class/drm/card*/device/uevent 2> /dev/null; then
        export MESH_CLIENT_DISABLE_GPU=1
      fi
      ;;
  esac
fi
if [ "${MESH_CLIENT_DISABLE_GPU:-}" = "1" ]; then
  gpu_args=--disable-gpu
fi

cd /app/lib/mesh-client || exit 1
if [ -n "$gpu_args" ]; then
  exec zypak-wrapper /app/lib/mesh-client/electron/electron \
    "$gpu_args" \
    /app/lib/mesh-client/dist-electron/main/index.js "$@"
fi
exec zypak-wrapper /app/lib/mesh-client/electron/electron \
  /app/lib/mesh-client/dist-electron/main/index.js "$@"

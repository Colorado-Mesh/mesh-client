#!/bin/sh
# Electron2 BaseApp provides zypak-wrapper; Chromium binary comes from node_modules/electron.
export TMPDIR="${XDG_RUNTIME_DIR:-/tmp}/app/${FLATPAK_ID:-org.coloradomesh.MeshClient}"

# aarch64 Flatpak: host DRM sysfs is often invisible in the sandbox; vmwgfx and similar drivers
# log "driver missing" and the GPU process can SIGSEGV. index.ts disables HW accel when set.
MESH_CLIENT_GPU_ARGS=
if [ "${MESH_CLIENT_ENABLE_GPU:-}" != "1" ] && [ "${MESH_CLIENT_DISABLE_GPU:-}" != "0" ]; then
  case "$(uname -m)" in
    aarch64 | arm64)
      export MESH_CLIENT_DISABLE_GPU=1
      MESH_CLIENT_GPU_ARGS=--disable-gpu
      ;;
  esac
fi

cd /app/lib/mesh-client || exit 1
exec zypak-wrapper /app/lib/mesh-client/electron/electron \
  ${MESH_CLIENT_GPU_ARGS} \
  /app/lib/mesh-client/dist-electron/main/index.js "$@"

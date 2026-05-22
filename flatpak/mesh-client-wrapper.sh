#!/bin/sh
# Electron2 BaseApp provides zypak-wrapper; Chromium binary comes from node_modules/electron.
export TMPDIR="${XDG_RUNTIME_DIR:-/tmp}/app/${FLATPAK_ID:-org.coloradomesh.MeshClient}"

# VMware vmwgfx: Mesa often has no working DRI driver in the Flatpak sandbox (vmwgfx: driver missing),
# which can SIGSEGV the GPU process. index.ts calls app.disableHardwareAcceleration() when set.
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

cd /app/lib/mesh-client || exit 1
exec zypak-wrapper /app/lib/mesh-client/electron/electron /app/lib/mesh-client/dist-electron/main/index.js "$@"

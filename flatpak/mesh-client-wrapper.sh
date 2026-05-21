#!/bin/sh
# Electron2 BaseApp provides zypak-wrapper; Chromium binary comes from node_modules/electron.
export TMPDIR="${XDG_RUNTIME_DIR:-/tmp}/app/${FLATPAK_ID:-org.coloradomesh.MeshClient}"
cd /app/lib/mesh-client || exit 1
exec zypak-wrapper /app/lib/mesh-client/electron/electron /app/lib/mesh-client/dist-electron/main/index.js "$@"

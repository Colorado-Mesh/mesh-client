# Mesh-client - headless "server mode" container.
#
# Consumes a Linux .deb from the "Build Binaries (no release)" CI workflow and runs
# the client against a private Xvfb display; browsers talk to it over HTTP + WebSocket.
# No physical display, GPU, Bluetooth, or serial is required.
#
# Build:
#   1. Grab the Linux artifact (Actions run summary page) or:
#        gh run download <run-id> -n mesh-client-linux-<sha>
#      which yields <dir>/release/ containing the .deb installers, READ-ME-FIRST,
#      this Dockerfile, and docker/entrypoint.sh (the artifact is a self-contained
#      build context).
#   2. Pick the architecture's .deb and pass its basename via DEB_BASENAME, building
#      with the release/ directory as the build context:
#        docker build -t mesh-client-headless --platform linux/amd64 \
#          --build-arg DEB_BASENAME=mesh-client_1.2.3_amd64.deb release
#      Only ONE architecture's deb is installed (x64 -> linux/amd64,
#      arm64 -> linux/arm64); the build arg prevents multi-arch installs.
#
# Run (MESH_CLIENT_REMOTE_TOKEN is required when binding 0.0.0.0):
#   docker run -d --name mesh-client -p 8000:8000 \
#     -e MESH_CLIENT_REMOTE_TOKEN=sekrit \
#     mesh-client-headless
#   open http://<container-host-ip>:8000/?token=sekrit
#
# See docs/headless-server.md for env vars, security, and reverse-proxy TLS.
#
# Optional: attach LoRa radios over USB serial / BLE -
#   docker run ... --device=/dev/ttyUSB0 --privileged mesh-client-headless

ARG BASE_IMAGE=ubuntu:24.04
FROM ${BASE_IMAGE}

# Basename of the single-architecture .deb to install (see header comment).
ARG DEB_BASENAME
RUN test -n "$DEB_BASENAME" || (echo "error: DEB_BASENAME build arg is required" >&2 && exit 1)

# Electron GUI/runtime baseline + Xvfb for the private virtual display.
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    xvfb \
    ca-certificates \
    fonts-liberation \
    libasound2t64 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libnotify4 \
    libpango-1.0-0 \
    libu2f-udev \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# Install the packaged client (apt resolves its declared dependencies).
# Build context is the release/ dir, so the deb sits at the context root.
COPY ${DEB_BASENAME} /install/
RUN DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends /install/${DEB_BASENAME} \
  && rm -rf /install

COPY docker/entrypoint.sh /usr/local/bin/mesh-client-entrypoint.sh
RUN chmod +x /usr/local/bin/mesh-client-entrypoint.sh

ENV MESH_CLIENT_REMOTE_HOST=0.0.0.0 \
  MESH_CLIENT_REMOTE_PORT=8000 \
  MESH_CLIENT_REMOTE_VIEWPORT=1280x800

EXPOSE 8000

ENTRYPOINT ["/usr/local/bin/mesh-client-entrypoint.sh"]

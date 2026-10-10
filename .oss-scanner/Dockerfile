# Build environment for Anthropic's OSS Scanner (https://github.com/anthropics/oss-scanner).
# The scanner builds this with the repository checkout as the context and network access; everything after
# this build runs offline, so every dependency the build and tests need is fetched here.
FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
  CI=1 \
  MESHTASTIC_SKIP_ELECTRON_REBUILD=1 \
  CARGO_HOME=/usr/local/cargo \
  RUSTUP_HOME=/usr/local/rustup \
  PATH=/usr/local/cargo/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates curl git build-essential pkg-config python3 \
  libdbus-1-dev libudev-dev libusb-1.0-0-dev \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable \
  && rustc --version

RUN npm install -g pnpm@12.11.2 && pnpm --version

# scanner contract: the checkout lives inside the image, at /src
COPY . /src
WORKDIR /src

# Electron's native rebuild is skipped: the scanner and Vitest run on plain Node, not inside Electron.
RUN pnpm install --frozen-lockfile

RUN pnpm run build

# Reticulum sidecar (Rust). The clone script fetches the Ratspeak stack into /src/.rsstack and applies overlays.
# Test binaries are compiled now so `cargo test --offline` works in the sandbox.
RUN bash scripts/clone-ratspeak-stack.sh \
  && cd reticulum-sidecar \
  && cargo build --features rns-stack,rns-ble,rns-rnode-tcp \
  && cargo test --features rns-stack,rns-ble,rns-rnode-tcp --no-run

# Run the TypeScript tests for the Node-side code to check the image works; failures must not abort the build.
RUN pnpm run test:main || echo "WARNING: vitest main project reported failures"

#!/usr/bin/env bash
# Apt packages for the Linux packaging-smoke AppImage extract + headless launch.
# Shared by build.yaml and release.yaml so the package list cannot drift.
set -euo pipefail

sudo apt-get update
sudo apt-get install -y \
  squashfs-tools \
  xvfb \
  libnss3 \
  libatk-bridge2.0-0t64 \
  libgtk-3-0t64 \
  libgbm1 \
  libasound2t64 \
  libxshmfence1 \
  libx11-xcb1 \
  libxcb1 \
  libxext6 \
  libxfixes3 \
  libxrender1 \
  libxi6 \
  libdrm2 \
  libdbus-1-3

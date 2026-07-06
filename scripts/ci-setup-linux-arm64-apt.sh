#!/usr/bin/env bash
# Configure apt for amd64 + arm64 cross-builds on Ubuntu 24.04 GitHub runners.
#
# Failure point: `dpkg --add-architecture arm64` without arch-pinned sources makes apt
# request arm64 indexes from archive/security mirrors that only host amd64 → 404.
# Fallback: pin existing deb822 stanzas to amd64 and add ports.ubuntu.com for arm64.
# Refs: https://github.com/actions/runner-images/issues/10901
set -euo pipefail

ubuntu_sources=/etc/apt/sources.list.d/ubuntu.sources
if [[ ! -f "${ubuntu_sources}" ]]; then
  echo "ci-setup-linux-arm64-apt: expected ${ubuntu_sources} (Ubuntu 24.04 deb822 format)" >&2
  exit 1
fi

sudo sed -i '/^Types: deb$/a Architectures: amd64' "${ubuntu_sources}"

sudo tee /etc/apt/sources.list.d/arm64.list > /dev/null << 'EOF'
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports noble main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports noble-updates main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports noble-backports main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports noble-security main restricted universe multiverse
EOF

sudo dpkg --add-architecture arm64
sudo apt-get update

#!/usr/bin/env bash
# Configure apt for amd64 + arm64 cross-builds on Ubuntu GitHub runners.
#
# Failure point: `dpkg --add-architecture arm64` without arch-pinned sources makes apt
# request arm64 indexes from archive/security mirrors that only host amd64 → 404.
# Fallback: pin existing deb822 stanzas to amd64 and add ports.ubuntu.com for arm64.
# Refs: https://github.com/actions/runner-images/issues/10901
set -euo pipefail

ubuntu_codename=""
if [[ -r /etc/os-release ]]; then
  # shellcheck source=/dev/null
  . /etc/os-release
  ubuntu_codename="${VERSION_CODENAME:-}"
fi
if [[ -z "${ubuntu_codename}" ]] && command -v lsb_release > /dev/null 2>&1; then
  ubuntu_codename="$(lsb_release -cs)"
fi
if [[ -z "${ubuntu_codename}" ]]; then
  echo "ci-setup-linux-arm64-apt: could not determine Ubuntu release codename" >&2
  exit 1
fi

ubuntu_sources=/etc/apt/sources.list.d/ubuntu.sources
if [[ ! -f "${ubuntu_sources}" ]]; then
  echo "ci-setup-linux-arm64-apt: expected ${ubuntu_sources} (Ubuntu deb822 format)" >&2
  exit 1
fi

if ! grep -q '^Architectures:' "${ubuntu_sources}"; then
  sudo sed -i '/^Types: deb$/a Architectures: amd64' "${ubuntu_sources}"
fi

sudo tee /etc/apt/sources.list.d/arm64.list > /dev/null << EOF
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports ${ubuntu_codename} main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports ${ubuntu_codename}-updates main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports ${ubuntu_codename}-backports main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports ${ubuntu_codename}-security main restricted universe multiverse
EOF

sudo dpkg --add-architecture arm64
sudo apt-get update

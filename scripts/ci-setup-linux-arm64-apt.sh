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

# Insert Architectures: amd64 only inside deb stanzas that lack Architectures (idempotent).
pin_deb822_amd64_stanzas() {
  local file="$1"
  local tmp
  tmp="$(mktemp)"
  awk '
    function flush_stanza(i, has_deb, has_arch, inserted) {
      if (stanza_count == 0) return
      has_deb = 0
      has_arch = 0
      for (i = 1; i <= stanza_count; i++) {
        if (stanza[i] ~ /^Types: deb$/) has_deb = 1
        if (stanza[i] ~ /^Architectures:/) has_arch = 1
      }
      inserted = 0
      for (i = 1; i <= stanza_count; i++) {
        print stanza[i]
        if (!inserted && has_deb && !has_arch && stanza[i] ~ /^Types: deb$/) {
          print "Architectures: amd64"
          inserted = 1
        }
      }
      stanza_count = 0
    }
    BEGIN { stanza_count = 0 }
    /^[[:space:]]*$/ {
      flush_stanza()
      print ""
      next
    }
    {
      stanza_count++
      stanza[stanza_count] = $0
    }
    END { flush_stanza() }
  ' "${file}" > "${tmp}"
  sudo cp "${tmp}" "${file}"
  rm -f "${tmp}"
}

if awk '
  function flush_stanza(i, has_deb, has_arch) {
    if (stanza_count == 0) return
    has_deb = 0
    has_arch = 0
    for (i = 1; i <= stanza_count; i++) {
      if (stanza[i] ~ /^Types: deb$/) has_deb = 1
      if (stanza[i] ~ /^Architectures:/) has_arch = 1
    }
    if (has_deb && !has_arch) needs_pin = 1
    stanza_count = 0
  }
  BEGIN { stanza_count = 0; needs_pin = 0 }
  /^[[:space:]]*$/ { flush_stanza(); next }
  { stanza_count++; stanza[stanza_count] = $0 }
  END { flush_stanza(); exit(needs_pin ? 0 : 1) }
' "${ubuntu_sources}"; then
  pin_deb822_amd64_stanzas "${ubuntu_sources}"
fi

arm64_sources=/etc/apt/sources.list.d/arm64.sources
arm64_sources_expected="$(
  cat << EOF
Types: deb
URIs: http://ports.ubuntu.com/ubuntu-ports
Suites: ${ubuntu_codename} ${ubuntu_codename}-updates ${ubuntu_codename}-backports ${ubuntu_codename}-security
Components: main restricted universe multiverse
Architectures: arm64
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF
)"

if [[ ! -f "${arm64_sources}" ]] || ! cmp -s <(printf '%s\n' "${arm64_sources_expected}") "${arm64_sources}"; then
  printf '%s\n' "${arm64_sources_expected}" | sudo tee "${arm64_sources}" > /dev/null
fi

# Migrate away from legacy one-line format if a prior run created it.
if [[ -f /etc/apt/sources.list.d/arm64.list ]]; then
  sudo rm -f /etc/apt/sources.list.d/arm64.list
fi

sudo dpkg --add-architecture arm64
sudo apt-get update

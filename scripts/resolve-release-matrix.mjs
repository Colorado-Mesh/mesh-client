#!/usr/bin/env node
/**
 * Emit a GitHub Actions matrix `include` JSON for release.yaml platform filtering.
 */

const ROWS = [
  {
    os: 'macos-latest',
    platform_key: 'mac',
    // Build only — GitHub upload is ci-upload-release-assets.mjs (never POST /releases).
    build_script: 'pnpm run dist:mac',
    upload_globs:
      'release/*.dmg release/*.zip release/*.blockmap release/latest-mac.yml release/mac*/*.dmg release/mac*/*.zip release/mac*/*.blockmap release/00-READ-ME-BEFORE-EXTRACTING-macOS-ZIP.txt',
    sidecar_platform: 'darwin',
    rust_targets: 'aarch64-apple-darwin',
  },
  {
    os: 'ubuntu-latest',
    platform_key: 'linux',
    build_script: 'pnpm run dist:linux',
    upload_globs:
      'release/*.AppImage release/*.rpm release/*.deb release/*.blockmap release/latest-linux.yml release/latest-linux-arm64.yml',
    sidecar_platform: 'linux',
    rust_targets: 'x86_64-unknown-linux-gnu,aarch64-unknown-linux-gnu',
  },
  {
    os: 'windows-latest',
    platform_key: 'win',
    build_script: 'pnpm run dist:win',
    upload_globs: 'release/*.exe release/*.blockmap release/latest.yml',
    sidecar_platform: 'win32',
    rust_targets: 'x86_64-pc-windows-msvc,aarch64-pc-windows-msvc',
  },
];

function resolvePlatforms(raw) {
  const value = (raw ?? 'all').trim() || 'all';
  if (value === 'all') {
    return ROWS;
  }
  const keys = new Set(
    value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
  );
  return ROWS.filter((row) => keys.has(row.platform_key));
}

const platforms = process.argv[2] ?? process.env.RELEASE_PLATFORMS ?? 'all';
const selected = resolvePlatforms(platforms);
if (selected.length === 0) {
  console.error('[resolve-release-matrix] No release platforms matched input:', platforms);
  process.exit(1);
}

process.stdout.write(JSON.stringify(selected));

import { describe, expect, it } from 'vitest';

import {
  buildLaunchArgs,
  buildLaunchEnv,
  logShowsStartup,
  shouldLaunchOnHost,
  STARTUP_ALIVE_MS,
} from './test-linux-appimage-launch.mjs';
import { EM_AARCH64, EM_X86_64 } from './test-linux-appimage-reticulum-sidecar.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/** Build a minimal ELF header with the given e_machine for an AppImage fixture. */
function writeElfAppImage(dir, name, machine) {
  const header = Buffer.alloc(64);
  header[0] = 0x7f;
  header[1] = 0x45; // E
  header[2] = 0x4c; // L
  header[3] = 0x46; // F
  header.writeUInt16LE(machine, 18);
  const filePath = path.join(dir, name);
  writeFileSync(filePath, header);
  return filePath;
}

describe('logShowsStartup', () => {
  it('detects the [main] startup marker', () => {
    expect(logShowsStartup('2026-01-01 [main] crashReporter started')).toBe(true);
    expect(logShowsStartup('noise\nmore noise\n[main] initialized\n')).toBe(true);
  });

  it('returns false for logs without the marker', () => {
    expect(logShowsStartup('[renderer] hello only')).toBe(false);
    expect(logShowsStartup('')).toBe(false);
  });

  it('returns false for non-string input', () => {
    // @ts-expect-error intentional wrong type
    expect(logShowsStartup(undefined)).toBe(false);
    // @ts-expect-error intentional wrong type
    expect(logShowsStartup(null)).toBe(false);
  });
});

describe('shouldLaunchOnHost', () => {
  it('launches a native-arch AppImage', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'launch-arch-'));
    try {
      const x64 = writeElfAppImage(dir, 'app-x64.AppImage', EM_X86_64);
      const arm64 = writeElfAppImage(dir, 'app-arm64.AppImage', EM_AARCH64);
      expect(shouldLaunchOnHost(x64, 'x64')).toBe(true);
      expect(shouldLaunchOnHost(arm64, 'arm64')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips a cross-arch AppImage that cannot execute on the host', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'launch-arch-'));
    try {
      const arm64 = writeElfAppImage(dir, 'app-arm64.AppImage', EM_AARCH64);
      expect(shouldLaunchOnHost(arm64, 'x64')).toBe(false);
      const x64 = writeElfAppImage(dir, 'app-x64.AppImage', EM_X86_64);
      expect(shouldLaunchOnHost(x64, 'arm64')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('buildLaunchArgs', () => {
  it('redirects user data and disables the sandbox for headless CI', () => {
    const args = buildLaunchArgs('/tmp/ud');
    expect(args).toContain('--user-data-dir=/tmp/ud');
    expect(args).toContain('--no-sandbox');
    expect(args).toContain('--disable-setuid-sandbox');
  });
});

describe('buildLaunchEnv', () => {
  it('disables GPU/HW acceleration and preserves the base env', () => {
    const env = buildLaunchEnv({ EXISTING: '1' });
    expect(env.MESH_CLIENT_DISABLE_GPU).toBe('1');
    expect(env.EXISTING).toBe('1');
  });
});

describe('timing constants', () => {
  it('keeps the alive threshold positive', () => {
    expect(STARTUP_ALIVE_MS).toBeGreaterThan(0);
  });
});

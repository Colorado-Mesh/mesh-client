import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  assertBundledReticulumSidecar,
  resolveBundledSidecarPath,
} from './assert-bundled-reticulum-sidecar.mjs';
import { EM_AARCH64, EM_X86_64 } from './binary-arch.mjs';

/** @param {number} machine */
function elfHeader(machine) {
  const header = Buffer.alloc(64);
  header[0] = 0x7f;
  header[1] = 0x45;
  header[2] = 0x4c;
  header[3] = 0x46;
  header.writeUInt16LE(machine, 18);
  return header;
}

describe('assert-bundled-reticulum-sidecar', () => {
  it('resolves bundled sidecar paths per platform layout', () => {
    expect(resolveBundledSidecarPath('win32', '/app/win-unpacked')).toBe(
      path.join('/app/win-unpacked/resources/reticulum-sidecar/mesh-client-reticulum.exe'),
    );
    expect(resolveBundledSidecarPath('linux', '/app/linux-unpacked')).toBe(
      path.join('/app/linux-unpacked/resources/reticulum-sidecar/mesh-client-reticulum'),
    );
    expect(resolveBundledSidecarPath('darwin', '/app/Mesh-client.app')).toBe(
      path.join('/app/Mesh-client.app/Contents/Resources/reticulum-sidecar/mesh-client-reticulum'),
    );
  });

  it('passes expectedArch when the fabricated ELF matches', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mesh-sidecar-arch-ok-'));
    const calls = [];
    try {
      const sidecarPath = path.join(dir, 'mesh-client-reticulum');
      // Size must clear MIN_SIDECAR_BYTES (1 MiB).
      const body = Buffer.alloc(1024 * 1024 + 64);
      elfHeader(EM_X86_64).copy(body);
      writeFileSync(sidecarPath, body);
      assertBundledReticulumSidecar({
        label: 'test sidecar',
        sidecarPath,
        fail: (m) => calls.push(m),
        platform: 'linux',
        expectedArch: 'x64',
      });
      expect(calls).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('calls fail on expectedArch mismatch', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mesh-sidecar-arch-bad-'));
    const calls = [];
    try {
      const sidecarPath = path.join(dir, 'mesh-client-reticulum');
      const body = Buffer.alloc(1024 * 1024 + 64);
      elfHeader(EM_AARCH64).copy(body);
      writeFileSync(sidecarPath, body);
      assertBundledReticulumSidecar({
        label: 'test sidecar',
        sidecarPath,
        fail: (m) => calls.push(m),
        platform: 'linux',
        expectedArch: 'x64',
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatch(/test sidecar/);
      expect(calls[0]).toContain(sidecarPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips arch assert when expectedArch is omitted (back-compat)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mesh-sidecar-arch-omit-'));
    const calls = [];
    try {
      mkdirSync(dir, { recursive: true });
      const sidecarPath = path.join(dir, 'mesh-client-reticulum');
      writeFileSync(sidecarPath, Buffer.alloc(1024 * 1024 + 1));
      assertBundledReticulumSidecar({
        label: 'test sidecar',
        sidecarPath,
        fail: (m) => calls.push(m),
      });
      expect(calls).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  EM_AARCH64,
  EM_X86_64,
  assertBinaryArch,
  elfMachineToArch,
  readElfMachine,
  readElfMachineFromHeader,
  readMachOArchs,
  readPeMachine,
} from './binary-arch.mjs';

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

/** @param {number} machine PE Machine word */
function peStub(machine) {
  const buf = Buffer.alloc(0x48);
  buf[0] = 0x4d; // M
  buf[1] = 0x5a; // Z
  buf.writeUInt32LE(0x40, 0x3c);
  buf[0x40] = 0x50; // P
  buf[0x41] = 0x45; // E
  buf[0x42] = 0x00;
  buf[0x43] = 0x00;
  buf.writeUInt16LE(machine, 0x44);
  return buf;
}

describe('ELF readers', () => {
  it('reads e_machine from a valid header', () => {
    expect(readElfMachineFromHeader(elfHeader(EM_X86_64))).toBe(EM_X86_64);
    expect(readElfMachineFromHeader(elfHeader(EM_AARCH64))).toBe(EM_AARCH64);
    expect(elfMachineToArch(EM_X86_64)).toBe('x64');
    expect(elfMachineToArch(EM_AARCH64)).toBe('arm64');
  });

  it('rejects bad magic', () => {
    const bad = Buffer.alloc(20);
    expect(readElfMachineFromHeader(bad)).toBeNull();
  });

  it('reads e_machine from a file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mesh-elf-'));
    try {
      const filePath = path.join(dir, 'bin');
      writeFileSync(filePath, elfHeader(EM_X86_64));
      expect(readElfMachine(filePath)).toBe(EM_X86_64);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('PE reader', () => {
  it('reads x64 and arm64 Machine fields', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mesh-pe-'));
    try {
      const x64Path = path.join(dir, 'x64.exe');
      const armPath = path.join(dir, 'arm64.exe');
      writeFileSync(x64Path, peStub(0x8664));
      writeFileSync(armPath, peStub(0xaa64));
      expect(readPeMachine(x64Path)).toBe('x64');
      expect(readPeMachine(armPath)).toBe('arm64');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns unknown for non-PE input', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mesh-pe-bad-'));
    try {
      const filePath = path.join(dir, 'not-pe');
      writeFileSync(filePath, Buffer.from('not a pe'));
      expect(readPeMachine(filePath)).toBe('unknown');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Mach-O reader', () => {
  it.skipIf(process.platform !== 'darwin')('reports host arch for process.execPath', () => {
    const archs = readMachOArchs(process.execPath);
    const host = process.arch === 'arm64' ? 'arm64' : 'x64';
    expect(archs).toContain(host);
  });
});

describe('assertBinaryArch', () => {
  it('passes when ELF arch matches', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mesh-arch-ok-'));
    const calls = [];
    try {
      const filePath = path.join(dir, 'sidecar');
      writeFileSync(filePath, elfHeader(EM_AARCH64));
      assertBinaryArch({
        label: 'sidecar',
        filePath,
        expectedArch: 'arm64',
        platform: 'linux',
        fail: (m) => calls.push(m),
      });
      expect(calls).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails on ELF arch mismatch', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mesh-arch-bad-'));
    const calls = [];
    try {
      const filePath = path.join(dir, 'sidecar');
      writeFileSync(filePath, elfHeader(EM_X86_64));
      assertBinaryArch({
        label: 'sidecar',
        filePath,
        expectedArch: 'arm64',
        platform: 'linux',
        fail: (m) => calls.push(m),
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatch(/does not include expected arm64/);
      expect(calls[0]).toContain(filePath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when architecture cannot be determined', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mesh-arch-unk-'));
    const calls = [];
    try {
      const filePath = path.join(dir, 'sidecar');
      writeFileSync(filePath, Buffer.from('nope'));
      assertBinaryArch({
        label: 'sidecar',
        filePath,
        expectedArch: 'x64',
        platform: 'linux',
        fail: (m) => calls.push(m),
      });
      expect(calls[0]).toMatch(/could not be determined/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

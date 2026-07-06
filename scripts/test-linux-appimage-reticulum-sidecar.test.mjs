import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  EM_AARCH64,
  EM_X86_64,
  appImageNeedsUnsquashfsExtract,
  findSquashfsOffset,
  hostElfMachine,
  prepareAppImageExtractDir,
  readElfMachine,
  readElfMachineFromHeader,
} from './test-linux-appimage-reticulum-sidecar.mjs';

/** @param {number} machine ELF e_machine */
function makeElfHeader(machine) {
  const header = Buffer.alloc(20);
  header[0] = 0x7f;
  header[1] = 0x45;
  header[2] = 0x4c;
  header[3] = 0x46;
  header[4] = 2;
  header[5] = 1;
  header.writeUInt16LE(machine, 18);
  return header;
}

describe('test-linux-appimage-reticulum-sidecar', () => {
  it('prepareAppImageExtractDir creates cwd so spawnSync does not fail with ENOENT', () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'mesh-appimage-extract-'));
    const extractDir = path.join(parent, 'extract');
    try {
      prepareAppImageExtractDir(extractDir);
      expect(existsSync(extractDir)).toBe(true);

      const result = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { cwd: extractDir });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('readElfMachineFromHeader reads e_machine from ELF header bytes', () => {
    expect(readElfMachineFromHeader(makeElfHeader(EM_X86_64))).toBe(EM_X86_64);
    expect(readElfMachineFromHeader(makeElfHeader(EM_AARCH64))).toBe(EM_AARCH64);
    expect(readElfMachineFromHeader(Buffer.from('not-elf'))).toBeNull();
  });

  it('appImageNeedsUnsquashfsExtract is true for cross-arch AppImages', () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'mesh-appimage-elf-'));
    const appImagePath = path.join(parent, 'fake.AppImage');
    try {
      writeFileSync(appImagePath, makeElfHeader(EM_AARCH64));
      expect(hostElfMachine('x64')).toBe(EM_X86_64);
      expect(appImageNeedsUnsquashfsExtract(appImagePath, 'x64')).toBe(true);
      expect(appImageNeedsUnsquashfsExtract(appImagePath, 'arm64')).toBe(false);
      expect(readElfMachine(appImagePath)).toBe(EM_AARCH64);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('findSquashfsOffset reads type-2 header offset and falls back to hsqs scan', () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'mesh-appimage-sqfs-'));
    const headerOffsetPath = path.join(parent, 'header.AppImage');
    const scanPath = path.join(parent, 'scan.AppImage');
    try {
      const offset = 128;
      const withHeader = Buffer.alloc(256);
      withHeader.writeBigUInt64LE(BigInt(offset), 8);
      withHeader.write('hsqs', offset);
      writeFileSync(headerOffsetPath, withHeader);
      expect(findSquashfsOffset(headerOffsetPath)).toBe(offset);

      const scanOffset = 64;
      const withoutHeader = Buffer.alloc(128);
      withoutHeader.write('hsqs', scanOffset);
      writeFileSync(scanPath, withoutHeader);
      expect(findSquashfsOffset(scanPath)).toBe(scanOffset);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

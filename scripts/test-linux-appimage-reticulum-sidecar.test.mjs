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
  isSquashfsV4Superblock,
  prepareAppImageExtractDir,
  readAsarRootPackageVersion,
  readDesktopAppImageVersion,
  readElfMachine,
  readElfMachineFromHeader,
} from './test-linux-appimage-reticulum-sidecar.mjs';

/** Write a minimal squashfs-v4-looking superblock magic+maj at `offset`. */
function writeSquashfsV4Magic(buf, offset) {
  buf.write('hsqs', offset);
  buf.writeUInt16LE(4, offset + 28);
}

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

  it('prepareAppImageExtractDir preserves an existing unique extract directory', () => {
    const extractDir = mkdtempSync(path.join(tmpdir(), 'mesh-appimage-unique-'));
    const marker = path.join(extractDir, 'keep-me.txt');
    try {
      writeFileSync(marker, 'ok');
      prepareAppImageExtractDir(extractDir);
      expect(existsSync(extractDir)).toBe(true);
      expect(existsSync(marker)).toBe(true);
    } finally {
      rmSync(extractDir, { recursive: true, force: true });
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
      writeSquashfsV4Magic(withHeader, offset);
      writeFileSync(headerOffsetPath, withHeader);
      expect(findSquashfsOffset(headerOffsetPath)).toBe(offset);
      expect(isSquashfsV4Superblock(headerOffsetPath, offset)).toBe(true);

      const scanOffset = 64;
      const withoutHeader = Buffer.alloc(128);
      writeSquashfsV4Magic(withoutHeader, scanOffset);
      writeFileSync(scanPath, withoutHeader);
      expect(findSquashfsOffset(scanPath)).toBe(scanOffset);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('findSquashfsOffset skips ELF false-positive hsqs without squashfs v4 major', () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'mesh-appimage-sqfs-false-'));
    const appImagePath = path.join(parent, 'false.AppImage');
    try {
      const buf = Buffer.alloc(256);
      // Bare magic (no maj=4) — must not be treated as the payload start.
      buf.write('hsqs', 32);
      const realOffset = 128;
      writeSquashfsV4Magic(buf, realOffset);
      writeFileSync(appImagePath, buf);
      expect(isSquashfsV4Superblock(appImagePath, 32)).toBe(false);
      expect(findSquashfsOffset(appImagePath)).toBe(realOffset);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('readDesktopAppImageVersion parses X-AppImage-Version', () => {
    const parent = mkdtempSync(path.join(tmpdir(), 'mesh-appimage-desktop-'));
    const desktopPath = path.join(parent, 'mesh-client.desktop');
    try {
      writeFileSync(desktopPath, '[Desktop Entry]\nName=Mesh-client\nX-AppImage-Version=6.6.0\n');
      expect(readDesktopAppImageVersion(desktopPath)).toBe('6.6.0');
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('readAsarRootPackageVersion reads the packaged app version', () => {
    // Built from a tiny pickle+JSON asar with only package.json (mirrors Electron layout).
    const parent = mkdtempSync(path.join(tmpdir(), 'mesh-appimage-asar-'));
    const asarPath = path.join(parent, 'app.asar');
    try {
      const pkgJson = Buffer.from(
        JSON.stringify({ name: 'mesh-client', version: '9.9.9' }),
        'utf8',
      );
      const filesHeader = JSON.stringify({
        files: {
          'package.json': { size: pkgJson.length, offset: '0' },
        },
      });
      // header pickle: uint32 payloadSize, uint32 strLen, string, padding to 4-byte align
      const strLen = Buffer.byteLength(filesHeader, 'utf8');
      const headerPayload = Buffer.alloc(4 + 4 + strLen);
      headerPayload.writeUInt32LE(4 + strLen, 0);
      headerPayload.writeUInt32LE(strLen, 4);
      headerPayload.write(filesHeader, 8, 'utf8');
      const headerSize = headerPayload.length;
      const sizePickle = Buffer.alloc(8);
      sizePickle.writeUInt32LE(4, 0);
      sizePickle.writeUInt32LE(headerSize, 4);
      writeFileSync(asarPath, Buffer.concat([sizePickle, headerPayload, pkgJson]));
      expect(readAsarRootPackageVersion(asarPath)).toBe('9.9.9');
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

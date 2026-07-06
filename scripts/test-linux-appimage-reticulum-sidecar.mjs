#!/usr/bin/env node
/**
 * CI smoke: extract Linux AppImages and assert the Reticulum sidecar is bundled.
 *
 * Works when packaging-smoke artifacts include AppImages but not linux-unpacked dirs.
 */
import { spawnSync } from 'child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'fs';
import { tmpdir } from 'os';
import path, { resolve } from 'path';
import { fileURLToPath } from 'url';
import { assertBundledReticulumSidecarInBundle } from './assert-bundled-reticulum-sidecar.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const releaseDir = path.join(projectRoot, 'release');

/** @param {string} msg */
function fail(msg) {
  console.error(`[test-linux-appimage-reticulum-sidecar] ${msg}`);
  process.exit(1);
}

/** @param {string} name */
function isArm64Name(name) {
  return /arm64|aarch64/i.test(name);
}

/** ELF e_machine values for Linux AppImage runtimes we ship. */
export const EM_X86_64 = 62;
export const EM_AARCH64 = 183;

const SQUASHFS_MAGIC = Buffer.from('hsqs');

/** @param {Buffer} header At least 20 bytes from the start of an ELF file. */
export function readElfMachineFromHeader(header) {
  if (
    header.length < 20 ||
    header[0] !== 0x7f ||
    header[1] !== 0x45 ||
    header[2] !== 0x4c ||
    header[3] !== 0x46
  ) {
    return null;
  }
  return header.readUInt16LE(18);
}

/** @param {string} appImagePath */
export function readElfMachine(appImagePath) {
  const header = readBytes(appImagePath, 0, 20);
  return readElfMachineFromHeader(header);
}

/** @param {string} [hostArch=process.arch] */
export function hostElfMachine(hostArch = process.arch) {
  if (hostArch === 'arm64') return EM_AARCH64;
  if (hostArch === 'x64') return EM_X86_64;
  return null;
}

/**
 * True when the AppImage runtime cannot execute on this host (e.g. arm64 image on x64 CI).
 * @param {string} appImagePath
 * @param {string} [hostArch=process.arch]
 */
export function appImageNeedsUnsquashfsExtract(appImagePath, hostArch = process.arch) {
  const imageMachine = readElfMachine(appImagePath);
  const machine = hostElfMachine(hostArch);
  if (imageMachine === null || machine === null) return false;
  return imageMachine !== machine;
}

/** @param {string} filePath @param {number} offset @param {number} length */
function readBytes(filePath, offset, length) {
  const buf = Buffer.alloc(length);
  const fd = openSync(filePath, 'r');
  try {
    const bytesRead = readSync(fd, buf, 0, length, offset);
    return buf.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

/** Locate embedded squashfs in a type-2 AppImage without executing it. */
export function findSquashfsOffset(appImagePath) {
  const type2Header = readBytes(appImagePath, 0, 16);
  if (type2Header.length >= 16) {
    const offset = Number(type2Header.readBigUInt64LE(8));
    if (offset > 0) {
      const magic = readBytes(appImagePath, offset, SQUASHFS_MAGIC.length);
      if (magic.equals(SQUASHFS_MAGIC)) {
        return offset;
      }
    }
  }

  const CHUNK_BYTES = 4 * 1024 * 1024;
  const overlap = SQUASHFS_MAGIC.length - 1;
  const { size } = statSync(appImagePath);
  const fd = openSync(appImagePath, 'r');
  try {
    let pos = 0;
    /** @type {Buffer} */
    let prevTail = Buffer.alloc(0);
    while (pos < size) {
      const toRead = Math.min(CHUNK_BYTES, size - pos);
      const chunk = Buffer.alloc(toRead);
      readSync(fd, chunk, 0, toRead, pos);
      const searchBuf = Buffer.concat([prevTail, chunk]);
      const idx = searchBuf.indexOf(SQUASHFS_MAGIC);
      if (idx !== -1) {
        return pos - prevTail.length + idx;
      }
      prevTail = chunk.subarray(Math.max(0, chunk.length - overlap));
      pos += toRead;
    }
  } finally {
    closeSync(fd);
  }
  return null;
}

/** Prepare a clean extract directory for AppImage --appimage-extract (spawnSync needs existing cwd). */
export function prepareAppImageExtractDir(extractDir) {
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
}

/** @param {string} appImagePath @param {string} extractDir */
function extractAppImageWithUnsquashfs(appImagePath, extractDir) {
  const offset = findSquashfsOffset(appImagePath);
  if (offset === null) {
    fail(`Could not find squashfs payload in AppImage: ${appImagePath}`);
  }
  const payloadRoot = path.join(extractDir, 'squashfs-root');
  const result = spawnSync(
    'unsquashfs',
    ['-f', '-o', String(offset), '-d', payloadRoot, appImagePath],
    {
      stdio: 'inherit',
      env: process.env,
    },
  );
  if (result.error) {
    fail(`Failed to run unsquashfs (install squashfs-tools): ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    fail(`unsquashfs exited ${result.status ?? 'null'} for ${appImagePath}`);
  }
  if (!existsSync(payloadRoot)) {
    fail(`unsquashfs did not create squashfs-root under ${extractDir}`);
  }
  return payloadRoot;
}

/** @param {string} appImagePath @param {string} extractDir */
function extractAppImage(appImagePath, extractDir) {
  prepareAppImageExtractDir(extractDir);
  if (appImageNeedsUnsquashfsExtract(appImagePath)) {
    return extractAppImageWithUnsquashfs(appImagePath, extractDir);
  }
  // Artifact downloads may drop +x on AppImages.
  chmodSync(appImagePath, 0o755);
  const result = spawnSync(appImagePath, ['--appimage-extract'], {
    cwd: extractDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    fail(`Failed to run AppImage extract: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    fail(`AppImage extract exited ${result.status ?? 'null'} for ${appImagePath}`);
  }
  const payloadRoot = path.join(extractDir, 'squashfs-root');
  if (!existsSync(payloadRoot)) {
    fail(`AppImage extract did not create squashfs-root under ${extractDir}`);
  }
  return payloadRoot;
}

/** @param {'x64' | 'arm64'} arch @param {string} appImagePath */
function assertSidecarInAppImage(arch, appImagePath) {
  const extractDir = path.join(tmpdir(), `mesh-client-appimage-${arch}-${process.pid}`);
  const payloadRoot = extractAppImage(appImagePath, extractDir);
  assertBundledReticulumSidecarInBundle({
    label: `${arch} AppImage Reticulum sidecar`,
    platform: 'linux',
    bundleRoot: payloadRoot,
    fail,
  });
  rmSync(extractDir, { recursive: true, force: true });
  console.debug(
    `[test-linux-appimage-reticulum-sidecar] OK — sidecar present in ${path.basename(appImagePath)}`,
  );
}

function main() {
  if (process.platform !== 'linux') {
    console.debug('[test-linux-appimage-reticulum-sidecar] Skipping on non-Linux host');
    return;
  }

  if (!existsSync(releaseDir)) {
    fail(`Missing release directory: ${releaseDir}`);
  }

  const appImages = readdirSync(releaseDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.AppImage'))
    .map((e) => e.name);

  const x64Images = appImages.filter((n) => !isArm64Name(n));
  const arm64Images = appImages.filter((n) => isArm64Name(n));

  if (x64Images.length !== 1) {
    fail(
      `Expected exactly one x64 AppImage, found ${x64Images.length}: ${x64Images.join(', ') || '(none)'}`,
    );
  }
  if (arm64Images.length !== 1) {
    fail(
      `Expected exactly one arm64 AppImage, found ${arm64Images.length}: ${arm64Images.join(', ') || '(none)'}`,
    );
  }

  for (const [arch, name] of [
    ['x64', x64Images[0]],
    ['arm64', arm64Images[0]],
  ]) {
    const appImagePath = path.join(releaseDir, name);
    const size = statSync(appImagePath).size;
    if (size < 50 * 1024 * 1024) {
      fail(`AppImage too small (${size} bytes): ${appImagePath}`);
    }
    assertSidecarInAppImage(arch, appImagePath);
  }

  const version = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8')).version;
  console.debug(
    `[test-linux-appimage-reticulum-sidecar] OK — x64+arm64 AppImages bundle Reticulum sidecar (v${version})`,
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    main();
  } catch (e) {
    console.error('[test-linux-appimage-reticulum-sidecar] Unexpected error:', e);
    process.exit(1);
  }
}

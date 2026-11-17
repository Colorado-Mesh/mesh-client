/**
 * Shared CPU-architecture readers for packaged Electron guards.
 *
 * Used to assert the bundled Reticulum sidecar matches the target archive arch
 * (mis-picks from beforePack would otherwise pass exists+size checks alone).
 */
import { spawnSync } from 'child_process';
import { closeSync, openSync, readSync } from 'fs';

/** ELF e_machine: x86-64 */
export const EM_X86_64 = 62;
/** ELF e_machine: AArch64 */
export const EM_AARCH64 = 183;

/** PE Machine: AMD64 */
const IMAGE_FILE_MACHINE_AMD64 = 0x8664;
/** PE Machine: ARM64 */
const IMAGE_FILE_MACHINE_ARM64 = 0xaa64;

/** @typedef {'x64' | 'arm64' | 'universal' | 'unknown'} NormalizedArch */
/** @typedef {'darwin' | 'win32' | 'linux'} ElectronPlatform */

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

/** @param {string} filePath */
export function readElfMachine(filePath) {
  const header = readBytes(filePath, 0, 20);
  return readElfMachineFromHeader(header);
}

/**
 * @param {number | null} machine
 * @returns {'x64' | 'arm64' | 'unknown'}
 */
export function elfMachineToArch(machine) {
  if (machine === EM_X86_64) return 'x64';
  if (machine === EM_AARCH64) return 'arm64';
  return 'unknown';
}

/**
 * lipo -archs → normalised arch names (`x86_64` → `x64`).
 * @param {string} filePath
 * @returns {NormalizedArch[]}
 */
export function readMachOArchs(filePath) {
  const result = spawnSync('lipo', ['-archs', filePath], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    return [];
  }
  const text = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  if (!text) return [];
  /** @type {Record<string, NormalizedArch>} */
  const lipoToArch = { x86_64: 'x64', arm64: 'arm64' };
  /** @type {NormalizedArch[]} */
  const archs = [];
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    archs.push(lipoToArch[token] ?? 'unknown');
  }
  return archs;
}

/**
 * Read PE COFF Machine field. Returns normalised arch or `unknown`.
 * @param {string} filePath
 * @returns {'x64' | 'arm64' | 'unknown'}
 */
export function readPeMachine(filePath) {
  const dos = readBytes(filePath, 0, 0x40);
  if (dos.length < 0x40 || dos[0] !== 0x4d || dos[1] !== 0x5a) {
    return 'unknown';
  }
  const peOffset = dos.readUInt32LE(0x3c);
  if (!Number.isFinite(peOffset) || peOffset < 0) return 'unknown';
  const pe = readBytes(filePath, peOffset, 6);
  if (pe.length < 6 || pe[0] !== 0x50 || pe[1] !== 0x45 || pe[2] !== 0x00 || pe[3] !== 0x00) {
    return 'unknown';
  }
  const machine = pe.readUInt16LE(4);
  if (machine === IMAGE_FILE_MACHINE_AMD64) return 'x64';
  if (machine === IMAGE_FILE_MACHINE_ARM64) return 'arm64';
  return 'unknown';
}

/**
 * @param {string} filePath
 * @param {ElectronPlatform} platform
 * @returns {Set<'x64' | 'arm64' | 'unknown'>}
 */
export function archNamesFor(filePath, platform) {
  if (platform === 'linux') {
    return new Set([elfMachineToArch(readElfMachine(filePath))]);
  }
  if (platform === 'darwin') {
    const archs = readMachOArchs(filePath);
    return new Set(archs.length > 0 ? archs : ['unknown']);
  }
  if (platform === 'win32') {
    return new Set([readPeMachine(filePath)]);
  }
  return new Set(['unknown']);
}

/**
 * Fail unless the binary contains the expected CPU architecture.
 * Universal expectation (darwin): binary must contain both x64 and arm64.
 * Thin expectation: binary must contain that arch (fat Mach-O satisfies either).
 *
 * @param {object} opts
 * @param {string} opts.label
 * @param {string} opts.filePath
 * @param {'x64' | 'arm64' | 'universal'} opts.expectedArch
 * @param {ElectronPlatform} opts.platform
 * @param {(message: string) => void} opts.fail
 */
export function assertBinaryArch({ label, filePath, expectedArch, platform, fail }) {
  if (platform !== 'darwin' && platform !== 'win32' && platform !== 'linux') {
    fail(`${label} unsupported platform for arch assert: ${String(platform)}`);
  }
  if (expectedArch !== 'x64' && expectedArch !== 'arm64' && expectedArch !== 'universal') {
    fail(`${label} unsupported expectedArch: ${String(expectedArch)}`);
  }
  if (expectedArch === 'universal' && platform !== 'darwin') {
    fail(`${label} universal expectedArch is only valid on darwin (got ${platform})`);
  }

  const archs = archNamesFor(filePath, platform);
  if (archs.has('unknown') || archs.size === 0) {
    fail(`${label} architecture could not be determined (expected ${expectedArch}): ${filePath}`);
  }

  if (expectedArch === 'universal') {
    if (!archs.has('x64') || !archs.has('arm64')) {
      fail(
        `${label} Mach-O archs [${[...archs].join(', ')}] do not include both x64 and arm64 (universal): ${filePath}`,
      );
    }
    return;
  }

  if (!archs.has(expectedArch)) {
    fail(
      `${label} architecture [${[...archs].join(', ')}] does not include expected ${expectedArch}: ${filePath}`,
    );
  }
}

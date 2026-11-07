import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EnsureMlxCommand } from './ensureMlxHelper';
import {
  ensureMlxHelper,
  isMetalToolchainMissingOutput,
  resolveMlxBinaryPath,
} from './ensureMlxHelper';

function seedXcodeDeveloper(appsRoot: string): string {
  const developer = path.join(appsRoot, 'Xcode.app', 'Contents', 'Developer');
  mkdirSync(developer, { recursive: true });
  return developer;
}

describe('isMetalToolchainMissingOutput', () => {
  it('matches Apple MetalToolchain download guidance', () => {
    expect(
      isMetalToolchainMissingOutput(
        "error: error: cannot execute tool 'metal' due to missing Metal Toolchain; use: xcodebuild -downloadComponent MetalToolchain",
      ),
    ).toBe(true);
    expect(isMetalToolchainMissingOutput('swift: linker failed')).toBe(false);
  });
});

describe('ensureMlxHelper', () => {
  let root: string;

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('reports unsupported off Apple Silicon', async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'mesh-mlx-ensure-'));
    const result = await ensureMlxHelper({
      userBinary: path.join(root, 'user', 'mesh-ai-mlx'),
      bundledCandidates: [],
      mlxPackageRoot: path.join(root, 'pkg'),
      platform: 'linux',
      arch: 'x64',
    });
    expect(result).toEqual({ available: false, reason: 'unsupported', binaryPath: null });
  });

  it('uses an existing user binary without building', async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'mesh-mlx-ensure-'));
    const userBinary = path.join(root, 'user', 'mesh-ai-mlx');
    mkdirSync(path.dirname(userBinary), { recursive: true });
    writeFileSync(userBinary, 'bin');
    const result = await ensureMlxHelper({
      userBinary,
      bundledCandidates: [],
      mlxPackageRoot: path.join(root, 'missing'),
      platform: 'darwin',
      arch: 'arm64',
      applicationsDir: path.join(root, 'Apps'),
    });
    expect(result).toEqual({ available: true, reason: 'ready', binaryPath: userBinary });
  });

  it('copies a bundled candidate into userData', async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'mesh-mlx-ensure-'));
    const bundled = path.join(root, 'bundled', 'mesh-ai-mlx');
    const userBinary = path.join(root, 'user', 'mesh-ai-mlx');
    mkdirSync(path.dirname(bundled), { recursive: true });
    writeFileSync(bundled, 'bundled-bin');
    const result = await ensureMlxHelper({
      userBinary,
      bundledCandidates: [bundled],
      mlxPackageRoot: path.join(root, 'missing'),
      platform: 'darwin',
      arch: 'arm64',
      applicationsDir: path.join(root, 'Apps'),
    });
    expect(result.available).toBe(true);
    expect(result.binaryPath).toBe(userBinary);
    expect(resolveMlxBinaryPath(userBinary, [bundled])).toBe(userBinary);
  });

  it('returns xcodeNotFound when Applications has no Xcode', async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'mesh-mlx-ensure-'));
    const apps = path.join(root, 'Apps');
    mkdirSync(apps, { recursive: true });
    const result = await ensureMlxHelper({
      userBinary: path.join(root, 'user', 'mesh-ai-mlx'),
      bundledCandidates: [],
      mlxPackageRoot: path.join(root, 'pkg'),
      platform: 'darwin',
      arch: 'arm64',
      applicationsDir: apps,
    });
    expect(result).toEqual({ available: false, reason: 'xcodeNotFound', binaryPath: null });
  });

  it('returns sourcesUnavailable when the Swift package root is missing', async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'mesh-mlx-ensure-'));
    const apps = path.join(root, 'Apps');
    seedXcodeDeveloper(apps);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await ensureMlxHelper({
      userBinary: path.join(root, 'user', 'mesh-ai-mlx'),
      bundledCandidates: [],
      mlxPackageRoot: path.join(root, 'missing-pkg'),
      platform: 'darwin',
      arch: 'arm64',
      applicationsDir: apps,
      runCommand: vi.fn(),
    });
    expect(result).toEqual({ available: false, reason: 'sourcesUnavailable', binaryPath: null });
    expect(warn).toHaveBeenCalledWith(
      '[ensureMlxHelper] Metal helper unavailable',
      'sourcesUnavailable',
      expect.any(String),
    );
  });

  it('returns metalToolchainMissing when the xcrun metal probe reports a missing toolchain', async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'mesh-mlx-ensure-'));
    const apps = path.join(root, 'Apps');
    seedXcodeDeveloper(apps);
    mkdirSync(path.join(root, 'pkg'), { recursive: true });
    const runCommand = vi.fn<EnsureMlxCommand>().mockRejectedValue(
      Object.assign(new Error('metal failed'), {
        stderr:
          "error: cannot execute tool 'metal' due to missing Metal Toolchain; use: xcodebuild -downloadComponent MetalToolchain",
      }),
    );
    const result = await ensureMlxHelper({
      userBinary: path.join(root, 'user', 'mesh-ai-mlx'),
      bundledCandidates: [],
      mlxPackageRoot: path.join(root, 'pkg'),
      platform: 'darwin',
      arch: 'arm64',
      applicationsDir: apps,
      runCommand,
    });
    expect(result).toEqual({
      available: false,
      reason: 'metalToolchainMissing',
      binaryPath: null,
    });
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(runCommand.mock.calls[0]?.[0]).toBe('xcrun');
    expect(runCommand.mock.calls[0]?.[1]).toEqual(['-sdk', 'macosx', 'metal', '-v']);
  });

  it('returns metalToolchainMissing when swift build stderr mentions MetalToolchain', async () => {
    root = mkdtempSync(path.join(os.tmpdir(), 'mesh-mlx-ensure-'));
    const apps = path.join(root, 'Apps');
    seedXcodeDeveloper(apps);
    mkdirSync(path.join(root, 'pkg'), { recursive: true });
    const runCommand = vi
      .fn<EnsureMlxCommand>()
      .mockResolvedValueOnce({ stdout: 'Apple metal version', stderr: '' })
      .mockRejectedValueOnce(
        Object.assign(new Error('swift build failed'), {
          stderr:
            "error: error: cannot execute tool 'metal' due to missing Metal Toolchain; use: xcodebuild -downloadComponent MetalToolchain",
        }),
      );
    const result = await ensureMlxHelper({
      userBinary: path.join(root, 'user', 'mesh-ai-mlx'),
      bundledCandidates: [],
      mlxPackageRoot: path.join(root, 'pkg'),
      platform: 'darwin',
      arch: 'arm64',
      applicationsDir: apps,
      runCommand,
    });
    expect(result.reason).toBe('metalToolchainMissing');
    expect(runCommand).toHaveBeenCalledTimes(2);
  });
});

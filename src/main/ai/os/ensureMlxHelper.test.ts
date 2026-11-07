import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ensureMlxHelper, resolveMlxBinaryPath } from './ensureMlxHelper';

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
});

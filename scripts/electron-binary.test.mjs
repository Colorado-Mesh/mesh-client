import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ensureElectronBinaryInstalled,
  isElectronBinaryInstalled,
  resolveLocalElectronBin,
} from './electron-binary.mjs';

describe('electron-binary helpers', () => {
  it('resolveLocalElectronBin returns platform-specific default when missing', () => {
    const root = '/tmp/mesh-client-test';
    expect(resolveLocalElectronBin('darwin', () => false, root)).toContain(
      'Electron.app/Contents/MacOS/Electron',
    );
    expect(resolveLocalElectronBin('linux', () => false, root)).toContain('dist/electron');
    expect(resolveLocalElectronBin('win32', () => false, root)).toContain('dist/electron.exe');
  });

  it('isElectronBinaryInstalled is false when dist binary is absent', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-electron-bin-'));
    expect(isElectronBinaryInstalled(root, 'linux', () => false)).toBe(false);
  });

  it('isElectronBinaryInstalled is true when linux binary exists', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-electron-bin-'));
    const bin = path.join(root, 'node_modules', 'electron', 'dist', 'electron');
    expect(isElectronBinaryInstalled(root, 'linux', (candidate) => candidate === bin)).toBe(true);
  });

  it('ensureElectronBinaryInstalled skips when binary already present', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-electron-bin-'));
    const bin = path.join(root, 'node_modules', 'electron', 'dist', 'electron');
    const spawnSyncFn = vi.fn();
    const result = ensureElectronBinaryInstalled({
      root,
      spawnSyncFn,
      fileExists: (candidate) => candidate === bin,
    });
    expect(result).toEqual({ installed: true, skipped: true });
    expect(spawnSyncFn).not.toHaveBeenCalled();
  });

  it('ensureElectronBinaryInstalled runs install.js when binary is missing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-electron-bin-'));
    const installJs = path.join(root, 'node_modules', 'electron', 'install.js');
    const bin = path.join(root, 'node_modules', 'electron', 'dist', 'electron');
    mkdirSync(path.dirname(installJs), { recursive: true });
    writeFileSync(installJs, '// stub', 'utf8');
    let installed = false;
    const spawnSyncFn = vi.fn(() => {
      installed = true;
      return { status: 0 };
    });
    const result = ensureElectronBinaryInstalled({
      root,
      spawnSyncFn,
      fileExists: (candidate) => candidate === installJs || (installed && candidate === bin),
    });
    expect(result).toEqual({ installed: true, skipped: false, attempts: 1 });
    expect(spawnSyncFn).toHaveBeenCalledOnce();
  });

  it('ensureElectronBinaryInstalled retries transient install failures then succeeds', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-electron-bin-'));
    const installJs = path.join(root, 'node_modules', 'electron', 'install.js');
    const bin = path.join(root, 'node_modules', 'electron', 'dist', 'electron');
    mkdirSync(path.dirname(installJs), { recursive: true });
    writeFileSync(installJs, '// stub', 'utf8');
    let installed = false;
    const spawnSyncFn = vi
      .fn()
      .mockReturnValueOnce({ status: 1 })
      .mockImplementationOnce(() => {
        installed = true;
        return { status: 0 };
      });
    const sleepFn = vi.fn();
    const warn = vi.fn();
    const result = ensureElectronBinaryInstalled({
      root,
      spawnSyncFn,
      fileExists: (candidate) => candidate === installJs || (installed && candidate === bin),
      maxAttempts: 3,
      retryBaseMs: 10,
      sleepFn,
      warn,
    });
    expect(result).toEqual({ installed: true, skipped: false, attempts: 2 });
    expect(spawnSyncFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledWith(10);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('retrying in 10ms'));
  });

  it('ensureElectronBinaryInstalled throws after exhausting retries', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-electron-bin-'));
    const installJs = path.join(root, 'node_modules', 'electron', 'install.js');
    mkdirSync(path.dirname(installJs), { recursive: true });
    writeFileSync(installJs, '// stub', 'utf8');
    const spawnSyncFn = vi.fn(() => ({ status: 1 }));
    expect(() =>
      ensureElectronBinaryInstalled({
        root,
        spawnSyncFn,
        fileExists: (candidate) => candidate === installJs,
        maxAttempts: 2,
        retryBaseMs: 5,
        sleepFn: vi.fn(),
        warn: vi.fn(),
      }),
    ).toThrow(/exited with status 1/);
    expect(spawnSyncFn).toHaveBeenCalledTimes(2);
  });

  it('ensureElectronBinaryInstalled throws when install.js is missing', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-electron-bin-'));
    expect(() =>
      ensureElectronBinaryInstalled({ root, spawnSyncFn: vi.fn(), fileExists: () => false }),
    ).toThrow(/install\.js was not found/);
  });
});

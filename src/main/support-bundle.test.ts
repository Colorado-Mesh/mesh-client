// @vitest-environment node
import fs from 'fs';
import JSZip from 'jszip';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { flushLogBeforeQuit, getLogPath, exportDatabase } = vi.hoisted(() => ({
  flushLogBeforeQuit: vi.fn().mockResolvedValue(undefined),
  getLogPath: vi.fn(),
  exportDatabase: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key: string) => {
      if (key === 'temp') return path.join(os.tmpdir(), 'mesh-client-support-test-temp');
      if (key === 'userData') return path.join(os.tmpdir(), 'mesh-client-support-test-userdata');
      return path.join(os.tmpdir(), 'mesh-client-support-test-userdata');
    }),
    getVersion: vi.fn(() => '9.9.9-test'),
    isPackaged: false,
  },
}));

vi.mock('./log-service', () => ({
  flushLogBeforeQuit,
  getLogPath,
}));

vi.mock('./database', () => ({
  exportDatabase,
}));

import { app } from 'electron';

import {
  buildSupportBundleZip,
  defaultSupportBundleFilename,
  isSupportBundleMode,
  readReticulumDeveloperArtifacts,
  redactMnemonicFromStackJson,
  validateDebugSnapshotJson,
} from './support-bundle';

describe('validateDebugSnapshotJson', () => {
  it('accepts a JSON object', () => {
    expect(validateDebugSnapshotJson('{"capturedAt":"x"}')).toEqual({ capturedAt: 'x' });
  });

  it('rejects invalid JSON', () => {
    expect(() => validateDebugSnapshotJson('not-json')).toThrow(/valid JSON/);
  });

  it('rejects arrays', () => {
    expect(() => validateDebugSnapshotJson('[]')).toThrow(/object/);
  });
});

describe('isSupportBundleMode', () => {
  it('accepts github and developer', () => {
    expect(isSupportBundleMode('github')).toBe(true);
    expect(isSupportBundleMode('developer')).toBe(true);
    expect(isSupportBundleMode('other')).toBe(false);
  });
});

describe('defaultSupportBundleFilename', () => {
  it('uses mode-specific prefixes', () => {
    expect(defaultSupportBundleFilename('github')).toMatch(/^mesh-client-github-report-/);
    expect(defaultSupportBundleFilename('developer')).toMatch(/^mesh-client-developer-bundle-/);
  });
});

describe('redactMnemonicFromStackJson', () => {
  it('removes identity.mnemonic from stack JSON', () => {
    const raw = JSON.stringify({
      identity: { configured: true, mnemonic: 'secret words', identity_hash: 'aa' },
    });
    const redacted = JSON.parse(redactMnemonicFromStackJson(raw)) as {
      identity: { mnemonic?: string; identity_hash: string };
    };
    expect(redacted.identity.mnemonic).toBeUndefined();
    expect(redacted.identity.identity_hash).toBe('aa');
  });

  it('fails closed on invalid JSON instead of returning raw stack text', () => {
    const redacted = JSON.parse(redactMnemonicFromStackJson('{"identity":{"mnemonic":"leak"')) as {
      error?: string;
      identity?: { mnemonic?: string };
    };
    expect(redacted.error).toBe('stack_json_redaction_failed');
    expect(redacted.identity?.mnemonic).toBeUndefined();
  });
});

describe('readReticulumDeveloperArtifacts', () => {
  let userDataDir: string;

  beforeEach(async () => {
    userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mesh-reticulum-artifacts-'));
    vi.mocked(app.getPath).mockImplementation((key: string) => {
      if (key === 'userData') return userDataDir;
      if (key === 'temp') return path.join(userDataDir, 'temp');
      return userDataDir;
    });
  });

  afterEach(async () => {
    await fs.promises.rm(userDataDir, { recursive: true, force: true });
  });

  it('reads config and redacted stack state when present', async () => {
    const configPath = path.join(userDataDir, 'reticulum', 'config', 'config');
    const stackPath = path.join(userDataDir, 'reticulum', 'storage', 'mesh_client_stack.json');
    await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
    await fs.promises.mkdir(path.dirname(stackPath), { recursive: true });
    await fs.promises.writeFile(configPath, '[interfaces]\n[[TCPClientInterface]]\n', 'utf8');
    await fs.promises.writeFile(
      stackPath,
      JSON.stringify({ identity: { mnemonic: 'never export', configured: true } }),
      'utf8',
    );

    const artifacts = readReticulumDeveloperArtifacts();

    expect(artifacts.config?.toString('utf8')).toContain('TCPClientInterface');
    const stack = JSON.parse(artifacts.stackJson?.toString('utf8') ?? '{}') as {
      identity: { mnemonic?: string };
    };
    expect(stack.identity.mnemonic).toBeUndefined();
  });
});

describe('buildSupportBundleZip', () => {
  let workDir: string;
  let logPath: string;

  beforeEach(async () => {
    workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mesh-support-bundle-'));
    logPath = path.join(workDir, 'mesh-client.log');
    getLogPath.mockReturnValue(logPath);
    flushLogBeforeQuit.mockClear();
    exportDatabase.mockReset();
    await fs.promises.writeFile(logPath, 'line-one\n', 'utf8');
  });

  afterEach(async () => {
    await fs.promises.rm(workDir, { recursive: true, force: true });
  });

  async function zipEntryNames(zipPath: string): Promise<string[]> {
    const buf = await fs.promises.readFile(zipPath);
    const zip = await JSZip.loadAsync(buf);
    return Object.keys(zip.files).filter((name) => !zip.files[name]?.dir);
  }

  it('github bundle includes snapshot and log but not db', async () => {
    const dest = path.join(workDir, 'github.zip');
    const snapshot = JSON.stringify({ capturedAt: '2026-01-01T00:00:00.000Z' }, null, 2);

    await buildSupportBundleZip(dest, 'github', snapshot);

    const names = await zipEntryNames(dest);
    expect(names).toContain('debug-snapshot.json');
    expect(names).toContain('mesh-client.log');
    expect(names).toContain('manifest.json');
    expect(names).toContain('README.txt');
    expect(names).not.toContain('mesh-client.db');
    expect(exportDatabase).not.toHaveBeenCalled();
  });

  it('developer bundle includes db after exportDatabase', async () => {
    const dest = path.join(workDir, 'developer.zip');
    const snapshot = JSON.stringify({ capturedAt: '2026-01-01T00:00:00.000Z' }, null, 2);
    exportDatabase.mockImplementation((destPath: string) => {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, 'sqlite-bytes');
    });

    await buildSupportBundleZip(dest, 'developer', snapshot);

    const names = await zipEntryNames(dest);
    expect(names).toContain('mesh-client.db');
    expect(exportDatabase).toHaveBeenCalledOnce();

    const buf = await fs.promises.readFile(dest);
    const zip = await JSZip.loadAsync(buf);
    const dbBytes = await zip.file('mesh-client.db')!.async('nodebuffer');
    expect(dbBytes.toString('utf8')).toBe('sqlite-bytes');
  });

  it('developer bundle includes reticulum artifacts when present on disk', async () => {
    const userDataDir = path.join(workDir, 'userdata');
    vi.mocked(app.getPath).mockImplementation((key: string) => {
      if (key === 'userData') return userDataDir;
      if (key === 'temp') return path.join(workDir, 'temp');
      return userDataDir;
    });
    const configPath = path.join(userDataDir, 'reticulum', 'config', 'config');
    await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
    await fs.promises.writeFile(configPath, 'reticulum ini', 'utf8');

    const dest = path.join(workDir, 'developer-reticulum.zip');
    exportDatabase.mockImplementation((destPath: string) => {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, 'sqlite-bytes');
    });
    await buildSupportBundleZip(dest, 'developer', '{"ok":true}');

    const names = await zipEntryNames(dest);
    expect(names).toContain('reticulum/config');
  });

  it('includes rotated log backup when present', async () => {
    await fs.promises.writeFile(path.join(workDir, 'mesh-client.log.1'), 'rotated\n', 'utf8');
    const dest = path.join(workDir, 'github-with-backup.zip');
    await buildSupportBundleZip(dest, 'github', '{"ok":true}');
    const names = await zipEntryNames(dest);
    expect(names).toContain('mesh-client.log.1');
  });

  it('manifest records github kind', async () => {
    const dest = path.join(workDir, 'manifest.zip');
    await buildSupportBundleZip(dest, 'github', '{"ok":true}');
    const buf = await fs.promises.readFile(dest);
    const zip = await JSZip.loadAsync(buf);
    const manifestRaw = await zip.file('manifest.json')!.async('string');
    const manifest = JSON.parse(manifestRaw) as { kind: string; appVersion: string };
    expect(manifest.kind).toBe('mesh-client-github-report');
    expect(manifest.appVersion).toBe('9.9.9-test');
  });
});

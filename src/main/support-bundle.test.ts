// @vitest-environment node
import fs from 'fs';
import JSZip from 'jszip';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { flushLogBeforeQuit, getLogPath, exportDatabase } = vi.hoisted(() => ({
  flushLogBeforeQuit: vi.fn().mockResolvedValue(undefined),
  getLogPath: vi.fn(),
  exportDatabase: vi.fn(),
}));

/** Unique default temp/userData roots for Electron path mocks (no fixed tmpdir names). */
let defaultPathsRoot = '';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key: string) => {
      // beforeAll may not have run yet during module init — fall back to process tmpdir.
      const root = defaultPathsRoot || os.tmpdir();
      if (key === 'temp') return path.join(root, 'temp');
      if (key === 'userData') return path.join(root, 'userdata');
      return path.join(root, 'userdata');
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
  extractLxmfOutboundLogSlice,
  isSupportBundleMode,
  readReticulumDeveloperArtifacts,
  redactMnemonicFromStackJson,
  validateDebugSnapshotJson,
} from './support-bundle';

function mockDefaultAppPaths(): void {
  vi.mocked(app.getPath).mockImplementation((key: string) => {
    if (key === 'temp') return path.join(defaultPathsRoot, 'temp');
    if (key === 'userData') return path.join(defaultPathsRoot, 'userdata');
    return path.join(defaultPathsRoot, 'userdata');
  });
}

beforeAll(() => {
  defaultPathsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-client-support-default-'));
  fs.mkdirSync(path.join(defaultPathsRoot, 'temp'), { recursive: true });
  fs.mkdirSync(path.join(defaultPathsRoot, 'userdata'), { recursive: true });
  mockDefaultAppPaths();
});

afterAll(() => {
  if (defaultPathsRoot) {
    fs.rmSync(defaultPathsRoot, { recursive: true, force: true });
  }
});

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

describe('extractLxmfOutboundLogSlice', () => {
  it('keeps LXMF outbound / PN cascade lines and drops unrelated noise', () => {
    const chunk = Buffer.from(
      [
        'info hello world',
        'info target=lxmf-outbound LXMF advancing PN cascade',
        'warn DeliverPropagated: deferring — PN link busy',
        'debug peer refresh ok',
        'info target=propagation-deposit outbound PN deposit Completes',
        'info target=propagation-retrieve sync transfer progress',
        'info target=propagation-sync propagation sync aborted — no path to PN',
        'warn propagation establish failed: NoLinkProof',
        'error PROPAGATION_PATH_UNKNOWN',
      ].join('\n'),
      'utf8',
    );
    const slice = extractLxmfOutboundLogSlice(chunk).toString('utf8');
    expect(slice).toContain('LXMF advancing PN cascade');
    expect(slice).toContain('DeliverPropagated');
    expect(slice).toContain('propagation-deposit');
    expect(slice).toContain('propagation-retrieve');
    expect(slice).toContain('propagation-sync');
    expect(slice).toContain('propagation establish');
    expect(slice).toContain('PROPAGATION_PATH_UNKNOWN');
    expect(slice).not.toContain('hello world');
    expect(slice).not.toContain('peer refresh ok');
  });

  it('truncates long hex ids in kept lines', () => {
    const dest = 'ab'.repeat(16);
    const chunk = Buffer.from(
      `info target=lxmf-outbound dest=${dest} LXMF advancing PN cascade\n`,
      'utf8',
    );
    const slice = extractLxmfOutboundLogSlice(chunk).toString('utf8');
    expect(slice).toContain('dest=abababab…');
    expect(slice).not.toContain(dest);
  });

  it('keeps PN island diagnosis lines (deposit/preferred/sync_target/HaveAll)', () => {
    const chunk = Buffer.from(
      [
        'info deposit_pn=aabb preferred_pn=ccdd sync_target=eeff',
        'info pn_island mismatch detected',
        'info HaveAll empty_offer completed',
        'info unrelated chat toast',
      ].join('\n'),
      'utf8',
    );
    const slice = extractLxmfOutboundLogSlice(chunk).toString('utf8');
    expect(slice).toContain('deposit_pn');
    expect(slice).toContain('preferred_pn');
    expect(slice).toContain('sync_target');
    expect(slice).toContain('pn_island');
    expect(slice).toContain('HaveAll');
    expect(slice).not.toContain('unrelated chat toast');
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
    mockDefaultAppPaths();
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

  it('logs and skips unreadable config / stack without throwing', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const configPath = path.join(userDataDir, 'reticulum', 'config', 'config');
      const stackPath = path.join(userDataDir, 'reticulum', 'storage', 'mesh_client_stack.json');
      await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
      await fs.promises.mkdir(path.dirname(stackPath), { recursive: true });
      // Directory where a file is expected → EISDIR / read failure
      await fs.promises.rm(configPath, { force: true });
      await fs.promises.mkdir(configPath, { recursive: true });
      await fs.promises.rm(stackPath, { force: true });
      await fs.promises.mkdir(stackPath, { recursive: true });

      const artifacts = readReticulumDeveloperArtifacts();

      expect(artifacts.config).toBeUndefined();
      expect(artifacts.stackJson).toBeUndefined();
      expect(debugSpy.mock.calls.some((c) => String(c[0]).includes('skip rnsd config'))).toBe(true);
      expect(debugSpy.mock.calls.some((c) => String(c[0]).includes('skip stack state'))).toBe(true);
    } finally {
      debugSpy.mockRestore();
    }
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
    mockDefaultAppPaths();
  });

  afterEach(async () => {
    await fs.promises.rm(workDir, { recursive: true, force: true });
    mockDefaultAppPaths();
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

  it('developer bundle always includes stack json and lxmf-outbound slice with placeholders', async () => {
    const userDataDir = path.join(workDir, 'userdata-empty');
    vi.mocked(app.getPath).mockImplementation((key: string) => {
      if (key === 'userData') return userDataDir;
      if (key === 'temp') return path.join(workDir, 'temp');
      return userDataDir;
    });
    // No reticulum artifacts and no matching log lines on disk.
    const dest = path.join(workDir, 'developer-placeholders.zip');
    exportDatabase.mockImplementation((destPath: string) => {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, 'sqlite-bytes');
    });

    await buildSupportBundleZip(dest, 'developer', '{"ok":true}');

    const names = await zipEntryNames(dest);
    expect(names).toContain('reticulum/mesh_client_stack.json');
    expect(names).toContain('reticulum/lxmf-outbound.log');

    const buf = await fs.promises.readFile(dest);
    const zip = await JSZip.loadAsync(buf);
    const stack = JSON.parse(
      await zip.file('reticulum/mesh_client_stack.json')!.async('string'),
    ) as { note?: string };
    expect(stack.note).toMatch(/not found or unreadable/);
    const slice = await zip.file('reticulum/lxmf-outbound.log')!.async('string');
    expect(slice).toMatch(/No LXMF outbound \/ PN cascade lines matched/);
  });

  it('includes rotated log backup when present', async () => {
    await fs.promises.writeFile(path.join(workDir, 'mesh-client.log.1'), 'rotated\n', 'utf8');
    const dest = path.join(workDir, 'github-with-backup.zip');
    await buildSupportBundleZip(dest, 'github', '{"ok":true}');
    const names = await zipEntryNames(dest);
    expect(names).toContain('mesh-client.log.1');
    const buf = await fs.promises.readFile(dest);
    const zip = await JSZip.loadAsync(buf);
    const backup = await zip.file('mesh-client.log.1')!.async('string');
    expect(backup).toBe('rotated\n');
  });

  it('tail-caps oversized backup log to the final 10 MiB', async () => {
    const tenMiB = 10 * 1024 * 1024;
    const oversized = Buffer.alloc(tenMiB + 4096, 0x61);
    // Distinct trailing marker so we can prove the zip holds the end of the file.
    oversized.write('TAIL-MARKER-END', tenMiB + 4096 - 15);
    await fs.promises.writeFile(path.join(workDir, 'mesh-client.log.1'), oversized);
    const dest = path.join(workDir, 'github-backup-tail.zip');
    await buildSupportBundleZip(dest, 'github', '{"ok":true}');
    const buf = await fs.promises.readFile(dest);
    const zip = await JSZip.loadAsync(buf);
    const entry = await zip.file('mesh-client.log.1')!.async('nodebuffer');
    expect(entry.byteLength).toBe(tenMiB);
    expect(entry.subarray(entry.byteLength - 15).toString('utf8')).toBe('TAIL-MARKER-END');
  });

  it('manifest records github kind and buildChannel', async () => {
    const dest = path.join(workDir, 'manifest.zip');
    await buildSupportBundleZip(dest, 'github', '{"ok":true}');
    const buf = await fs.promises.readFile(dest);
    const zip = await JSZip.loadAsync(buf);
    const manifestRaw = await zip.file('manifest.json')!.async('string');
    const manifest = JSON.parse(manifestRaw) as {
      kind: string;
      appVersion: string;
      buildChannel: string;
    };
    expect(manifest.kind).toBe('mesh-client-github-report');
    expect(manifest.appVersion).toBe('9.9.9-test');
    expect(manifest.buildChannel).toBe('local');

    const readme = await zip.file('README.txt')!.async('string');
    expect(readme).toContain('Build channel: local');
  });
});

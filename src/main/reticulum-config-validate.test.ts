import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
const resolveBinaryMock = vi.hoisted(() => vi.fn());
const ensureDevMock = vi.hoisted(() => vi.fn());
const sidecarChildEnvMock = vi.hoisted(() =>
  vi.fn((): NodeJS.ProcessEnv => ({ PATH: '/usr/bin', HOME: '/tmp' })),
);

vi.mock('child_process', () => ({
  spawn: spawnMock,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'mesh-client-validate-test-userdata'),
    isPackaged: false,
  },
}));

vi.mock('./reticulum-sidecar-path', () => ({
  resolveSidecarBinaryPath: resolveBinaryMock,
  ensureDevSidecarBinary: ensureDevMock,
}));

vi.mock('./reticulum-sidecar-manager', () => ({
  sidecarChildEnv: sidecarChildEnvMock,
}));

vi.mock('./log-service', () => ({
  sanitizeLogMessage: (s: string) => s,
}));

import { validateReticulumUserConfig } from './reticulum-config-validate';

function mockSpawnProc(opts: {
  stdout?: string;
  stderr?: string;
  closeCode?: number | null;
  emitError?: Error;
  neverClose?: boolean;
}) {
  spawnMock.mockImplementation(() => {
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const proc = {
      stdout: {
        on: (ev: string, cb: (c: Buffer) => void) => {
          if (ev === 'data' && opts.stdout != null) {
            queueMicrotask(() => {
              cb(Buffer.from(opts.stdout!));
            });
          }
        },
      },
      stderr: {
        on: (ev: string, cb: (c: Buffer) => void) => {
          if (ev === 'data' && opts.stderr != null) {
            queueMicrotask(() => {
              cb(Buffer.from(opts.stderr!));
            });
          }
        },
      },
      on: (ev: string, cb: (...args: unknown[]) => void) => {
        handlers[ev] = handlers[ev] ?? [];
        handlers[ev].push(cb);
        if (ev === 'error' && opts.emitError) {
          queueMicrotask(() => {
            cb(opts.emitError!);
          });
        }
        if (ev === 'close' && !opts.neverClose) {
          queueMicrotask(() => {
            cb(opts.closeCode ?? 0);
          });
        }
      },
      kill: vi.fn(),
      killed: false,
    };
    return proc;
  });
}

describe('validateReticulumUserConfig', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    resolveBinaryMock.mockReset();
    ensureDevMock.mockReset();
    sidecarChildEnvMock.mockClear();
    ensureDevMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['linux', 'darwin', 'win32'] as const)(
    'spawns validate-config --json for bundled binary (%s)',
    async (platform) => {
      const previous = process.platform;
      Object.defineProperty(process, 'platform', { value: platform });
      const binary = path.join(os.tmpdir(), `fake-sidecar-${platform}`);
      fs.writeFileSync(binary, '');
      resolveBinaryMock.mockReturnValue(binary);

      mockSpawnProc({
        stdout: JSON.stringify({ ok: true, issues: [] }),
        closeCode: 0,
      });

      const result = await validateReticulumUserConfig({
        configDir: path.join(os.tmpdir(), 'reticulum-config-validate'),
        binaryPath: binary,
      });
      expect(result.ok).toBe(true);
      expect(spawnMock).toHaveBeenCalled();
      const args = spawnMock.mock.calls[0]?.[1] as string[];
      expect(args[0]).toBe('validate-config');
      expect(args).toContain('--json');
      expect(sidecarChildEnvMock).toHaveBeenCalled();
      Object.defineProperty(process, 'platform', { value: previous });
      fs.unlinkSync(binary);
    },
  );

  it('returns error when binary missing', async () => {
    resolveBinaryMock.mockReturnValue('/nonexistent/mesh-client-reticulum');
    const result = await validateReticulumUserConfig({
      binaryPath: '/nonexistent/mesh-client-reticulum',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('returns ensureDev failure without spawning', async () => {
    ensureDevMock.mockRejectedValue(new Error('cargo missing'));
    resolveBinaryMock.mockReturnValue('/tmp/fake-sidecar');
    const result = await validateReticulumUserConfig({ binaryPath: '/tmp/fake-sidecar' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/cargo missing/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('surfaces ok:false issues from sidecar JSON', async () => {
    const binary = path.join(os.tmpdir(), 'fake-sidecar-issues');
    fs.writeFileSync(binary, '');
    resolveBinaryMock.mockReturnValue(binary);
    mockSpawnProc({
      stdout: JSON.stringify({
        ok: false,
        issues: [
          {
            kind: 'tcp_enable_key',
            severity: 'error',
            message: 'bad enable key',
            interface_name: 'Hub',
          },
        ],
      }),
      closeCode: 1,
    });
    const result = await validateReticulumUserConfig({ binaryPath: binary });
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.kind).toBe('tcp_enable_key');
    expect(result.error).toBeDefined();
    fs.unlinkSync(binary);
  });

  it('returns error for invalid JSON stdout', async () => {
    const binary = path.join(os.tmpdir(), 'fake-sidecar-bad-json');
    fs.writeFileSync(binary, '');
    resolveBinaryMock.mockReturnValue(binary);
    mockSpawnProc({ stdout: 'not-json', closeCode: 0 });
    const result = await validateReticulumUserConfig({ binaryPath: binary });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    fs.unlinkSync(binary);
  });

  it('surfaces stderr when stdout is empty', async () => {
    const binary = path.join(os.tmpdir(), 'fake-sidecar-empty');
    fs.writeFileSync(binary, '');
    resolveBinaryMock.mockReturnValue(binary);
    mockSpawnProc({ stdout: '', stderr: 'boom', closeCode: 1 });
    const result = await validateReticulumUserConfig({ binaryPath: binary });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/boom/);
    fs.unlinkSync(binary);
  });

  it('times out and kills hung validate-config', async () => {
    const binary = path.join(os.tmpdir(), 'fake-sidecar-timeout');
    fs.writeFileSync(binary, '');
    resolveBinaryMock.mockReturnValue(binary);
    mockSpawnProc({ neverClose: true });
    const result = await validateReticulumUserConfig({
      binaryPath: binary,
      timeoutMs: 20,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/);
    fs.unlinkSync(binary);
  });
});

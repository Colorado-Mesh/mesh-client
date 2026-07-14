import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
const resolveBinaryMock = vi.hoisted(() => vi.fn());
const ensureDevMock = vi.hoisted(() => vi.fn());

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

vi.mock('./log-service', () => ({
  sanitizeLogMessage: (s: string) => s,
}));

import { validateReticulumUserConfig } from './reticulum-config-validate';

describe('validateReticulumUserConfig', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    resolveBinaryMock.mockReset();
    ensureDevMock.mockReset();
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

      spawnMock.mockImplementation(() => {
        const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
        const proc = {
          stdout: {
            on: (ev: string, cb: (c: Buffer) => void) => {
              if (ev === 'data') {
                queueMicrotask(() => {
                  cb(
                    Buffer.from(
                      JSON.stringify({
                        ok: true,
                        issues: [],
                      }),
                    ),
                  );
                });
              }
            },
          },
          stderr: {
            on: () => {
              /* no-op */
            },
          },
          on: (ev: string, cb: (...args: unknown[]) => void) => {
            handlers[ev] = handlers[ev] ?? [];
            handlers[ev].push(cb);
            if (ev === 'close') {
              queueMicrotask(() => {
                cb(0);
              });
            }
          },
          kill: vi.fn(),
          killed: false,
        };
        return proc;
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
});

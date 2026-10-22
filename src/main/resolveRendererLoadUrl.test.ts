import net from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import {
  ENV_FORCE_FILE_ORIGIN,
  ENV_SKIP_ORIGIN_MIGRATION,
  ENV_USE_CUSTOM_PROTOCOL,
  RENDERER_INDEX_URL,
} from '../shared/rendererOrigin';
import {
  DEFAULT_VITE_DEV_SERVER_URL,
  probeDevServerReachable,
  resolveRendererLoadUrl,
} from './resolveRendererLoadUrl';

describe('resolveRendererLoadUrl', () => {
  it('loads the custom origin only after a packaged migration completes', async () => {
    for (const migrationCompleted of [true, false, undefined]) {
      const result = await resolveRendererLoadUrl({
        packaged: true,
        distIndexPath: '/dist/renderer/index.html',
        customProtocolUrl: RENDERER_INDEX_URL,
        migrationCompleted,
        env: {},
      });
      expect(result.source).toBe(migrationCompleted ? 'custom-protocol' : 'dist');
      expect(result.url.startsWith(migrationCompleted ? 'mesh-client:' : 'file:')).toBe(true);
    }
  });

  it.each([ENV_FORCE_FILE_ORIGIN, ENV_SKIP_ORIGIN_MIGRATION])(
    '%s retains file storage even with completion and custom/development overrides',
    async (flag) => {
      const result = await resolveRendererLoadUrl({
        packaged: true,
        distIndexPath: '/dist/renderer/index.html',
        customProtocolUrl: RENDERER_INDEX_URL,
        migrationCompleted: true,
        devServerUrl: 'http://localhost:5173',
        env: { [flag]: '1', [ENV_USE_CUSTOM_PROTOCOL]: '1' },
      });
      expect(result.source).toBe('dist');
      expect(result.url).toMatch(/^file:/);
    },
  );

  it('permits the unpackaged COI test origin without migration', async () => {
    const probe = vi.fn();
    const result = await resolveRendererLoadUrl({
      packaged: false,
      distIndexPath: '/dist/renderer/index.html',
      customProtocolUrl: RENDERER_INDEX_URL,
      env: { [ENV_USE_CUSTOM_PROTOCOL]: '1' },
      isDevServerReachable: probe,
    });
    expect(result).toEqual({
      url: RENDERER_INDEX_URL,
      source: 'custom-protocol',
      openDevTools: false,
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it('does not let the development COI flag bypass a packaged migration failure', async () => {
    const result = await resolveRendererLoadUrl({
      packaged: true,
      distIndexPath: '/dist/renderer/index.html',
      customProtocolUrl: RENDERER_INDEX_URL,
      migrationCompleted: false,
      env: { [ENV_USE_CUSTOM_PROTOCOL]: '1' },
    });
    expect(result.source).toBe('dist');
  });

  it('keeps an explicit E2E file URL ahead of the unpackaged COI flag', async () => {
    const result = await resolveRendererLoadUrl({
      packaged: false,
      devServerUrl: 'file:///e2e/index.html',
      distIndexPath: '/dist/renderer/index.html',
      customProtocolUrl: RENDERER_INDEX_URL,
      env: { [ENV_USE_CUSTOM_PROTOCOL]: '1' },
    });
    expect(result).toEqual({ url: 'file:///e2e/index.html', source: 'env', openDevTools: false });
  });

  it('uses VITE_DEV_SERVER_URL when set', async () => {
    const resolved = await resolveRendererLoadUrl({
      packaged: false,
      devServerUrl: 'http://localhost:9999',
      distIndexPath: '/tmp/dist/renderer/index.html',
      isDevServerReachable: vi.fn().mockResolvedValue(false),
    });
    expect(resolved).toEqual({
      url: 'http://localhost:9999',
      openDevTools: true,
      source: 'env',
    });
  });

  it.each([
    ['linux', 'file:///home/runner/mesh-client/dist/renderer/index.html'],
    ['darwin', 'file:///Users/runner/mesh-client/dist/renderer/index.html'],
    ['win32', 'file:///D:/a/mesh-client/dist/renderer/index.html'],
    ['linux', 'FILE:///home/runner/mesh-client/dist/renderer/index.html'],
    ['darwin', 'FILE:///Users/runner/mesh-client/dist/renderer/index.html'],
    ['win32', 'FILE:///D:/a/mesh-client/dist/renderer/index.html'],
    ['linux', 'FiLe:///home/runner/mesh-client/dist/renderer/index.html'],
  ])('loads an explicit production file without DevTools on %s', async (_platform, url) => {
    const probe = vi.fn().mockResolvedValue(true);
    const resolved = await resolveRendererLoadUrl({
      packaged: false,
      devServerUrl: url,
      distIndexPath: '/unused/index.html',
      isDevServerReachable: probe,
    });
    expect(resolved).toEqual({ url, openDevTools: false, source: 'env' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('probes local Vite when unpackaged and env is unset', async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const resolved = await resolveRendererLoadUrl({
      packaged: false,
      distIndexPath: '/tmp/dist/renderer/index.html',
      viteDevServerUrl: DEFAULT_VITE_DEV_SERVER_URL,
      isDevServerReachable: probe,
    });
    expect(probe).toHaveBeenCalledWith(DEFAULT_VITE_DEV_SERVER_URL, 400);
    expect(resolved.source).toBe('vite-probe');
    expect(resolved.url).toBe(DEFAULT_VITE_DEV_SERVER_URL);
    expect(resolved.openDevTools).toBe(true);
  });

  it('falls back to dist when unpackaged and Vite is unreachable', async () => {
    const resolved = await resolveRendererLoadUrl({
      packaged: false,
      distIndexPath: '/tmp/dist/renderer/index.html',
      isDevServerReachable: vi.fn().mockResolvedValue(false),
    });
    expect(resolved.source).toBe('dist');
    expect(resolved.url).toContain('dist/renderer/index.html');
    expect(resolved.openDevTools).toBe(false);
  });

  it('warns about the dist fallback without claiming the bundle is stale', async () => {
    // `pnpm start` runs a full build and never sets VITE_DEV_SERVER_URL, so it always takes this
    // path with a freshly built bundle — the warning must not report it as stale.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await resolveRendererLoadUrl({
        packaged: false,
        distIndexPath: '/tmp/dist/renderer/index.html',
        isDevServerReachable: vi.fn().mockResolvedValue(false),
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = String(warnSpy.mock.calls[0]?.[0]);
      expect(message).toContain('[Startup]');
      expect(message).toContain('dist/renderer');
      expect(message).toContain('pnpm run dev');
      expect(message).not.toMatch(/stale/i);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not warn about the dist fallback when packaged', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await resolveRendererLoadUrl({
        packaged: true,
        distIndexPath: '/tmp/dist/renderer/index.html',
        isDevServerReachable: vi.fn().mockResolvedValue(false),
      });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('uses dist when packaged even if Vite is reachable', async () => {
    const probe = vi.fn().mockResolvedValue(true);
    const resolved = await resolveRendererLoadUrl({
      packaged: true,
      distIndexPath: '/tmp/dist/renderer/index.html',
      isDevServerReachable: probe,
    });
    expect(probe).not.toHaveBeenCalled();
    expect(resolved.source).toBe('dist');
  });
});

describe('probeDevServerReachable', () => {
  it('returns false for invalid URLs', async () => {
    await expect(probeDevServerReachable('not-a-url', 100)).resolves.toBe(false);
  });

  it('returns false when TCP accepts but endpoint is not HTTP', async () => {
    const server = net.createServer((socket) => {
      socket.destroy();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('expected TCP port');
    }
    try {
      const resolved = await resolveRendererLoadUrl({
        packaged: false,
        distIndexPath: '/tmp/dist/renderer/index.html',
        viteDevServerUrl: `http://127.0.0.1:${address.port}`,
        probeTimeoutMs: 500,
      });
      expect(resolved.source).toBe('dist');
    } finally {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  });
});

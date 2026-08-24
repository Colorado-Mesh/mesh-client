import net from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_VITE_DEV_SERVER_URL,
  probeDevServerReachable,
  resolveRendererLoadUrl,
} from './resolveRendererLoadUrl';

describe('resolveRendererLoadUrl', () => {
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

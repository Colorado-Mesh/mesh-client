// @vitest-environment node
import net from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { probeHttpRttMs, probeTcpRttMs } from './host-link-rtt';

describe('probeTcpRttMs', () => {
  let server: net.Server | null = null;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) {
        resolve();
        return;
      }
      server.close(() => {
        resolve();
      });
      server = null;
    });
  });

  it('returns a finite RTT when the host accepts a TCP connect', async () => {
    server = net.createServer((socket) => {
      socket.destroy();
    });
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('expected TCP port');
    const rtt = await probeTcpRttMs('127.0.0.1', addr.port);
    expect(rtt).not.toBeNull();
    expect(rtt!).toBeGreaterThanOrEqual(0);
    expect(rtt!).toBeLessThan(3000);
  });

  it('returns null when the port is closed', async () => {
    const rtt = await probeTcpRttMs('127.0.0.1', 1);
    expect(rtt).toBeNull();
  });
});

describe('probeHttpRttMs', () => {
  it('returns null when fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down'))),
    );
    await expect(probeHttpRttMs('127.0.0.1', false)).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it('returns RTT when the host answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response)),
    );
    const rtt = await probeHttpRttMs('example.test', false);
    expect(rtt).not.toBeNull();
    expect(rtt!).toBeGreaterThanOrEqual(0);
    vi.unstubAllGlobals();
  });
});

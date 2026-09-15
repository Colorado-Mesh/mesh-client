/**
 * Main-process GATT proxy: concurrent Meshtastic/MeshCore sessions on distinct addresses;
 * disconnect one leaves the other; same-address reconnect replaces the session for that profile.
 */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('ws', () => {
  class MockWebSocket {
    on = vi.fn();
    close = vi.fn();
  }
  return { default: MockWebSocket };
});

import { GattSidecarProxy } from './gatt-sidecar-proxy';

describe('GattSidecarProxy concurrent sessions', () => {
  let proxy: GattSidecarProxy;
  let fetchMock: ReturnType<typeof vi.fn>;
  let sessionSeq = 0;

  beforeEach(() => {
    sessionSeq = 0;
    proxy = new GattSidecarProxy();
    proxy.setPort(9876);
    fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (
        typeof url === 'string' &&
        url.endsWith('/api/v1/gatt/sessions') &&
        init?.method === 'POST'
      ) {
        sessionSeq += 1;
        return {
          status: 200,
          json: () => Promise.resolve({ ok: true, sessionId: `sidecar-sess-${sessionSeq}` }),
        };
      }
      if (typeof url === 'string' && init?.method === 'DELETE') {
        return { status: 200, json: () => Promise.resolve({ ok: true }) };
      }
      if (typeof url === 'string' && url.endsWith('/connected')) {
        return { status: 200, json: () => Promise.resolve({ connected: true }) };
      }
      return { status: 200, json: () => Promise.resolve({ ok: true }) };
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('holds meshtastic and meshcore sessions concurrently on different addresses', async () => {
    await expect(proxy.connect('meshtastic', 'AA:BB:CC:DD:EE:01')).resolves.toEqual({ ok: true });
    await expect(proxy.connect('meshcore', 'AA:BB:CC:DD:EE:02')).resolves.toEqual({ ok: true });

    await expect(proxy.isConnected('meshtastic')).resolves.toBe(true);
    await expect(proxy.isConnected('meshcore')).resolves.toBe(true);
  });

  it('disconnecting one session leaves the other connected', async () => {
    await proxy.connect('meshtastic', 'AA:BB:CC:DD:EE:01');
    await proxy.connect('meshcore', 'AA:BB:CC:DD:EE:02');

    await proxy.disconnect('meshtastic');

    await expect(proxy.isConnected('meshtastic')).resolves.toBe(false);
    await expect(proxy.isConnected('meshcore')).resolves.toBe(true);
  });

  it('reconnect of the same profile replaces its session without dropping the peer', async () => {
    await proxy.connect('meshtastic', 'AA:BB:CC:DD:EE:01');
    await proxy.connect('meshcore', 'AA:BB:CC:DD:EE:02');
    await proxy.connect('meshtastic', 'AA:BB:CC:DD:EE:03');

    await expect(proxy.isConnected('meshtastic')).resolves.toBe(true);
    await expect(proxy.isConnected('meshcore')).resolves.toBe(true);
  });
});

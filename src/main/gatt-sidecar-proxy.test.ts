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

describe('GattSidecarProxy', () => {
  let proxy: GattSidecarProxy;
  interface FetchResult {
    status: number;
    json: () => Promise<unknown>;
  }
  let fetchMock: ReturnType<
    typeof vi.fn<(url?: unknown, init?: RequestInit) => Promise<FetchResult>>
  >;

  beforeEach(() => {
    proxy = new GattSidecarProxy();
    proxy.setPort(9876);
    fetchMock = vi.fn<(url?: unknown, init?: RequestInit) => Promise<FetchResult>>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    await proxy.disconnectAll().catch(() => {
      // catch-no-log-ok — tests may not have an open session
    });
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('connect maps session and emits connected', async () => {
    const connected = vi.fn();
    proxy.on('connected', connected);
    fetchMock.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ ok: true, sessionId: 'sidecar-sess-1', rssi: -55 }),
    });

    const result = await proxy.connect('meshtastic', 'AA:BB:CC:DD:EE:FF');

    expect(result).toEqual({ ok: true });
    expect(connected).toHaveBeenCalledWith({ sessionId: 'meshtastic' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/api/v1/gatt/sessions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ profile: 'meshtastic', address: 'AA:BB:CC:DD:EE:FF' }),
      }),
    );
  });

  it('toRadio posts base64 payload', async () => {
    fetchMock.mockImplementation((url: unknown) => {
      const href = typeof url === 'string' ? url : '';
      if (href.includes('/write')) {
        return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) });
      }
      if (href.includes('/rssi')) {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ ok: true, rssi: -70 }),
        });
      }
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ ok: true, sessionId: 'sidecar-sess-2' }),
      });
    });

    await proxy.connect('meshcore', '11:22:33:44:55:66');
    await proxy.toRadio('meshcore', new Uint8Array([1, 2, 3]));

    const writeCall = fetchMock.mock.calls.find(([url]) => {
      const href = typeof url === 'string' ? url : '';
      return href.includes('/write');
    });
    expect(writeCall).toBeDefined();
    const [, init] = writeCall!;
    expect(JSON.parse(init!.body as string)).toEqual({
      data_b64: Buffer.from([1, 2, 3]).toString('base64'),
    });
  });

  it('connect error emits issue', async () => {
    const issue = vi.fn();
    proxy.on('issue', issue);
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: () => Promise.resolve({ ok: false, code: 'connect_timeout', error: 'nope' }),
    });

    const result = await proxy.connect('meshcore', 'AA:BB:CC:DD:EE:FF');

    expect(result).toEqual({
      ok: false,
      error: 'nope',
      code: 'connect_timeout',
    });
    expect(issue).toHaveBeenCalledWith({
      sessionId: 'meshcore',
      code: 'connect_timeout',
      message: 'nope',
    });
  });

  it('startScan emits discovered devices without synthesizing poweredOn', async () => {
    const discovered = vi.fn();
    const adapterState = vi.fn();
    proxy.on('deviceDiscovered', discovered);
    proxy.on('adapterState', adapterState);
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: () =>
        Promise.resolve({
          ok: true,
          devices: [{ address: 'ff92959fd78be6f009376829a4d6efdc', name: 'MeshCore', rssi: -60 }],
        }),
    });

    const result = await proxy.startScan('meshcore');

    expect(result).toEqual({ ok: true });
    expect(discovered).toHaveBeenCalledWith({
      deviceId: 'ff92959fd78be6f009376829a4d6efdc',
      deviceName: 'MeshCore',
      rssi: -60,
      address: 'ff92959fd78be6f009376829a4d6efdc',
    });
    expect(adapterState).not.toHaveBeenCalled();
  });

  it('connect starts RSSI poll and emits linkRssi', async () => {
    vi.useFakeTimers();
    const linkRssi = vi.fn();
    proxy.on('linkRssi', linkRssi);
    fetchMock.mockImplementation((url: unknown) => {
      const href = typeof url === 'string' ? url : '';
      if (href.includes('/rssi')) {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ ok: true, rssi: -72 }),
        });
      }
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ ok: true, sessionId: 'sidecar-sess-rssi' }),
      });
    });

    const result = await proxy.connect('meshtastic', 'aa:bb:cc:dd:ee:ff');
    expect(result).toEqual({ ok: true });

    await vi.advanceTimersByTimeAsync(0);
    expect(linkRssi).toHaveBeenCalledWith({ sessionId: 'meshtastic', rssi: -72 });

    await proxy.disconnect('meshtastic');
    vi.useRealTimers();
  });

  it('disconnect clears local session before sidecar DELETE completes', async () => {
    fetchMock.mockImplementation((url: unknown, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return new Promise(() => {
          // never resolve — simulates hung sidecar BLE teardown
        });
      }
      const href = typeof url === 'string' ? url : '';
      if (href.includes('/rssi')) {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ ok: true, rssi: -70 }),
        });
      }
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ ok: true, sessionId: 'sidecar-hang' }),
      });
    });

    await proxy.connect('meshcore', 'aa:bb:cc:dd:ee:01');
    const disconnected = vi.fn();
    proxy.on('disconnected', disconnected);

    await expect(proxy.disconnect('meshcore')).resolves.toBeUndefined();
    await expect(proxy.isConnected('meshcore')).resolves.toBe(false);
    expect(disconnected).toHaveBeenCalledWith({ sessionId: 'meshcore' });
  });
});

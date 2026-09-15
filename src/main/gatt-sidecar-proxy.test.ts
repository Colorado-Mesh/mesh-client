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
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    proxy = new GattSidecarProxy();
    proxy.setPort(9876);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('connect maps session and emits connected', async () => {
    const connected = vi.fn();
    proxy.on('connected', connected);
    fetchMock.mockResolvedValueOnce({
      status: 200,
      json: () => Promise.resolve({ ok: true, sessionId: 'sidecar-sess-1' }),
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
    fetchMock
      .mockResolvedValueOnce({
        status: 200,
        json: () => Promise.resolve({ ok: true, sessionId: 'sidecar-sess-2' }),
      })
      .mockResolvedValueOnce({
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      });

    await proxy.connect('meshcore', '11:22:33:44:55:66');
    await proxy.toRadio('meshcore', new Uint8Array([1, 2, 3]));

    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('http://127.0.0.1:9876/api/v1/gatt/sessions/sidecar-sess-2/write');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
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
});

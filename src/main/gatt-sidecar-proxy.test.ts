// @vitest-environment node
import type { EventEmitter as NodeEventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const wsMock = vi.hoisted(() => ({
  autoOpen: true,
  sockets: [] as (NodeEventEmitter & {
    readyState: number;
    close: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
  })[],
}));

vi.mock('ws', async () => {
  const { EventEmitter } = await import('events');
  class MockWebSocket extends EventEmitter {
    static CONNECTING = 0;
    static OPEN = 1;
    readyState = 0;
    close = vi.fn(() => {
      this.readyState = 3;
      this.emit('close');
    });
    terminate = vi.fn(() => {
      this.readyState = 3;
      this.emit('close');
    });

    constructor() {
      super();
      wsMock.sockets.push(this);
      if (wsMock.autoOpen) {
        queueMicrotask(() => {
          if (this.readyState !== 0) return;
          this.readyState = 1;
          this.emit('open');
        });
      }
    }
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
    wsMock.autoOpen = true;
    wsMock.sockets = [];
    proxy = new GattSidecarProxy();
    proxy.setPort(9876);
    fetchMock = vi.fn<(url?: unknown, init?: RequestInit) => Promise<FetchResult>>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    await proxy.disconnectAll().catch(() => {
      // catch-no-log-ok — tests may not have an open session
    });
    proxy.invalidateAfterSidecarExit();
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

  it.each([
    { status: 503, body: { ok: true } },
    { status: 200, body: {} },
    { status: 200, body: null },
  ])('rejects an unacknowledged write (%j)', async ({ status, body }) => {
    fetchMock.mockImplementation((url: unknown) =>
      Promise.resolve({
        status: String(url).endsWith('/write') ? status : 200,
        json: () =>
          Promise.resolve(
            String(url).endsWith('/write') ? body : { ok: true, sessionId: 'write-reply-session' },
          ),
      }),
    );
    await proxy.connect('meshtastic', 'AA:BB:CC:DD:EE:01');
    await expect(proxy.toRadio('meshtastic', new Uint8Array([1]))).rejects.toThrow('write failed');
  });

  it('reports a failed HTTP scan instead of an empty successful scan', async () => {
    fetchMock.mockResolvedValue({
      status: 503,
      json: () => Promise.resolve({ error: 'unavailable' }),
    });
    await expect(proxy.startScan('meshcore')).resolves.toMatchObject({
      ok: false,
      error: 'unavailable',
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
    expect(proxy.getConnections()).toEqual([{ mac: 'aa:bb:cc:dd:ee:01', owner: 'gatt:meshcore' }]);
  });

  it('invalidateAfterSidecarExit clears port and emits disconnected for open sessions', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ ok: true, sessionId: 'sidecar-sess-x', rssi: -50 }),
    });
    await proxy.connect('meshtastic', 'AA:BB:CC:DD:EE:01');
    const disconnected = vi.fn();
    proxy.on('disconnected', disconnected);

    proxy.invalidateAfterSidecarExit();

    expect(disconnected).toHaveBeenCalledWith({ sessionId: 'meshtastic' });
    await expect(proxy.isConnected('meshtastic')).resolves.toBe(false);

    // Next ensure must re-run (port was cleared) — mock ensure returns a new port.
    proxy.setEnsureSidecar(() => Promise.resolve(4242));
    fetchMock.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ ok: true, sessionId: 'sidecar-sess-y' }),
    });
    await proxy.connect('meshtastic', 'AA:BB:CC:DD:EE:02');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4242/api/v1/gatt/sessions',
      expect.anything(),
    );
  });

  it('waits for the event socket before reporting a connected radio', async () => {
    wsMock.autoOpen = false;
    fetchMock.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ ok: true, sessionId: 'opening' }),
    });
    const connected = vi.fn();
    proxy.on('connected', connected);

    const connecting = proxy.connect('meshcore', 'aa:bb:cc:dd:ee:01');
    await vi.waitFor(() => {
      expect(wsMock.sockets).toHaveLength(1);
    });
    expect(connected).not.toHaveBeenCalled();

    wsMock.sockets[0].readyState = 1;
    wsMock.sockets[0].emit('open');
    await expect(connecting).resolves.toEqual({ ok: true });
    expect(connected).toHaveBeenCalledOnce();
  });

  it('handles a refused event socket without an uncaught error or successful connect', async () => {
    wsMock.autoOpen = false;
    fetchMock.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ ok: true, sessionId: 'refused' }),
    });
    const connected = vi.fn();
    proxy.on('connected', connected);
    const connecting = proxy.connect('meshcore', 'aa:bb:cc:dd:ee:01');
    await vi.waitFor(() => {
      expect(wsMock.sockets).toHaveLength(1);
    });

    expect(() => wsMock.sockets[0].emit('error', new Error('ECONNREFUSED'))).not.toThrow();
    await expect(connecting).resolves.toMatchObject({ ok: false });
    expect(connected).not.toHaveBeenCalled();
    await expect(proxy.isConnected('meshcore')).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/api/v1/gatt/sessions/refused',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it.each(['disconnect', 'sidecar exit', 'quit'] as const)(
    'discards and deletes a late HTTP session after %s during connect',
    async (cancel) => {
      let finishCreate!: (response: FetchResult) => void;
      fetchMock.mockImplementation((_url, init) => {
        if (init?.method === 'POST') {
          return new Promise<FetchResult>((resolve) => {
            finishCreate = resolve;
          });
        }
        return Promise.resolve({ status: 200, json: () => Promise.resolve({ ok: true }) });
      });
      const connected = vi.fn();
      proxy.on('connected', connected);
      const connecting = proxy.connect('meshcore', 'aa:bb:cc:dd:ee:01');
      await vi.waitFor(() => {
        expect(finishCreate).toBeTypeOf('function');
      });

      if (cancel === 'disconnect') await proxy.disconnect('meshcore');
      else if (cancel === 'quit') await proxy.disconnectAll();
      else proxy.invalidateAfterSidecarExit();
      finishCreate({
        status: 200,
        json: () => Promise.resolve({ ok: true, sessionId: 'late-session' }),
      });

      await expect(connecting).resolves.toMatchObject({ ok: false });
      expect(connected).not.toHaveBeenCalled();
      expect(wsMock.sockets).toHaveLength(0);
      await expect(proxy.isConnected('meshcore')).resolves.toBe(false);
      if (cancel !== 'sidecar exit') {
        expect(fetchMock).toHaveBeenCalledWith(
          'http://127.0.0.1:9876/api/v1/gatt/sessions/late-session',
          expect.objectContaining({ method: 'DELETE' }),
        );
      }
    },
  );

  it('ignores messages and errors from a replaced session socket', async () => {
    let session = 0;
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve({
        status: 200,
        json: () =>
          Promise.resolve({
            ok: true,
            sessionId: init?.method === 'POST' ? `session-${++session}` : undefined,
            connected: true,
          }),
      }),
    );
    await proxy.connect('meshcore', 'aa:bb:cc:dd:ee:01');
    const oldSocket = wsMock.sockets[0];
    await proxy.connect('meshcore', 'aa:bb:cc:dd:ee:02');
    const disconnected = vi.fn();
    const fromRadio = vi.fn();
    const issue = vi.fn();
    proxy.on('disconnected', disconnected);
    proxy.on('fromRadio', fromRadio);
    proxy.on('issue', issue);

    oldSocket.emit('message', Buffer.from(JSON.stringify({ type: 'bytes', data_b64: 'AQ==' })));
    oldSocket.emit('message', Buffer.from(JSON.stringify({ type: 'disconnected' })));
    expect(() => oldSocket.emit('error', new Error('late socket error'))).not.toThrow();

    expect(fromRadio).not.toHaveBeenCalled();
    expect(disconnected).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
    await expect(proxy.isConnected('meshcore')).resolves.toBe(true);
  });

  it('cancels an opening socket promptly and handles its later error', async () => {
    wsMock.autoOpen = false;
    fetchMock.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ ok: true, sessionId: 'opening' }),
    });
    const connected = vi.fn();
    proxy.on('connected', connected);
    const connecting = proxy.connect('meshcore', 'aa:bb:cc:dd:ee:01');
    await vi.waitFor(() => {
      expect(wsMock.sockets).toHaveLength(1);
    });

    await proxy.disconnect('meshcore');

    await expect(connecting).resolves.toMatchObject({ ok: false, code: 'connect_aborted' });
    expect(() => wsMock.sockets[0].emit('error', new Error('closed before opening'))).not.toThrow();
    expect(connected).not.toHaveBeenCalled();
    expect(proxy.getConnections()).toEqual([]);
  });

  it('deletes the remote session when an established event socket fails', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ ok: true, sessionId: 'lost-events', connected: true }),
    });
    await proxy.connect('meshcore', 'aa:bb:cc:dd:ee:01');
    const disconnected = vi.fn();
    proxy.on('disconnected', disconnected);

    expect(() => wsMock.sockets[0].emit('error', new Error('read ECONNRESET'))).not.toThrow();
    wsMock.sockets[0].emit('close');

    expect(disconnected).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(proxy.getConnections()).toEqual([]);
    });
    await expect(proxy.isConnected('meshcore')).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/api/v1/gatt/sessions/lost-events',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('reserves a pending connection before yielding and releases it on failure', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ ok: false, error: 'adapter unavailable' }),
    });
    const guard = vi.fn();
    proxy.setConnectionGuard(guard);

    const connecting = proxy.connect('meshcore', 'aa:bb:cc:dd:ee:01');

    expect(guard).toHaveBeenCalledWith('meshcore', 'aa:bb:cc:dd:ee:01');
    expect(proxy.getConnections()).toEqual([{ mac: 'aa:bb:cc:dd:ee:01', owner: 'gatt:meshcore' }]);
    await expect(connecting).resolves.toMatchObject({ ok: false });
    expect(proxy.getConnections()).toEqual([]);
  });

  it('preserves an established connection when the replacement fails the guard', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ ok: true, sessionId: 'kept', connected: true }),
    });
    await proxy.connect('meshcore', 'aa:bb:cc:dd:ee:01');
    proxy.setConnectionGuard(() => {
      throw new Error('MAC conflict');
    });

    await expect(proxy.connect('meshcore', 'aa:bb:cc:dd:ee:02')).rejects.toThrow('MAC conflict');

    expect(proxy.getConnections()).toEqual([{ mac: 'aa:bb:cc:dd:ee:01', owner: 'gatt:meshcore' }]);
    expect(wsMock.sockets[0].close).not.toHaveBeenCalled();
    await expect(proxy.isConnected('meshcore')).resolves.toBe(true);
  });

  it('keeps the replacement reservation and session when the first HTTP connect finishes late', async () => {
    let finishFirst!: (response: FetchResult) => void;
    let requests = 0;
    fetchMock.mockImplementation((_url, init) => {
      if (init?.method === 'POST' && ++requests === 1) {
        return new Promise<FetchResult>((resolve) => {
          finishFirst = resolve;
        });
      }
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ ok: true, sessionId: 'current', connected: true }),
      });
    });
    const first = proxy.connect('meshcore', 'aa:bb:cc:dd:ee:01');
    await vi.waitFor(() => {
      expect(finishFirst).toBeTypeOf('function');
    });
    await expect(proxy.connect('meshcore', 'aa:bb:cc:dd:ee:02')).resolves.toEqual({ ok: true });

    finishFirst({ status: 200, json: () => Promise.resolve({ ok: true, sessionId: 'stale' }) });

    await expect(first).resolves.toMatchObject({ ok: false });
    expect(proxy.getConnections()).toEqual([{ mac: 'aa:bb:cc:dd:ee:02', owner: 'gatt:meshcore' }]);
    expect(wsMock.sockets).toHaveLength(1);
    await expect(proxy.isConnected('meshcore')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/api/v1/gatt/sessions/stale',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('does not start a replacement sidecar to clean up an old session', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ ok: true, sessionId: 'old-process' }),
    });
    await proxy.connect('meshcore', 'aa:bb:cc:dd:ee:01');
    const ensure = vi.fn(() => Promise.resolve(1234));
    proxy.setEnsureSidecar(ensure);
    proxy.setPort(0);

    await proxy.disconnect('meshcore');

    expect(ensure).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/api/v1/gatt/sessions/old-process',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('ignores a stale connected probe after disconnect', async () => {
    let finishProbe!: (response: FetchResult) => void;
    fetchMock.mockImplementation((url) => {
      if (String(url).endsWith('/connected')) {
        return new Promise<FetchResult>((resolve) => {
          finishProbe = resolve;
        });
      }
      return Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ ok: true, sessionId: 'probe' }),
      });
    });
    await proxy.connect('meshcore', 'aa:bb:cc:dd:ee:01');
    const probe = proxy.isConnected('meshcore');
    await proxy.disconnect('meshcore');

    finishProbe({ status: 200, json: () => Promise.resolve({ connected: true }) });

    await expect(probe).resolves.toBe(false);
  });

  it('keeps a cancelled connect reserved until its late remote session is deleted', async () => {
    let finishCreate!: (response: FetchResult) => void;
    let finishDelete!: (response: FetchResult) => void;
    fetchMock.mockImplementation((_url, init) => {
      if (init?.method === 'POST') {
        return new Promise<FetchResult>((resolve) => {
          finishCreate = resolve;
        });
      }
      return new Promise<FetchResult>((resolve) => {
        finishDelete = resolve;
      });
    });
    const connecting = proxy.connect('meshcore', 'aa:bb:cc:dd:ee:01');
    await vi.waitFor(() => {
      expect(finishCreate).toBeTypeOf('function');
    });
    await proxy.disconnect('meshcore');
    const expected = [{ mac: 'aa:bb:cc:dd:ee:01', owner: 'gatt:meshcore' }];
    expect(proxy.getConnections()).toEqual(expected);

    finishCreate({ status: 200, json: () => Promise.resolve({ ok: true, sessionId: 'late' }) });
    await expect(connecting).resolves.toMatchObject({ ok: false });
    expect(proxy.getConnections()).toEqual(expected);
    finishDelete({ status: 200, json: () => Promise.resolve({ ok: true }) });

    await vi.waitFor(() => {
      expect(proxy.getConnections()).toEqual([]);
    });
  });

  it('confirms a session is gone when DELETE returns an empty response', async () => {
    fetchMock.mockImplementation((url, init) =>
      Promise.resolve({
        status: 200,
        json: () =>
          Promise.resolve(
            init?.method === 'DELETE'
              ? {}
              : String(url).endsWith('/connected')
                ? { connected: false }
                : { ok: true, sessionId: 'already-gone' },
          ),
      }),
    );
    await proxy.connect('meshcore', 'aa:bb:cc:dd:ee:01');

    await proxy.disconnect('meshcore');

    await vi.waitFor(() => {
      expect(proxy.getConnections()).toEqual([]);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9876/api/v1/gatt/sessions/already-gone/connected',
      expect.anything(),
    );
  });

  it('retries uncertain teardown while keeping the peripheral reserved', async () => {
    vi.useFakeTimers();
    let deletes = 0;
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve({
        status: 200,
        json: () =>
          Promise.resolve(
            init?.method === 'DELETE'
              ? { ok: ++deletes > 1 }
              : { ok: true, sessionId: 'slow-teardown', connected: true },
          ),
      }),
    );
    await proxy.connect('meshcore', 'aa:bb:cc:dd:ee:01');

    await proxy.disconnect('meshcore');
    await vi.advanceTimersByTimeAsync(0);

    expect(deletes).toBe(1);
    expect(proxy.getConnections()).toEqual([{ mac: 'aa:bb:cc:dd:ee:01', owner: 'gatt:meshcore' }]);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(deletes).toBe(2);
    expect(proxy.getConnections()).toEqual([]);
  });

  it('abandons remote cleanup after max attempts when DELETE always times out', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    let deletes = 0;
    fetchMock.mockImplementation((url, init) => {
      const href = typeof url === 'string' ? url : '';
      if (href.includes('/rssi')) {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ ok: true, rssi: -70 }),
        });
      }
      if (init?.method === 'POST') {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ ok: true, sessionId: 'dead-peripheral' }),
        });
      }
      if (init?.method === 'DELETE') {
        deletes += 1;
        return Promise.reject(new Error('The operation was aborted due to timeout'));
      }
      // connected probe also hangs like a dead radio
      return Promise.reject(new Error('The operation was aborted due to timeout'));
    });
    await proxy.connect('meshcore', 'aa:bb:cc:dd:ee:99');

    await proxy.disconnect('meshcore');
    await vi.advanceTimersByTimeAsync(0);
    expect(deletes).toBe(1);
    expect(proxy.getConnections()).toEqual([{ mac: 'aa:bb:cc:dd:ee:99', owner: 'gatt:meshcore' }]);

    // Attempts 2–8 each wait GATT_RSSI_POLL_MS (4s) after the previous failure.
    for (let attempt = 2; attempt <= 8; attempt++) {
      await vi.advanceTimersByTimeAsync(4_000);
      expect(deletes).toBe(attempt);
    }
    expect(proxy.getConnections()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      '[GATT] abandoning remote cleanup after',
      8,
      'attempts:',
      expect.stringContaining('meshcore'),
    );
    // No further DELETE after abandon.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(deletes).toBe(8);
    warn.mockRestore();
    debug.mockRestore();
  });

  it('releases on mid-retry DELETE success before cleanup budget is exhausted', async () => {
    vi.useFakeTimers();
    let deletes = 0;
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve({
        status: 200,
        json: () =>
          Promise.resolve(
            init?.method === 'DELETE'
              ? { ok: ++deletes >= 3 }
              : { ok: true, sessionId: 'mid-retry', connected: true },
          ),
      }),
    );
    await proxy.connect('meshcore', 'aa:bb:cc:dd:ee:02');

    await proxy.disconnect('meshcore');
    await vi.advanceTimersByTimeAsync(0);
    expect(deletes).toBe(1);
    expect(proxy.getConnections()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(deletes).toBe(2);
    expect(proxy.getConnections()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(deletes).toBe(3);
    expect(proxy.getConnections()).toEqual([]);

    // Would have been attempts 4–8 if still reserved — budget not forced.
    await vi.advanceTimersByTimeAsync(4_000 * 5);
    expect(deletes).toBe(3);
  });
});

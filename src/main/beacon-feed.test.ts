// @vitest-environment node
import dns from 'node:dns/promises';
import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';

import type { BeaconFeedUpdate } from '../shared/beacon';
import {
  BeaconFeedClient,
  type BeaconFeedDependencies,
  parseBeaconConnectRequest,
} from './beacon-feed';

class FakeSocket extends EventEmitter {
  send = vi.fn();
  ping = vi.fn();
  terminate = vi.fn(() => this.emit('close'));
}

function harness() {
  const updates: BeaconFeedUpdate[] = [];
  const sockets: FakeSocket[] = [];
  const dependencies: BeaconFeedDependencies = {
    resolve: vi.fn().mockResolvedValue({ address: '8.8.8.8', family: 4 }),
    getJson: vi.fn((url: URL) =>
      Promise.resolve(
        url.pathname.endsWith('/regions') ? [{ slug: 'front-range' }] : { items: [] },
      ),
    ),
    openSocket: vi.fn(() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    }),
  };
  const client = new BeaconFeedClient((update) => updates.push(update), dependencies);
  return { updates, sockets, dependencies, client };
}

const request = { baseUrl: 'https://map.meshcore.coloradomesh.org', region: 'front-range' };
const observation = {
  v: 1,
  type: 'event',
  event: 'packetObservation',
  data: {
    packetHash: 'aabbccdd',
    packet: { routeType: 1, payloadTypeName: 'GRP_TXT' },
    observation: { heardAt: 10, resolvedPath: [] },
  },
};

function message(socket: FakeSocket, value: unknown): void {
  socket.emit('message', Buffer.from(JSON.stringify(value)), false);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Beacon public URL validation', () => {
  it('normalizes the HTTPS origin and accepts an optional region slug', () => {
    expect(parseBeaconConnectRequest({ ...request, baseUrl: `${request.baseUrl}/` })).toEqual(
      request,
    );
  });

  it.each([
    'http://example.org',
    'https://user:secret@example.org',
    'https://example.org/?token=secret',
    'https://example.org/#secret',
    'https://example.org/admin',
    'https://example.org:8080',
    'https://localhost',
    'https://radio.local',
    'https://169.254.169.254',
    'https://2130706433',
    'https://[::1]',
  ])('rejects non-public or credential-bearing input %s', (baseUrl) => {
    expect(() => parseBeaconConnectRequest({ baseUrl })).toThrow();
  });

  it.each(['', '../admin', 'a'.repeat(101), ['DEN']])('rejects invalid region %s', (region) => {
    expect(() => parseBeaconConnectRequest({ ...request, region })).toThrow();
  });

  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', 'fd00::1'])(
    'blocks DNS resolution to %s',
    async (address) => {
      vi.spyOn(dns, 'lookup').mockResolvedValue({ address, family: address.includes(':') ? 6 : 4 });
      const update = vi.fn();
      const client = new BeaconFeedClient(update);
      await expect(client.connect(request)).rejects.toThrow('public internet address');
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'error' }));
    },
  );
});

describe('BeaconFeedClient lifecycle and bounded public data', () => {
  it('loads a bounded directory then subscribes to the real regional read-only stream', async () => {
    const { client, dependencies, sockets, updates } = harness();
    await client.connect(request);
    expect(dependencies.getJson).toHaveBeenCalledTimes(4);
    const directoryUrls = vi
      .mocked(dependencies.getJson)
      .mock.calls.map(([url]) => url)
      .filter((url) => ['/api/v1/nodes', '/api/v1/observers'].includes(url.pathname));
    expect(directoryUrls.every((url) => url.searchParams.get('region') === 'front-range')).toBe(
      true,
    );
    expect(updates).toContainEqual(expect.objectContaining({ type: 'snapshot', messages: [] }));
    const socket = sockets[0];
    socket.emit('open');
    expect(socket.send.mock.calls.map(([text]) => JSON.parse(text as string))).toEqual([
      {
        v: 1,
        type: 'configure',
        id: 'map-config',
        resolvePath: true,
        includeObserverKey: true,
        includeRepeats: true,
      },
      {
        v: 1,
        type: 'subscribe',
        id: 'map-feed',
        scope: { regionSlugs: ['front-range'], events: ['packetObservation', 'channelMessage'] },
      },
    ]);
    expect(updates.some((update) => update.type === 'status' && update.status === 'live')).toBe(
      false,
    );
    message(socket, { type: 'subscribed', id: 'map-feed' });
    expect(updates.at(-1)).toEqual({ type: 'status', status: 'live', provider: 'beacon' });
    message(socket, observation);
    expect(updates.at(-1)).toEqual({
      type: 'packet',
      packet: observation.data,
      provider: 'beacon',
    });
    message(socket, {
      type: 'event',
      event: 'channelMessage',
      data: { packetHash: 'aabbccdd', content: 'Hello' },
    });
    expect(updates.at(-1)).toEqual({
      type: 'message',
      provider: 'beacon',
      message: { packetHash: 'aabbccdd', content: 'Hello' },
    });
    client.disconnect();
  });

  it('uses server-sized cursor pages with a hard 5000-node bound', async () => {
    const { client, dependencies, updates } = harness();
    let cursor = 0;
    vi.mocked(dependencies.getJson).mockImplementation((url) =>
      Promise.resolve(
        url.pathname.endsWith('/nodes')
          ? {
              items: Array.from({ length: 200 }, (_, id) => ({ id })),
              hasMore: true,
              nextCursor: ++cursor,
            }
          : url.pathname.endsWith('/regions')
            ? [{ slug: 'front-range' }]
            : { items: [] },
      ),
    );
    await client.connect(request);
    const urls = vi
      .mocked(dependencies.getJson)
      .mock.calls.map(([url]) => url)
      .filter((url) => url.pathname.endsWith('/nodes'));
    expect(urls.map((url) => url.searchParams.get('cursor'))).toEqual([
      null,
      ...Array.from({ length: 24 }, (_, i) => String(i + 1)),
    ]);
    const snapshot = updates.find((update) => update.type === 'snapshot');
    expect(snapshot?.type === 'snapshot' && snapshot.nodes.length).toBe(5000);
    expect(snapshot?.type === 'snapshot' && snapshot.directoryLimited).toBe(true);
    client.disconnect();
  });

  it('does not recreate a socket after disconnect during DNS or after pending reconnect', async () => {
    const { client, dependencies, sockets } = harness();
    let resolveDns: ((value: { address: string; family: 4 }) => void) | undefined;
    vi.mocked(dependencies.resolve).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDns = resolve;
        }),
    );
    const pending = client.connect(request);
    client.disconnect();
    resolveDns?.({ address: '8.8.8.8', family: 4 });
    await pending;
    expect(dependencies.openSocket).not.toHaveBeenCalled();
    await client.connect(request);
    sockets[0].emit('close');
    client.disconnect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dependencies.openSocket).toHaveBeenCalledTimes(1);
  });

  it('aborts in-flight REST work and ignores stale connection data', async () => {
    const { client, dependencies, updates } = harness();
    const signals: AbortSignal[] = [];
    const resolves: ((value: unknown) => void)[] = [];
    vi.mocked(dependencies.getJson).mockImplementation((_url, _address, signal) => {
      signals.push(signal);
      return new Promise((resolve) => resolves.push(resolve));
    });
    const pending = client.connect(request);
    await Promise.resolve();
    client.disconnect();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    resolves.forEach((resolve) => {
      resolve({ items: [] });
    });
    await pending;
    expect(updates.filter((update) => update.type === 'snapshot')).toHaveLength(0);
  });

  it('rejects malformed, deeply nested, and excessively large event fields', async () => {
    const { client, sockets, updates } = harness();
    await client.connect(request);
    const socket = sockets[0];
    socket.emit('message', Buffer.from('{bad'), false);
    message(socket, { ...observation, data: { observation: null, packet: {} } });
    message(socket, { ...observation, data: { ...observation.data, bad: 'x'.repeat(65_537) } });
    let nested: unknown = {};
    for (let i = 0; i < 20; i++) nested = { nested };
    message(socket, { ...observation, data: { ...observation.data, nested } });
    socket.emit('message', Buffer.from(JSON.stringify(observation)), true);
    expect(updates.filter((update) => update.type === 'packet')).toHaveLength(0);
    client.disconnect();
  });

  it('bounds JSON parsing for malformed bursts before decoding remote content', async () => {
    const { client, sockets } = harness();
    await client.connect(request);
    const parse = vi.spyOn(JSON, 'parse');
    for (let i = 0; i < 500; i++) sockets[0].emit('message', Buffer.from('{bad'), false);
    expect(parse).toHaveBeenCalledTimes(256 + 8);
    await vi.advanceTimersByTimeAsync(1000);
    sockets[0].emit('message', Buffer.from('{bad'), false);
    expect(parse).toHaveBeenCalledTimes(256 + 8 + 1);
    client.disconnect();
  });

  it('caps parse bytes before Buffer decoding while reserving bounded control notices', async () => {
    const { client, sockets, updates } = harness();
    await client.connect(request);
    const parse = vi.spyOn(JSON, 'parse');
    const largeMalformed = Buffer.alloc(256 * 1024, 'x');
    for (let i = 0; i < 50; i++) sockets[0].emit('message', largeMalformed, false);
    expect(parse).toHaveBeenCalledTimes(8);
    message(sockets[0], observation);
    expect(updates.filter((update) => update.type === 'packet')).toHaveLength(0);
    message(sockets[0], { type: 'lagged' });
    expect(sockets[0].terminate).toHaveBeenCalledOnce();
    expect(parse).toHaveBeenCalledTimes(10);
    client.disconnect();
  });

  it('bounds updates to 100 per second, pings, and backs off reconnects', async () => {
    const { client, sockets, updates, dependencies } = harness();
    await client.connect(request);
    const socket = sockets[0];
    socket.emit('open');
    message(socket, { type: 'subscribed', id: 'map-feed' });
    for (let i = 0; i < 150; i++) message(socket, observation);
    expect(updates.filter((update) => update.type === 'packet')).toHaveLength(100);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(socket.send).toHaveBeenLastCalledWith(
      JSON.stringify({ v: 1, type: 'ping', id: 'map-ping' }),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(socket.terminate).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(dependencies.openSocket).toHaveBeenCalledTimes(2);
    sockets[1].emit('close');
    await vi.advanceTimersByTimeAsync(1999);
    expect(dependencies.openSocket).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(dependencies.openSocket).toHaveBeenCalledTimes(3);
    client.disconnect();
  });

  it.each([-120_000, 120_000])(
    'keeps ingress budgets on elapsed time when the wall clock moves by %i ms',
    async (clockChange) => {
      const { client, sockets, updates } = harness();
      await client.connect(request);
      const socket = sockets[0];
      const parse = vi.spyOn(JSON, 'parse');
      for (let i = 0; i < 100; i++) message(socket, observation);
      for (let i = 0; i < 500; i++) socket.emit('message', Buffer.from('{bad'), false);
      expect(updates.filter((update) => update.type === 'packet')).toHaveLength(100);
      expect(parse).toHaveBeenCalledTimes(256 + 8);

      vi.setSystemTime(Date.now() + clockChange);
      message(socket, observation);
      await vi.advanceTimersByTimeAsync(999);
      message(socket, observation);
      expect(updates.filter((update) => update.type === 'packet')).toHaveLength(100);
      expect(parse).toHaveBeenCalledTimes(256 + 8);

      await vi.advanceTimersByTimeAsync(1);
      for (let i = 0; i < 101; i++) message(socket, observation);
      expect(updates.filter((update) => update.type === 'packet')).toHaveLength(200);
      expect(parse).toHaveBeenCalledTimes(256 + 8 + 101);
      client.disconnect();
    },
  );

  it('reports a directory failure without leaving work or timers running', async () => {
    const { client, dependencies, updates } = harness();
    vi.mocked(dependencies.getJson).mockRejectedValue(new Error('HTTP 500'));
    await expect(client.connect(request)).rejects.toThrow('HTTP 500');
    expect(updates.at(-1)).toMatchObject({ type: 'status', status: 'error' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dependencies.openSocket).not.toHaveBeenCalled();
  });

  it('keeps Beacon backoff until its subscription acknowledgement, not a pong', async () => {
    const { client, sockets, dependencies } = harness();
    await client.connect(request);
    sockets[0].emit('open');
    sockets[0].emit('close');
    await vi.advanceTimersByTimeAsync(1000);
    sockets[1].emit('open');
    sockets[1].emit('pong');
    sockets[1].emit('close');
    await vi.advanceTimersByTimeAsync(1999);
    expect(dependencies.openSocket).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    sockets[2].emit('open');
    message(sockets[2], { type: 'subscribed', id: 'map-feed' });
    sockets[2].emit('close');
    await vi.advanceTimersByTimeAsync(999);
    expect(dependencies.openSocket).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(dependencies.openSocket).toHaveBeenCalledTimes(4);
    client.disconnect();
  });

  it('rejects a stale region rather than letting Beacon silently subscribe to every region', async () => {
    const { client, dependencies } = harness();
    await expect(client.connect({ ...request, region: 'another-region' })).rejects.toThrow(
      'selected region is unavailable',
    );
    expect(dependencies.openSocket).not.toHaveBeenCalled();
  });

  it('resynchronizes directories and recent public messages after lagged or disconnected feeds', async () => {
    const { client, dependencies, sockets, updates } = harness();
    await client.connect(request);
    message(sockets[0], { type: 'lagged' });
    expect(sockets[0].terminate).toHaveBeenCalledOnce();
    expect(updates).toContainEqual({
      type: 'status',
      status: 'reconnecting',
      message: 'refreshing',
      provider: 'beacon',
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(dependencies.getJson).toHaveBeenCalledTimes(8);
    expect(updates.filter((update) => update.type === 'snapshot')).toHaveLength(2);
    expect(sockets).toHaveLength(2);
    sockets[1].emit('open');
    message(sockets[1], { type: 'subscribed', id: 'map-feed' });
    sockets[1].emit('close');
    await vi.advanceTimersByTimeAsync(1000);
    expect(dependencies.getJson).toHaveBeenCalledTimes(12);
    expect(updates.filter((update) => update.type === 'snapshot')).toHaveLength(3);
    client.disconnect();
  });
});

describe('CoreScope through the shared secure feed lifecycle', () => {
  const coreRequest = {
    baseUrl: 'https://analyzer.bostonme.sh',
    provider: 'corescope' as const,
    region: 'BOS',
  };
  function coreHarness() {
    const result = harness();
    vi.mocked(result.dependencies.getJson).mockImplementation((url) =>
      Promise.resolve(
        url.pathname === '/api/nodes'
          ? { nodes: [{ public_key: 'AA' }], has_more: false }
          : url.pathname === '/api/observers'
            ? {
                observers: [
                  { id: 'AA', iata: 'BOS' },
                  { id: 'BB', iata: 'CON' },
                ],
              }
            : { BOS: 'Boston', CON: 'Concord' },
      ),
    );
    return result;
  }

  it('uses the canonical socket without sending Beacon commands and tags/filter observations', async () => {
    const { client, dependencies, sockets, updates } = coreHarness();
    await client.connect(coreRequest);
    expect(vi.mocked(dependencies.openSocket).mock.calls[0][0].href).toBe(
      'wss://analyzer.bostonme.sh/',
    );
    const socket = sockets[0];
    socket.emit('open');
    expect(socket.send).not.toHaveBeenCalled();
    expect(updates.at(-1)).toEqual({ type: 'status', status: 'live', provider: 'corescope' });
    message(socket, {
      type: 'packet',
      data: { hash: 'abcd', observer_id: 'aa', decoded_json: '{"text":"public"}' },
    });
    message(socket, { type: 'packet', data: { hash: 'other', observer_id: 'bb' } });
    message(socket, { type: 'heartbeat' });
    expect(updates.filter((update) => update.type === 'packet')).toEqual([
      {
        type: 'packet',
        provider: 'corescope',
        packet: { hash: 'abcd', observer_id: 'aa', decoded_json: '{"text":"public"}' },
      },
    ]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(socket.ping).toHaveBeenCalledOnce();
    expect(socket.send).not.toHaveBeenCalled();
    socket.emit('pong');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(socket.terminate).not.toHaveBeenCalled();
    client.disconnect();
    expect(updates.at(-1)).toEqual({
      type: 'status',
      status: 'disconnected',
      provider: 'corescope',
    });
  });

  it('resynchronizes regional metadata on reconnect and drops stale provider updates', async () => {
    const { client, dependencies, sockets, updates } = coreHarness();
    await client.connect(coreRequest);
    sockets[0].emit('open');
    sockets[0].emit('close');
    await vi.advanceTimersByTimeAsync(1000);
    expect(dependencies.getJson).toHaveBeenCalledTimes(6);
    expect(updates.filter((update) => update.type === 'snapshot')).toHaveLength(2);
    client.disconnect();
    message(sockets[1], { type: 'packet', data: { observer_id: 'aa' } });
    expect(updates.filter((update) => update.type === 'packet')).toHaveLength(0);
  });

  it.each(['packet', 'pong'] as const)(
    'backs off repeated socket upgrades until a healthy current-socket %s',
    async (healthSignal) => {
      const { client, dependencies, sockets } = coreHarness();
      const packet = { type: 'packet', data: { hash: 'abcd', observer_id: 'aa' } };
      await client.connect(coreRequest);
      for (const [index, delay] of [1000, 2000, 4000].entries()) {
        const socket = sockets[index];
        socket.emit('open');
        socket.emit('message', Buffer.from('{bad'), false);
        socket.emit('message', Buffer.from(JSON.stringify(packet)), true);
        message(socket, { type: 'heartbeat' });
        message(socket, { type: 'packet', data: null });
        message(socket, { type: 'packet', data: { hash: 'filtered', observer_id: 'bb' } });
        if (index > 0) {
          sockets[index - 1].emit('pong');
          message(sockets[index - 1], packet);
        }
        socket.emit('close');
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(dependencies.openSocket).toHaveBeenCalledTimes(index + 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(dependencies.openSocket).toHaveBeenCalledTimes(index + 2);
      }

      const healthy = sockets[3];
      healthy.emit('open');
      if (healthSignal === 'pong') healthy.emit('pong');
      else message(healthy, packet);
      healthy.emit('close');
      await vi.advanceTimersByTimeAsync(999);
      expect(dependencies.openSocket).toHaveBeenCalledTimes(4);
      await vi.advanceTimersByTimeAsync(1);
      expect(dependencies.openSocket).toHaveBeenCalledTimes(5);
      client.disconnect();
    },
  );

  it('ignores health signals from a replaced connection generation', async () => {
    const { client, dependencies, sockets } = coreHarness();
    await client.connect(coreRequest);
    const stale = sockets[0];
    stale.emit('open');
    await client.connect(coreRequest);
    sockets[1].emit('open');
    sockets[1].emit('close');
    await vi.advanceTimersByTimeAsync(1000);
    sockets[2].emit('open');
    stale.emit('pong');
    message(stale, { type: 'packet', data: { hash: 'abcd', observer_id: 'aa' } });
    sockets[2].emit('close');
    await vi.advanceTimersByTimeAsync(1999);
    expect(dependencies.openSocket).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(dependencies.openSocket).toHaveBeenCalledTimes(4);
    client.disconnect();
  });

  it('applies the same preparse budget to malformed CoreScope broadcasts', async () => {
    const { client, sockets } = coreHarness();
    await client.connect(coreRequest);
    const parse = vi.spyOn(JSON, 'parse');
    for (let i = 0; i < 500; i++) sockets[0].emit('message', Buffer.from('{bad'), false);
    expect(parse).toHaveBeenCalledTimes(264);
    client.disconnect();
  });

  it('reserves the forwarding budget for selected-region traffic while retaining its burst cap', async () => {
    const { client, sockets, updates } = coreHarness();
    await client.connect(coreRequest);
    const socket = sockets[0];
    for (let i = 0; i < 100; i++) {
      message(socket, { type: 'packet', data: { hash: `outside-${i}`, observer_id: 'bb' } });
    }
    message(socket, { type: 'packet', data: { hash: 'selected-first', observer_id: 'aa' } });
    expect(updates.filter((update) => update.type === 'packet')).toEqual([
      {
        type: 'packet',
        provider: 'corescope',
        packet: { hash: 'selected-first', observer_id: 'aa' },
      },
    ]);
    for (let i = 0; i < 100; i++) {
      message(socket, { type: 'packet', data: { hash: `selected-${i}`, observer_id: 'aa' } });
    }
    const forwarded = updates.filter((update) => update.type === 'packet');
    expect(forwarded).toHaveLength(100);
    expect(forwarded.every((update) => update.packet.observer_id === 'aa')).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    message(socket, { type: 'packet', data: { hash: 'next-second', observer_id: 'aa' } });
    expect(updates.filter((update) => update.type === 'packet')).toHaveLength(101);
    client.disconnect();
  });

  it('validates provider selection and public-host rules before network work', async () => {
    expect(parseBeaconConnectRequest(coreRequest)).toEqual(coreRequest);
    expect(() => parseBeaconConnectRequest({ ...coreRequest, provider: 'mqtt' })).toThrow(
      'supported regional map provider',
    );
    expect(() =>
      parseBeaconConnectRequest({ ...coreRequest, baseUrl: 'https://127.0.0.1' }),
    ).toThrow('public internet hostname');
    vi.spyOn(dns, 'lookup').mockResolvedValue({ address: '10.0.0.1', family: 4 });
    await expect(new BeaconFeedClient(vi.fn()).connect(coreRequest)).rejects.toThrow(
      'public internet address',
    );
  });
});

describe.each(['beacon', 'corescope'] as const)('%s snapshot cancellation', (provider) => {
  function snapshotHarness() {
    const result = harness();
    const selected = { baseUrl: 'https://regional.example.org', provider };
    const readInitial = (url: URL): Promise<unknown> =>
      Promise.resolve(
        provider === 'beacon'
          ? url.pathname.endsWith('/regions')
            ? []
            : { items: [], hasMore: false }
          : url.pathname === '/api/nodes'
            ? { nodes: [], has_more: false }
            : url.pathname === '/api/observers'
              ? { observers: [] }
              : {},
      );
    vi.mocked(result.dependencies.getJson).mockImplementation(readInitial);
    return { ...result, selected, readInitial };
  }

  it('aborts sibling crawls after every failed reconnect and still permits a later recovery', async () => {
    const { client, dependencies, sockets, selected, readInitial } = snapshotHarness();
    await client.connect(selected);
    const pendingSignals: AbortSignal[] = [];
    let aborted = 0;
    vi.mocked(dependencies.getJson).mockImplementation((url, _address, signal) => {
      if (url.pathname.endsWith('/regions'))
        return Promise.reject(new Error('Region service unavailable'));
      if (url.pathname.endsWith('/messages')) return Promise.resolve({ items: [] });
      pendingSignals.push(signal);
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted++;
            reject(new Error('Snapshot request aborted'));
          },
          { once: true },
        );
      });
    });
    sockets[0].emit('close');
    for (const delay of [1000, 2000, 4000]) await vi.advanceTimersByTimeAsync(delay);
    expect(pendingSignals).toHaveLength(6);
    expect(pendingSignals.every((signal) => signal.aborted)).toBe(true);
    expect(aborted).toBe(6);
    expect(new Set(pendingSignals).size).toBe(3);
    expect(dependencies.openSocket).toHaveBeenCalledTimes(1);
    vi.mocked(dependencies.getJson).mockImplementation(readInitial);
    await vi.advanceTimersByTimeAsync(8000);
    expect(dependencies.openSocket).toHaveBeenCalledTimes(2);
    client.disconnect();
  });

  it('never requests the next page when a canceled reader resolves late', async () => {
    const { client, dependencies, selected, readInitial, updates } = snapshotHarness();
    let releaseNodePage: ((value: unknown) => void) | undefined;
    let nodeSignal: AbortSignal | undefined;
    vi.mocked(dependencies.getJson).mockImplementation((url, _address, signal) => {
      if (!url.pathname.endsWith('/nodes')) return readInitial(url);
      nodeSignal = signal;
      // Deliberately ignore abort in this reader to exercise the pagination boundary itself.
      return new Promise((resolve) => {
        releaseNodePage = resolve;
      });
    });
    const connecting = client.connect(selected);
    await vi.advanceTimersByTimeAsync(0);
    expect(nodeSignal).toBeDefined();
    client.disconnect();
    expect(nodeSignal?.aborted).toBe(true);
    releaseNodePage?.(
      provider === 'beacon'
        ? { items: [{ id: 'late' }], hasMore: true, nextCursor: 1 }
        : { nodes: [{ id: 'late' }], has_more: true },
    );
    await connecting;
    expect(
      vi.mocked(dependencies.getJson).mock.calls.filter(([url]) => url.pathname.endsWith('/nodes')),
    ).toHaveLength(1);
    expect(updates.some((update) => update.type === 'snapshot')).toBe(false);
    expect(dependencies.openSocket).not.toHaveBeenCalled();
  });
});

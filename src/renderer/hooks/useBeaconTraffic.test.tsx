import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createElectronAPIMock } from '@/renderer/vitest.electronApiMock';
import type {
  BeaconConnectResult,
  BeaconFeedApi,
  BeaconFeedUpdate,
  BeaconJsonObject,
  RegionalFeedProvider,
} from '@/shared/beacon';

import { COLORADO_BEACON_URL, useBeaconTraffic } from './useBeaconTraffic';

const NOW = 1_791_684_640_000;
const SOURCE_KEY = '01'.repeat(32);
const OBSERVER_KEY = '02'.repeat(32);

function packet(packetHash = 'packet-1', heardAt = NOW): BeaconJsonObject {
  return {
    packetHash,
    packet: { payloadTypeName: 'GRP_TXT', routeType: 1, routeTypeName: 'FLOOD' },
    observation: {
      observerId: 'observer-uuid',
      observerPublicKey: OBSERVER_KEY,
      heardAt,
      pathLength: { raw: '40', hashSize: 2, hopCount: 0 },
      pathBytes: '',
      resolvedPath: [],
      resolvedSource: {
        confidence: 'high',
        nodes: [
          {
            id: 'source-uuid',
            publicKey: SOURCE_KEY,
            name: 'Source',
            latitude: 40,
            longitude: -105,
          },
        ],
      },
    },
  };
}

function message(packetHash = 'packet-1', content = 'Testing the regional map'): BeaconJsonObject {
  return { packetHash, senderName: 'Example sender', content, sentAt: NOW - 5_000 };
}

function deferredConnect() {
  let resolve!: (value: BeaconConnectResult) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<BeaconConnectResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function snapshot(): BeaconFeedUpdate {
  return {
    type: 'snapshot',
    nodes: [{ id: 'node-uuid', name: 'Observer', publicKey: OBSERVER_KEY, lat: 39.7, lng: -105 }],
    observers: [],
    regions: [{ slug: 'front-range', name: 'Front Range' }],
  };
}

function coreScopePacket(hash = 'packet-1'): BeaconJsonObject {
  return {
    id: 42,
    hash,
    timestamp: new Date(NOW).toISOString(),
    raw_hex: '1500abcd',
    route_type: 1,
    payload_type: 5,
    path_json: JSON.stringify(['01']),
    resolved_path: [SOURCE_KEY],
    observer_id: OBSERVER_KEY,
    decoded: {
      payload: {
        type: 'CHAN',
        decryptionStatus: 'decrypted',
        text: 'CoreScope public text',
        sender: 'Public sender',
      },
    },
  };
}

function coreScopeSnapshot(): BeaconFeedUpdate {
  return {
    type: 'snapshot',
    provider: 'corescope',
    directoryLimited: true,
    nodes: [{ public_key: SOURCE_KEY, name: 'Source', lat: 40, lon: -105 }],
    observers: [{ id: OBSERVER_KEY, name: 'Observer', lat: 39.7, lon: -105 }],
    regions: [{ slug: 'BOS', name: 'Boston' }],
  };
}

describe('useBeaconTraffic', () => {
  let listeners: Set<(update: BeaconFeedUpdate) => void>;
  let api: BeaconFeedApi;
  let hidden: boolean;
  let unsubscribe = vi.fn<() => void>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() =>
      hidden ? 'hidden' : 'visible',
    );
    listeners = new Set();
    unsubscribe = vi.fn<() => void>();
    api = {
      connect: vi.fn().mockResolvedValue({ ok: true }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      onUpdate: vi.fn((listener: (update: BeaconFeedUpdate) => void) => {
        listeners.add(listener);
        return () => {
          unsubscribe();
          listeners.delete(listener);
        };
      }),
    };
    vi.stubGlobal('electronAPI', { ...createElectronAPIMock(), beacon: api });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function emit(update: BeaconFeedUpdate) {
    act(() => {
      for (const listener of listeners) listener(update);
    });
  }

  async function settleEffects() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  function flush(ms = 250) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it('connects the explicitly selected CoreScope provider and normalizes inline text and ordered paths', async () => {
    const { result } = renderHook(() => useBeaconTraffic(true, 'corescope'));
    await settleEffects();
    expect(api.connect).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.connect('https://analyzer.example', 'BOS');
    });
    expect(api.connect).toHaveBeenCalledWith({
      baseUrl: 'https://analyzer.example',
      region: 'BOS',
      provider: 'corescope',
    });
    emit(coreScopeSnapshot());
    emit({ type: 'packet', provider: 'corescope', packet: coreScopePacket() });
    flush();
    expect(result.current.directoryLimited).toBe(true);
    expect(result.current.events).toHaveLength(1);
    const event = result.current.events[0];
    expect(event).toMatchObject({
      source: 'CoreScope',
      messageText: 'CoreScope public text',
      senderLabel: 'Public sender',
      contentStatus: 'decoded',
    });
    expect(event.sourceSessionId).toBeDefined();
    expect(event.segments.map(({ from, to, hopIndex }) => [from.lat, to.lat, hopIndex])).toEqual([
      [40, 39.7, 1],
    ]);
    emit({ type: 'packet', provider: 'corescope', packet: { ...coreScopePacket(), decoded: {} } });
    flush();
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].id).toBe(event.id);
    expect(result.current.events[0].messageText).toBe('CoreScope public text');
  });

  it('clears provider data immediately and stays disconnected until the new provider is explicitly connected', async () => {
    const renders: {
      provider: RegionalFeedProvider;
      eventCount: number;
      pointCount: number;
      regionCount: number;
      directoryLimited: boolean;
    }[] = [];
    const { result, rerender } = renderHook(
      ({ provider }: { provider: RegionalFeedProvider }) => {
        const feed = useBeaconTraffic(true, provider);
        renders.push({
          provider,
          eventCount: feed.events.length,
          pointCount: feed.points.length,
          regionCount: feed.regions.length,
          directoryLimited: feed.directoryLimited,
        });
        return feed;
      },
      { initialProps: { provider: 'corescope' } },
    );
    await settleEffects();
    emit(coreScopeSnapshot());
    emit({ type: 'packet', provider: 'corescope', packet: coreScopePacket() });
    flush();
    expect(result.current.events).toHaveLength(1);
    rerender({ provider: 'beacon' });
    expect(renders.find((render) => render.provider === 'beacon')).toMatchObject({
      eventCount: 0,
      pointCount: 0,
      regionCount: 0,
      directoryLimited: false,
    });
    await settleEffects();
    expect(api.disconnect).toHaveBeenCalledTimes(1);
    expect(api.connect).not.toHaveBeenCalled();
    expect(result.current.status).toBe('disconnected');
    emit(coreScopeSnapshot());
    emit({ type: 'status', provider: 'corescope', status: 'live' });
    emit({ type: 'packet', provider: 'corescope', packet: coreScopePacket() });
    flush();
    expect(result.current.status).toBe('disconnected');
    expect(result.current.events).toEqual([]);
    emit(snapshot());
    emit({ type: 'packet', packet: packet() });
    flush();
    expect(result.current.events[0].source).toBe('Beacon');
  });

  it('accepts late CoreScope observations but refreshes duplicate counts without replaying receipt time', async () => {
    const { result } = renderHook(() => useBeaconTraffic(true, 'corescope'));
    await settleEffects();
    emit(coreScopeSnapshot());
    const report = {
      ...coreScopePacket(),
      timestamp: new Date(NOW - 120_000).toISOString(),
      observation_count: 1,
    };
    emit({ type: 'packet', provider: 'corescope', packet: report });
    flush();
    const first = result.current.events[0];
    expect(first).toMatchObject({
      ts: NOW,
      sourceFirstSeenTs: NOW - 120_000,
      reportedObservationCount: 1,
    });
    flush(1_000);
    emit({ type: 'packet', provider: 'corescope', packet: { ...report, observation_count: 10 } });
    flush();
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toMatchObject({
      id: first.id,
      ts: first.ts,
      reportedObservationCount: 10,
    });
  });

  it('does not connect on mount or on enabling until explicitly requested', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useBeaconTraffic(enabled), {
      initialProps: { enabled: false },
    });
    expect(api.connect).not.toHaveBeenCalled();
    expect(api.onUpdate).not.toHaveBeenCalled();
    await act(async () => {
      expect(await result.current.connect(COLORADO_BEACON_URL)).toBe(false);
    });
    expect(api.connect).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await settleEffects();
    expect(api.onUpdate).toHaveBeenCalledTimes(1);
    expect(api.connect).not.toHaveBeenCalled();
    await act(async () => {
      expect(await result.current.connect(COLORADO_BEACON_URL, 'front-range')).toBe(true);
    });
    expect(api.connect).toHaveBeenCalledWith({
      baseUrl: COLORADO_BEACON_URL,
      region: 'front-range',
      provider: 'beacon',
    });
    expect(result.current.status).toBe('connecting');
    emit({ type: 'status', status: 'live' });
    expect(result.current.status).toBe('live');
  });

  it('surfaces a failed connect result without claiming the feed is live', async () => {
    vi.mocked(api.connect).mockResolvedValue({ ok: false, error: 'Endpoint unavailable' });
    const { result } = renderHook(() => useBeaconTraffic(true));
    await settleEffects();
    await act(async () => {
      expect(await result.current.connect(COLORADO_BEACON_URL)).toBe(false);
    });
    expect(result.current).toMatchObject({
      status: 'error',
      error: 'Endpoint unavailable',
      events: [],
    });
  });

  it('does not let the queued enable reset overwrite an immediate explicit connect', async () => {
    const { result } = renderHook(() => useBeaconTraffic(true));
    await act(async () => {
      expect(await result.current.connect(COLORADO_BEACON_URL)).toBe(true);
    });
    expect(result.current.status).toBe('connecting');
    expect(result.current.error).toBeNull();
  });

  it.each(['failed result', 'rejection'] as const)(
    'ignores a late connect %s after disabling and re-enabling',
    async (completion) => {
      const deferred = deferredConnect();
      vi.mocked(api.connect).mockReturnValue(deferred.promise);
      const { result, rerender } = renderHook(({ enabled }) => useBeaconTraffic(enabled), {
        initialProps: { enabled: true },
      });
      let connected!: Promise<boolean>;
      act(() => {
        connected = result.current.connect(COLORADO_BEACON_URL);
      });
      await settleEffects();
      rerender({ enabled: false });
      rerender({ enabled: true });
      await settleEffects();
      await act(async () => {
        if (completion === 'rejection') deferred.reject(new Error('Old connection failed'));
        else deferred.resolve({ ok: false, error: 'Old connection failed' });
        expect(await connected).toBe(false);
      });
      expect(result.current.status).toBe('disconnected');
      expect(result.current.error).toBeNull();
    },
  );

  it('ignores a replaced connect result without overwriting the newer live connection', async () => {
    const first = deferredConnect();
    const second = deferredConnect();
    vi.mocked(api.connect).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useBeaconTraffic(true));
    let firstConnected!: Promise<boolean>;
    let secondConnected!: Promise<boolean>;
    act(() => {
      firstConnected = result.current.connect(COLORADO_BEACON_URL, 'old-region');
    });
    await settleEffects();
    act(() => {
      secondConnected = result.current.connect(COLORADO_BEACON_URL, 'front-range');
    });
    await settleEffects();
    await act(async () => {
      second.resolve({ ok: true });
      expect(await secondConnected).toBe(true);
    });
    emit({ type: 'status', status: 'live' });
    await act(async () => {
      first.resolve({ ok: false, error: 'Stale connection failure' });
      expect(await firstConnected).toBe(false);
    });
    expect(result.current.status).toBe('live');
    expect(result.current.error).toBeNull();
  });

  it('clears node coordinates, regions, observations and message contents on a new connect', async () => {
    const { result } = renderHook(() => useBeaconTraffic(true));
    await settleEffects();
    emit(snapshot());
    emit({ type: 'message', message: message() });
    emit({ type: 'packet', packet: packet() });
    flush();
    expect(result.current.events[0].segments).toHaveLength(1);
    await act(async () => {
      await result.current.connect('https://other-beacon.example');
    });
    expect(result.current.points).toEqual([]);
    expect(result.current.regions).toEqual([]);
    expect(result.current.events).toEqual([]);
    emit({ type: 'packet', packet: packet() });
    flush();
    expect(result.current.events[0].segments).toEqual([]);
    expect(result.current.events[0].messageText).toBeUndefined();
  });

  it('assigns a new source session on reconnect while preserving exact observation and message identity', async () => {
    const { result } = renderHook(() => useBeaconTraffic(true));
    await act(async () => {
      await result.current.connect(COLORADO_BEACON_URL);
    });
    emit({ type: 'packet', packet: packet() });
    flush();
    const first = result.current.events[0];
    expect(first.sourceSessionId).toBeTruthy();
    await act(async () => {
      await result.current.connect('https://other-beacon.example');
    });
    emit({ type: 'packet', packet: packet() });
    flush();
    const second = result.current.events[0];
    expect(second.sourceSessionId).not.toBe(first.sourceSessionId);
    expect(second.id).toBe(first.id);
    expect(second.packetHash).toBe(first.packetHash);
    emit({ type: 'message', message: message() });
    flush();
    expect(result.current.events[0]).toMatchObject({
      id: second.id,
      sourceSessionId: second.sourceSessionId,
      messageText: 'Testing the regional map',
    });
  });

  it('stops the previous feed before an invalid new URL can fail, and ignores old updates during the switch', async () => {
    let finishDisconnect!: () => void;
    const disconnected = new Promise<void>((resolve) => {
      finishDisconnect = resolve;
    });
    vi.mocked(api.disconnect).mockReturnValueOnce(disconnected);
    vi.mocked(api.connect).mockResolvedValue({ ok: false, error: 'Invalid Beacon URL' });
    const { result } = renderHook(() => useBeaconTraffic(true));
    await settleEffects();
    emit(snapshot());
    emit({ type: 'packet', packet: packet() });
    flush();
    let connected!: Promise<boolean>;
    act(() => {
      connected = result.current.connect('invalid-url');
    });
    expect(api.disconnect).toHaveBeenCalledTimes(1);
    expect(api.connect).not.toHaveBeenCalled();
    emit({ type: 'packet', packet: packet('old-feed-packet') });
    emit({ type: 'status', status: 'live' });
    flush();
    expect(result.current.events).toEqual([]);
    expect(result.current.status).toBe('connecting');
    await act(async () => {
      finishDisconnect();
      expect(await connected).toBe(false);
    });
    expect(api.connect).toHaveBeenCalledWith({
      baseUrl: 'invalid-url',
      region: undefined,
      provider: 'beacon',
    });
    emit({ type: 'packet', packet: packet('another-old-feed-packet') });
    emit({ type: 'status', status: 'live' });
    flush();
    expect(result.current).toMatchObject({
      status: 'error',
      error: 'Invalid Beacon URL',
      events: [],
      points: [],
      regions: [],
    });
  });

  it('cancels an attempt disabled before its previous-feed disconnect finishes', async () => {
    let finishDisconnect!: () => void;
    const disconnected = new Promise<void>((resolve) => {
      finishDisconnect = resolve;
    });
    vi.mocked(api.disconnect).mockReturnValueOnce(disconnected);
    const { result, rerender } = renderHook(({ enabled }) => useBeaconTraffic(enabled), {
      initialProps: { enabled: true },
    });
    let connected!: Promise<boolean>;
    act(() => {
      connected = result.current.connect(COLORADO_BEACON_URL);
    });
    rerender({ enabled: false });
    await act(async () => {
      finishDisconnect();
      expect(await connected).toBe(false);
    });
    expect(api.connect).not.toHaveBeenCalled();
  });

  it('joins message contents received before an observation only to the exact packet hash', async () => {
    const { result } = renderHook(() => useBeaconTraffic(true));
    await settleEffects();
    emit({ type: 'message', message: message() });
    emit({ type: 'packet', packet: packet() });
    emit({ type: 'packet', packet: packet('other-hash') });
    flush();
    expect(result.current.events[0]).toMatchObject({
      messageText: 'Testing the regional map',
      senderLabel: 'Example sender',
      contentStatus: 'decoded',
    });
    expect(result.current.events[1].messageText).toBeUndefined();
    expect(result.current.events[1].contentStatus).toBe('unavailable');
  });

  it('enriches an already visible observation without changing its ID or replaying its timestamp', async () => {
    const { result } = renderHook(() => useBeaconTraffic(true));
    await settleEffects();
    emit({ type: 'packet', packet: packet() });
    flush();
    const original = result.current.events[0];
    expect(original.messageText).toBeUndefined();
    emit({ type: 'message', message: message() });
    flush();
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toMatchObject({
      id: original.id,
      ts: original.ts,
      messageText: 'Testing the regional map',
      contentStatus: 'decoded',
    });
  });

  it('limits retained observations and message bodies to the latest 200', async () => {
    const { result } = renderHook(() => useBeaconTraffic(true));
    await settleEffects();
    for (let i = 0; i < 201; i++)
      emit({ type: 'message', message: message(`hash-${i}`, `message-${i}`) });
    emit({ type: 'packet', packet: packet('hash-0') });
    emit({ type: 'packet', packet: packet('hash-1') });
    emit({ type: 'packet', packet: packet('hash-200') });
    flush();
    expect(result.current.events.map((event) => event.messageText)).toEqual([
      undefined,
      'message-1',
      'message-200',
    ]);
    for (let i = 0; i < 250; i++) emit({ type: 'packet', packet: packet(`capture-${i}`) });
    flush();
    expect(result.current.events).toHaveLength(200);
    expect(result.current.events[0].packetHash).toBe('capture-50');
    expect(result.current.events.at(-1)?.packetHash).toBe('capture-249');
  });

  it('applies snapshot node positions, valid regions, and recent message bodies', async () => {
    const { result } = renderHook(() => useBeaconTraffic(true));
    await settleEffects();
    emit({
      type: 'snapshot',
      nodes: [{ id: 'node-uuid', name: 'Observer', publicKey: OBSERVER_KEY, lat: 39.7, lng: -105 }],
      observers: [],
      regions: [
        { slug: 'front-range', name: 'Front Range' },
        { slug: 3, name: 'Invalid' },
      ],
      messages: [message()],
    });
    emit({ type: 'packet', packet: packet() });
    flush();
    expect(result.current.points).toHaveLength(1);
    expect(result.current.regions).toEqual([{ slug: 'front-range', name: 'Front Range' }]);
    expect(result.current.events[0]).toMatchObject({ messageText: 'Testing the regional map' });
    expect(result.current.events[0].segments).toHaveLength(1);
  });

  it('publishes packet bursts no more than four times per second', async () => {
    const { result } = renderHook(() => useBeaconTraffic(true));
    await settleEffects();
    for (let batch = 0; batch < 4; batch++) {
      const previous = result.current.events;
      for (let i = 0; i < 10; i++) emit({ type: 'packet', packet: packet(`burst-${batch}-${i}`) });
      expect(result.current.events).toBe(previous);
      flush(249);
      expect(result.current.events).toBe(previous);
      flush(1);
      expect(result.current.events).toHaveLength((batch + 1) * 10);
    }
  });

  it.each(['beacon', 'corescope'] as const)(
    'keeps the %s session across map navigation without reconnecting or publishing while away',
    async (provider) => {
      const { result, rerender } = renderHook(
        ({ visible }) => useBeaconTraffic(true, provider, visible),
        { initialProps: { visible: true } },
      );
      await settleEffects();
      await act(async () => {
        await result.current.connect('https://regional.example', 'selected-region');
      });
      emit({ type: 'status', provider, status: 'live' });
      emit(provider === 'corescope' ? coreScopeSnapshot() : snapshot());
      emit({
        type: 'packet',
        provider,
        packet: provider === 'corescope' ? coreScopePacket() : packet(),
      });
      flush();
      const previous = result.current.events;
      const disconnectCount = vi.mocked(api.disconnect).mock.calls.length;
      rerender({ visible: false });
      expect(vi.getTimerCount()).toBe(0);
      for (let index = 0; index < 220; index++) {
        emit({
          type: 'packet',
          provider,
          packet:
            provider === 'corescope' ? coreScopePacket(`away-${index}`) : packet(`away-${index}`),
        });
      }
      flush(1_000);
      expect(result.current.events).toBe(previous);
      expect(api.disconnect).toHaveBeenCalledTimes(disconnectCount);
      rerender({ visible: true });
      expect(result.current.status).toBe('live');
      expect(result.current.events).toHaveLength(200);
      expect(result.current.events.at(-1)?.packetHash).toBe('away-219');
      expect(api.onUpdate).toHaveBeenCalledTimes(1);
      expect(api.connect).toHaveBeenCalledTimes(1);
      expect(api.disconnect).toHaveBeenCalledTimes(disconnectCount);
      await act(async () => {
        await result.current.disconnect();
      });
      rerender({ visible: false });
      rerender({ visible: true });
      expect(result.current.status).toBe('disconnected');
      emit({
        type: 'packet',
        provider,
        packet: provider === 'corescope' ? coreScopePacket('after-stop') : packet('after-stop'),
      });
      flush();
      expect(result.current.events.some((event) => event.packetHash === 'after-stop')).toBe(false);
      expect(api.connect).toHaveBeenCalledTimes(1);
    },
  );

  it('lets an explicit pending connection finish while the map is inactive', async () => {
    const deferred = deferredConnect();
    vi.mocked(api.connect).mockReturnValue(deferred.promise);
    const { result, rerender } = renderHook(
      ({ visible }) => useBeaconTraffic(true, 'beacon', visible),
      {
        initialProps: { visible: true },
      },
    );
    let connection!: Promise<boolean>;
    act(() => {
      connection = result.current.connect(COLORADO_BEACON_URL, 'front-range');
    });
    await settleEffects();
    rerender({ visible: false });
    await act(async () => {
      deferred.resolve({ ok: true });
      expect(await connection).toBe(true);
    });
    emit({ type: 'status', status: 'live' });
    rerender({ visible: true });
    expect(result.current.status).toBe('live');
    expect(api.connect).toHaveBeenCalledTimes(1);
    expect(api.disconnect).toHaveBeenCalledTimes(1);
    expect(api.onUpdate).toHaveBeenCalledTimes(1);
  });

  it('expires observations retained while another panel was open before publishing on return', async () => {
    const { result, rerender } = renderHook(
      ({ visible }) => useBeaconTraffic(true, 'beacon', visible),
      {
        initialProps: { visible: true },
      },
    );
    await settleEffects();
    emit({ type: 'packet', packet: packet() });
    flush();
    rerender({ visible: false });
    flush(60_001);
    rerender({ visible: true });
    expect(result.current.events).toEqual([]);
    expect(api.disconnect).not.toHaveBeenCalled();
  });

  it('retains an observation sender when a later decoded message has no sender name', async () => {
    const { result } = renderHook(() => useBeaconTraffic(true));
    await settleEffects();
    emit(snapshot());
    emit({ type: 'packet', packet: packet() });
    flush();
    const sender = result.current.events[0].senderLabel;
    expect(sender).toBeTruthy();
    emit({ type: 'message', message: { packetHash: 'packet-1', content: 'Name omitted' } });
    flush();
    expect(result.current.events[0]).toMatchObject({
      senderLabel: sender,
      messageText: 'Name omitted',
    });
  });

  it('does not flush packet state while hidden, then publishes the retained batch when visible', async () => {
    const { result } = renderHook(() => useBeaconTraffic(true));
    await settleEffects();
    hidden = true;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    emit({ type: 'packet', packet: packet() });
    flush(1_000);
    expect(result.current.events).toEqual([]);
    hidden = false;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    flush();
    expect(result.current.events).toHaveLength(1);
  });

  it('drops observations that expire while hidden instead of replaying them on return', async () => {
    const { result } = renderHook(() => useBeaconTraffic(true));
    await settleEffects();
    hidden = true;
    emit({ type: 'packet', packet: packet() });
    flush(60_001);
    hidden = false;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    flush();
    expect(result.current.events).toEqual([]);
  });

  it('expires visible observations even when no new packets arrive', async () => {
    const { result } = renderHook(() => useBeaconTraffic(true));
    await settleEffects();
    emit({ type: 'packet', packet: packet() });
    flush();
    expect(result.current.events).toHaveLength(1);
    flush(60_000);
    expect(result.current.events).toEqual([]);
  });

  it('clears published and pending observations when a replacement snapshot arrives', async () => {
    const { result } = renderHook(() => useBeaconTraffic(true));
    await settleEffects();
    emit(snapshot());
    emit({ type: 'packet', packet: packet() });
    flush();
    expect(result.current.events).toHaveLength(1);
    emit({ type: 'packet', packet: packet('pending-packet') });
    emit({ type: 'snapshot', nodes: [], observers: [], regions: [] });
    flush();
    expect(result.current.events).toEqual([]);
    expect(result.current.points).toEqual([]);
    expect(result.current.regions).toEqual([]);
  });

  it('disconnects and unsubscribes on teardown, canceling pending flushes', async () => {
    const { result, unmount } = renderHook(() => useBeaconTraffic(true));
    await settleEffects();
    emit({ type: 'packet', packet: packet() });
    const previous = result.current.events;
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(api.disconnect).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    flush(1_000);
    expect(result.current.events).toBe(previous);
  });

  it('re-enables as a fresh disconnected feed without old observations or cached message contents', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useBeaconTraffic(enabled), {
      initialProps: { enabled: true },
    });
    await settleEffects();
    emit(snapshot());
    emit({ type: 'status', status: 'live' });
    emit({ type: 'message', message: message() });
    emit({ type: 'packet', packet: packet() });
    flush();
    expect(result.current.events).toHaveLength(1);
    rerender({ enabled: false });
    rerender({ enabled: true });
    await settleEffects();
    expect(result.current.status).toBe('disconnected');
    expect(result.current.events).toEqual([]);
    expect(result.current.points).toEqual([]);
    expect(result.current.regions).toEqual([]);
    expect(api.connect).not.toHaveBeenCalled();
    emit({ type: 'packet', packet: packet() });
    flush();
    expect(result.current.events[0].messageText).toBeUndefined();
    expect(result.current.events[0].segments).toEqual([]);
  });
});

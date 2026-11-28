import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bytesToHex, hexToBytesExactOrThrow } from '@/shared/hexBytes';
import type {
  ReachCheckApi,
  ReachCheckResult,
  ReachCheckServerInfo,
  ReachCheckSession,
} from '@/shared/reachCheck';

import type { MeshcoreChatChannelSource } from '../lib/meshcoreConfiguredChatChannels';
import { meshcoreDeriveChannelKeyHexFromName } from '../lib/meshcoreUtils';
import { useReachCheckStore } from '../lib/reachCheck/reachCheckStore';
import type { IdentityId } from '../lib/types';
import {
  REACH_CHECK_CHANNEL_WAIT_MS,
  useReachCheck,
  type UseReachCheckDeps,
} from './useReachCheck';

const ID = 'meshcore:aa' as IdentityId;
const ORIGIN = 'https://rangecheck.example.org';
const PUBLIC: MeshcoreChatChannelSource = {
  index: 0,
  name: 'Public',
  secret: new Uint8Array(16).fill(0x8b),
};

function info(overrides: Partial<ReachCheckServerInfo> = {}): ReachCheckServerInfo {
  return {
    origin: ORIGIN,
    channelName: 'cm-reach',
    channelHash: 'd6',
    turnstileRequired: false,
    version: '1.3.8',
    ...overrides,
  };
}

function session(): ReachCheckSession {
  return {
    id: 'sess-1',
    code: 'MHC-1A2B3C',
    status: 'waiting',
    expiresAt: Date.now() + 600_000,
    observedCount: 0,
    expectedCount: 10,
    repeaterCount: 0,
    distanceText: '',
    sharePath: '/share/sess-1',
  };
}

async function hashtagSource(index: number, name: string): Promise<MeshcoreChatChannelSource> {
  return {
    index,
    name,
    secret: hexToBytesExactOrThrow(await meshcoreDeriveChannelKeyHexFromName(name), 16),
  };
}

function makeDeps(overrides: Partial<UseReachCheckDeps> = {}): UseReachCheckDeps {
  const api: ReachCheckApi = {
    bootstrap: vi.fn<ReachCheckApi['bootstrap']>(() =>
      Promise.resolve({ ok: true, value: info() }),
    ),
    createSession: vi.fn<ReachCheckApi['createSession']>(() =>
      Promise.resolve({ ok: true, value: session() }),
    ),
    getSession: vi.fn<ReachCheckApi['getSession']>(() =>
      Promise.resolve({ ok: false, error: 'network' }),
    ),
  };
  return {
    identityId: ID,
    active: true,
    channels: [PUBLIC],
    channelIndexes: [0],
    setChannel: vi.fn(() => Promise.resolve()),
    selectChannel: vi.fn(),
    sendOnChannel: vi.fn(() => Promise.resolve('out:1700000000000:abc')),
    api,
    getServerOrigin: () => ORIGIN,
    saveServerOrigin: vi.fn(),
    startPolling: vi.fn(),
    ...overrides,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  useReachCheckStore.setState({ entries: {} });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useReachCheck', () => {
  it('asks for a server first, then runs with the saved origin', async () => {
    let saved = '';
    const deps = makeDeps({
      getServerOrigin: () => saved,
      saveServerOrigin: vi.fn((origin: string) => {
        saved = origin;
      }),
      channels: [PUBLIC, await hashtagSource(1, '#cm-reach')],
      channelIndexes: [0, 1],
    });
    const { result } = renderHook(() => useReachCheck(deps));
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.dialog).toEqual({ kind: 'setup' });
    });
    act(() => {
      result.current.answer({ kind: 'save-server', url: 'http://rangecheck.example.org' });
    });
    await waitFor(() => {
      expect(result.current.dialog).toEqual({ kind: 'setup', error: 'invalid_url' });
    });
    expect(deps.saveServerOrigin).not.toHaveBeenCalled();
    act(() => {
      result.current.answer({ kind: 'save-server', url: `${ORIGIN}/app` });
    });
    await waitFor(() => {
      expect(deps.sendOnChannel).toHaveBeenCalledWith('MHC-1A2B3C', 1);
    });
    expect(deps.saveServerOrigin).toHaveBeenCalledWith(ORIGIN);
    expect(deps.api.bootstrap).toHaveBeenCalledWith(ORIGIN);
  });

  it('runs straight through when the channel is already on the radio', async () => {
    const deps = makeDeps({
      channels: [PUBLIC, await hashtagSource(3, '#cm-reach')],
      channelIndexes: [0, 3],
    });
    const { result } = renderHook(() => useReachCheck(deps));
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.busy).toBe(false);
    });
    expect(result.current.dialog).toBeNull();
    expect(deps.setChannel).not.toHaveBeenCalled();
    expect(deps.selectChannel).toHaveBeenCalledWith(3);
    expect(deps.sendOnChannel).toHaveBeenCalledWith('MHC-1A2B3C', 3);
    expect(useReachCheckStore.getState().entryFor(ID, 'out:1700000000000:abc')).toMatchObject({
      origin: ORIGIN,
      sessionId: 'sess-1',
      code: 'MHC-1A2B3C',
      state: 'polling',
    });
    expect(deps.startPolling).toHaveBeenCalledWith('sess-1');
  });

  it('adds a missing hashtag channel after confirmation, in order, and waits for it', async () => {
    const calls: string[] = [];
    const deps = makeDeps();
    vi.mocked(deps.api.bootstrap).mockImplementation(() => {
      calls.push('bootstrap');
      return Promise.resolve({ ok: true, value: info() });
    });
    vi.mocked(deps.setChannel).mockImplementation(() => {
      calls.push('setChannel');
      return Promise.resolve();
    });
    vi.mocked(deps.api.createSession).mockImplementation(() => {
      calls.push('createSession');
      return Promise.resolve({ ok: true, value: session() });
    });
    vi.mocked(deps.sendOnChannel).mockImplementation(() => {
      calls.push('send');
      return Promise.resolve('out:2');
    });
    const { result, rerender } = renderHook((props: UseReachCheckDeps) => useReachCheck(props), {
      initialProps: deps,
    });
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.dialog).toEqual({ kind: 'confirm-add', name: '#cm-reach', index: 1 });
    });
    act(() => {
      result.current.answer({ kind: 'confirm' });
    });
    await waitFor(() => {
      expect(deps.setChannel).toHaveBeenCalledTimes(1);
    });
    const [index, name, secret] = vi.mocked(deps.setChannel).mock.calls[0];
    expect([index, name]).toEqual([1, '#cm-reach']);
    expect(bytesToHex(secret)).toBe(await meshcoreDeriveChannelKeyHexFromName('#cm-reach'));
    expect(deps.selectChannel).not.toHaveBeenCalled();
    // The runtime lists the saved channel, key included, in the same update that shows it in Chat.
    rerender({
      ...deps,
      channels: [PUBLIC, await hashtagSource(1, '#cm-reach')],
      channelIndexes: [0, 1],
    });
    await waitFor(() => {
      expect(deps.sendOnChannel).toHaveBeenCalledWith('MHC-1A2B3C', 1);
    });
    expect(deps.selectChannel).toHaveBeenCalledWith(1);
    expect(calls).toEqual(['bootstrap', 'setChannel', 'createSession', 'send']);
  });

  it('adds nothing when the add is cancelled', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useReachCheck(deps));
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.dialog?.kind).toBe('confirm-add');
    });
    act(() => {
      result.current.answer({ kind: 'cancel' });
    });
    await waitFor(() => {
      expect(result.current.busy).toBe(false);
    });
    expect(result.current.dialog).toBeNull();
    expect(deps.setChannel).not.toHaveBeenCalled();
    expect(deps.api.createSession).not.toHaveBeenCalled();
  });

  it('asks for the key of a private-key channel and checks it against the hash', async () => {
    const goodKey = await meshcoreDeriveChannelKeyHexFromName('#cm-reach');
    const deps = makeDeps();
    vi.mocked(deps.api.bootstrap).mockResolvedValue({
      ok: true,
      value: info({ channelName: 'ukmeshtest', channelHash: 'd6' }),
    });
    const { result, rerender } = renderHook((props: UseReachCheckDeps) => useReachCheck(props), {
      initialProps: deps,
    });
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.dialog).toEqual({ kind: 'paste-key', name: 'ukmeshtest' });
    });
    act(() => {
      result.current.answer({ kind: 'paste-key', hex: '11'.repeat(16) });
    });
    await waitFor(() => {
      expect(result.current.dialog).toEqual({
        kind: 'paste-key',
        name: 'ukmeshtest',
        error: 'hash',
      });
    });
    act(() => {
      result.current.answer({ kind: 'paste-key', hex: goodKey });
    });
    await waitFor(() => {
      expect(deps.setChannel).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(deps.setChannel).mock.calls[0].slice(0, 2)).toEqual([1, 'ukmeshtest']);
    rerender({
      ...deps,
      channels: [
        PUBLIC,
        { index: 1, name: 'ukmeshtest', secret: hexToBytesExactOrThrow(goodKey, 16) },
      ],
      channelIndexes: [0, 1],
    });
    await waitFor(() => {
      expect(deps.sendOnChannel).toHaveBeenCalledWith('MHC-1A2B3C', 1);
    });
  });

  it('prepares the channel and offers the website on a server with a browser check', async () => {
    const deps = makeDeps({
      channels: [PUBLIC, await hashtagSource(2, '#cm-reach')],
      channelIndexes: [0, 2],
    });
    vi.mocked(deps.api.bootstrap).mockResolvedValue({
      ok: true,
      value: info({ turnstileRequired: true }),
    });
    const { result } = renderHook(() => useReachCheck(deps));
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.dialog).toEqual({
        kind: 'turnstile',
        origin: ORIGIN,
        host: 'rangecheck.example.org',
      });
    });
    expect(deps.selectChannel).toHaveBeenCalledWith(2);
    expect(deps.api.createSession).not.toHaveBeenCalled();
    expect(deps.sendOnChannel).not.toHaveBeenCalled();
  });

  it.each([
    ['key-mismatch', [PUBLIC, { index: 4, name: '#cm-reach', secret: new Uint8Array(16).fill(7) }]],
    [
      'slots-full',
      Array.from({ length: 40 }, (_, i) => ({
        index: i,
        name: `ch${i}`,
        secret: new Uint8Array(16).fill(i + 1),
      })),
    ],
  ])('stops with %s without adding or sending', async (error, channels) => {
    const deps = makeDeps({ channels, channelIndexes: channels.map((c) => c.index) });
    const { result } = renderHook(() => useReachCheck(deps));
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.dialog).toMatchObject({ kind: 'error', error });
    });
    expect(deps.setChannel).not.toHaveBeenCalled();
    expect(deps.api.createSession).not.toHaveBeenCalled();
    expect(deps.sendOnChannel).not.toHaveBeenCalled();
  });

  it('shows the wait time when the server is rate limiting', async () => {
    const deps = makeDeps({
      channels: [PUBLIC, await hashtagSource(1, '#cm-reach')],
      channelIndexes: [0, 1],
    });
    const limited: ReachCheckResult<ReachCheckSession> = {
      ok: false,
      error: 'rate_limited',
      retryAfterSeconds: 120,
    };
    vi.mocked(deps.api.createSession).mockResolvedValue(limited);
    const { result } = renderHook(() => useReachCheck(deps));
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.dialog).toEqual({
        kind: 'error',
        error: 'rate_limited',
        retryAfterSeconds: 120,
      });
    });
    expect(deps.sendOnChannel).not.toHaveBeenCalled();
  });

  it('reports a server error from the first request', async () => {
    const deps = makeDeps();
    vi.mocked(deps.api.bootstrap).mockResolvedValue({ ok: false, error: 'network' });
    const { result } = renderHook(() => useReachCheck(deps));
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.dialog).toEqual({ kind: 'error', error: 'network' });
    });
    act(() => {
      result.current.answer({ kind: 'cancel' });
    });
    expect(result.current.dialog).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it.each([
    ['returns no id', () => Promise.resolve(undefined)],
    ['rejects', () => Promise.reject(new Error('radio gone'))],
  ])('leaves no results line when the send %s', async (_label, send) => {
    const deps = makeDeps({
      channels: [PUBLIC, await hashtagSource(1, '#cm-reach')],
      channelIndexes: [0, 1],
      sendOnChannel: vi.fn(send),
    });
    const { result } = renderHook(() => useReachCheck(deps));
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.dialog).toEqual({ kind: 'error', error: 'send-failed' });
    });
    expect(result.current.busy).toBe(false);
    expect(Object.keys(useReachCheckStore.getState().entries)).toEqual([]);
    expect(deps.startPolling).not.toHaveBeenCalled();
  });

  it('ignores a second click while a check is starting', async () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useReachCheck(deps));
    act(() => {
      result.current.run();
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.dialog?.kind).toBe('confirm-add');
    });
    expect(result.current.busy).toBe(true);
    expect(deps.api.bootstrap).toHaveBeenCalledTimes(1);
  });

  it('gives up when the added channel never appears', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const deps = makeDeps();
    const { result } = renderHook(() => useReachCheck(deps));
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.dialog?.kind).toBe('confirm-add');
    });
    act(() => {
      result.current.answer({ kind: 'confirm' });
    });
    await waitFor(() => {
      expect(deps.setChannel).toHaveBeenCalled();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REACH_CHECK_CHANNEL_WAIT_MS + 50);
    });
    await waitFor(() => {
      expect(result.current.dialog).toEqual({ kind: 'error', error: 'channel-timeout' });
    });
    expect(deps.api.createSession).not.toHaveBeenCalled();
  });

  it('reports a failed channel add', async () => {
    const deps = makeDeps({ setChannel: vi.fn(() => Promise.reject(new Error('timeout'))) });
    const { result } = renderHook(() => useReachCheck(deps));
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.dialog?.kind).toBe('confirm-add');
    });
    act(() => {
      result.current.answer({ kind: 'confirm' });
    });
    await waitFor(() => {
      expect(result.current.dialog).toEqual({
        kind: 'error',
        error: 'add-failed',
        name: '#cm-reach',
      });
    });
  });
});

describe('useReachCheck when the panel or the radio changes mid-flow', () => {
  it('ends quietly, with no dialog, when the panel is left while the server answers', async () => {
    const boot = deferred<ReachCheckResult<ReachCheckServerInfo>>();
    const deps = makeDeps({
      channels: [PUBLIC, await hashtagSource(1, '#cm-reach')],
      channelIndexes: [0, 1],
    });
    vi.mocked(deps.api.bootstrap).mockReturnValue(boot.promise);
    const { result, rerender } = renderHook((props: UseReachCheckDeps) => useReachCheck(props), {
      initialProps: deps,
    });
    act(() => {
      result.current.run();
    });
    rerender({ ...deps, active: false });
    await act(async () => {
      boot.resolve({ ok: false, error: 'network' });
      await boot.promise;
    });
    await waitFor(() => {
      expect(result.current.busy).toBe(false);
    });
    expect(result.current.dialog).toBeNull();
    expect(deps.api.createSession).not.toHaveBeenCalled();
  });

  it('sends nothing when the panel is left during the session request', async () => {
    const created = deferred<ReachCheckResult<ReachCheckSession>>();
    const deps = makeDeps({
      channels: [PUBLIC, await hashtagSource(1, '#cm-reach')],
      channelIndexes: [0, 1],
    });
    vi.mocked(deps.api.createSession).mockReturnValue(created.promise);
    const { result, rerender } = renderHook((props: UseReachCheckDeps) => useReachCheck(props), {
      initialProps: deps,
    });
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(deps.api.createSession).toHaveBeenCalled();
    });
    rerender({ ...deps, active: false });
    await act(async () => {
      created.resolve({ ok: true, value: session() });
      await created.promise;
    });
    await waitFor(() => {
      expect(result.current.busy).toBe(false);
    });
    expect(deps.sendOnChannel).not.toHaveBeenCalled();
    expect(result.current.dialog).toBeNull();
    expect(Object.keys(useReachCheckStore.getState().entries)).toEqual([]);
  });

  it('shows no rate-limit message in a panel that was left during the session request', async () => {
    const created = deferred<ReachCheckResult<ReachCheckSession>>();
    const deps = makeDeps({
      channels: [PUBLIC, await hashtagSource(1, '#cm-reach')],
      channelIndexes: [0, 1],
    });
    vi.mocked(deps.api.createSession).mockReturnValue(created.promise);
    const { result, rerender } = renderHook((props: UseReachCheckDeps) => useReachCheck(props), {
      initialProps: deps,
    });
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(deps.api.createSession).toHaveBeenCalled();
    });
    rerender({ ...deps, active: false });
    await act(async () => {
      created.resolve({ ok: false, error: 'rate_limited', retryAfterSeconds: 60 });
      await created.promise;
    });
    await waitFor(() => {
      expect(result.current.busy).toBe(false);
    });
    expect(result.current.dialog).toBeNull();
  });

  it('creates no session when the panel is left while the added channel is awaited', async () => {
    const deps = makeDeps();
    const { result, rerender } = renderHook((props: UseReachCheckDeps) => useReachCheck(props), {
      initialProps: deps,
    });
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.dialog?.kind).toBe('confirm-add');
    });
    act(() => {
      result.current.answer({ kind: 'confirm' });
    });
    await waitFor(() => {
      expect(deps.setChannel).toHaveBeenCalled();
    });
    rerender({ ...deps, active: false });
    rerender({
      ...deps,
      active: false,
      channels: [PUBLIC, await hashtagSource(1, '#cm-reach')],
      channelIndexes: [0, 1],
    });
    await waitFor(() => {
      expect(result.current.busy).toBe(false);
    });
    expect(deps.api.createSession).not.toHaveBeenCalled();
    expect(deps.selectChannel).not.toHaveBeenCalled();
    expect(result.current.dialog).toBeNull();
  });

  it('shows no failed-add message in a panel that was left during the add', async () => {
    const save = deferred<undefined>();
    const deps = makeDeps({
      setChannel: vi.fn(() => save.promise.then(() => Promise.reject(new Error('timeout')))),
    });
    const { result, rerender } = renderHook((props: UseReachCheckDeps) => useReachCheck(props), {
      initialProps: deps,
    });
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.dialog?.kind).toBe('confirm-add');
    });
    act(() => {
      result.current.answer({ kind: 'confirm' });
    });
    await waitFor(() => {
      expect(deps.setChannel).toHaveBeenCalled();
    });
    rerender({ ...deps, active: false });
    await act(async () => {
      save.resolve(undefined);
      await save.promise;
    });
    await waitFor(() => {
      expect(result.current.busy).toBe(false);
    });
    expect(result.current.dialog).toBeNull();
  });

  it('closes an open step without adding anything when the panel is left', async () => {
    const deps = makeDeps();
    const { result, rerender } = renderHook((props: UseReachCheckDeps) => useReachCheck(props), {
      initialProps: deps,
    });
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.dialog?.kind).toBe('confirm-add');
    });
    rerender({ ...deps, active: false });
    await waitFor(() => {
      expect(result.current.dialog).toBeNull();
    });
    expect(result.current.busy).toBe(false);
    expect(deps.setChannel).not.toHaveBeenCalled();
  });

  it('closes a final message when the panel is left', async () => {
    const deps = makeDeps();
    vi.mocked(deps.api.bootstrap).mockResolvedValue({ ok: false, error: 'network' });
    const { result, rerender } = renderHook((props: UseReachCheckDeps) => useReachCheck(props), {
      initialProps: deps,
    });
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.dialog?.kind).toBe('error');
    });
    rerender({ ...deps, active: false });
    await waitFor(() => {
      expect(result.current.dialog).toBeNull();
    });
  });

  it('refuses to write a slot the radio filled while the add was being confirmed', async () => {
    const deps = makeDeps();
    const { result, rerender } = renderHook((props: UseReachCheckDeps) => useReachCheck(props), {
      initialProps: deps,
    });
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.dialog).toEqual({ kind: 'confirm-add', name: '#cm-reach', index: 1 });
    });
    rerender({
      ...deps,
      channels: [PUBLIC, { index: 1, name: 'Ops', secret: new Uint8Array(16).fill(9) }],
      channelIndexes: [0, 1],
    });
    act(() => {
      result.current.answer({ kind: 'confirm' });
    });
    await waitFor(() => {
      expect(result.current.dialog).toEqual({ kind: 'error', error: 'changed' });
    });
    expect(deps.setChannel).not.toHaveBeenCalled();
    expect(deps.api.createSession).not.toHaveBeenCalled();
  });

  it('refuses to send when the test channel changed during the session request', async () => {
    const created = deferred<ReachCheckResult<ReachCheckSession>>();
    const deps = makeDeps({
      channels: [PUBLIC, await hashtagSource(1, '#cm-reach')],
      channelIndexes: [0, 1],
    });
    vi.mocked(deps.api.createSession).mockReturnValue(created.promise);
    const { result, rerender } = renderHook((props: UseReachCheckDeps) => useReachCheck(props), {
      initialProps: deps,
    });
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(deps.api.createSession).toHaveBeenCalled();
    });
    rerender({
      ...deps,
      channels: [PUBLIC, { index: 1, name: '#cm-reach', secret: new Uint8Array(16).fill(7) }],
    });
    await act(async () => {
      created.resolve({ ok: true, value: session() });
      await created.promise;
    });
    await waitFor(() => {
      expect(result.current.dialog).toEqual({ kind: 'error', error: 'changed' });
    });
    expect(deps.sendOnChannel).not.toHaveBeenCalled();
  });

  it('refuses to send when another radio connected during the session request', async () => {
    const created = deferred<ReachCheckResult<ReachCheckSession>>();
    const deps = makeDeps({
      channels: [PUBLIC, await hashtagSource(1, '#cm-reach')],
      channelIndexes: [0, 1],
    });
    vi.mocked(deps.api.createSession).mockReturnValue(created.promise);
    const { result, rerender } = renderHook((props: UseReachCheckDeps) => useReachCheck(props), {
      initialProps: deps,
    });
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(deps.api.createSession).toHaveBeenCalled();
    });
    rerender({ ...deps, identityId: 'meshcore:bb' });
    await act(async () => {
      created.resolve({ ok: true, value: session() });
      await created.promise;
    });
    await waitFor(() => {
      expect(result.current.dialog).toEqual({ kind: 'error', error: 'changed' });
    });
    expect(deps.sendOnChannel).not.toHaveBeenCalled();
    expect(Object.keys(useReachCheckStore.getState().entries)).toEqual([]);
  });

  it('sends nothing after the panel unmounts', async () => {
    const created = deferred<ReachCheckResult<ReachCheckSession>>();
    const deps = makeDeps({
      channels: [PUBLIC, await hashtagSource(1, '#cm-reach')],
      channelIndexes: [0, 1],
    });
    vi.mocked(deps.api.createSession).mockReturnValue(created.promise);
    const { result, unmount } = renderHook(() => useReachCheck(deps));
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(deps.api.createSession).toHaveBeenCalled();
    });
    unmount();
    await act(async () => {
      created.resolve({ ok: true, value: session() });
      await created.promise;
    });
    expect(deps.sendOnChannel).not.toHaveBeenCalled();
    expect(Object.keys(useReachCheckStore.getState().entries)).toEqual([]);
  });
});

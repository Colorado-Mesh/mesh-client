// @vitest-environment jsdom
/**
 * Runtime catch-up after WS lag / reconnect / stack restart:
 * useReticulumRuntime → fetchRecentInboundLxmfDetailed → ingest (dedupe by message hash).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ingestReticulumLxmfPayload } from '@/renderer/lib/ingest/reticulumIngest';
import { OFFLINE_RETICULUM_IDENTITY_ID } from '@/renderer/lib/offlineProtocolIdentities';
import { catchUpRecentInboundLxmf } from '@/renderer/lib/reticulum/catchUpRecentInboundLxmf';
import { fetchRecentInboundLxmfDetailed } from '@/renderer/lib/reticulum/fetchRecentInboundLxmf';
import {
  getReticulumInboundLxmfDiagnostics,
  resetReticulumInboundLxmfDiagnosticsForTests,
} from '@/renderer/lib/reticulum/reticulumInboundLxmfDiagnostics';
import { resetReticulumManualStackStopSuppressForTests } from '@/renderer/lib/reticulum/reticulumManualStackStopSuppress';
import { useReticulumRuntime } from '@/renderer/runtime/useReticulumRuntime';
import {
  addMessage,
  mergeMessageRecordsFromDbForIdentity,
  type MessageRecord,
  useMessageStore,
} from '@/renderer/stores/messageStore';
import type { ReticulumSidecarEvent } from '@/shared/reticulum-types';

vi.mock('@/renderer/lib/reticulum/fetchRecentInboundLxmf', () => ({
  fetchRecentInboundLxmf: vi.fn(),
  fetchRecentInboundLxmfDetailed: vi.fn(),
}));

vi.mock('@/renderer/lib/reticulum/useReticulumNobleBleYieldWatcher', () => ({
  useReticulumNobleBleYieldWatcher: () => {},
}));

vi.mock('@/renderer/lib/reticulum/useReticulumPropagationAutoSync', () => ({
  useReticulumPropagationAutoSync: () => {},
}));

function sampleInbound(hash: string, text: string, timestamp = 1_000, ringSeq?: number) {
  return {
    sender_hash: 'e16af7d675a0ae7f3067185800a46678',
    sender_name: 'Runr02',
    text,
    timestamp,
    direction: 'inbound' as const,
    message_hash: hash,
    received_via: 'tcp',
    ...(ringSeq != null ? { ring_seq: ringSeq } : {}),
  };
}

describe('useReticulumRuntime inbound LXMF catch-up', () => {
  const identityId = OFFLINE_RETICULUM_IDENTITY_ID;
  let eventHandler: ((evt: ReticulumSidecarEvent) => void) | null = null;
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    resetReticulumManualStackStopSuppressForTests();
    resetReticulumInboundLxmfDiagnosticsForTests();
    eventHandler = null;
    warnSpy.mockClear();
    vi.mocked(fetchRecentInboundLxmfDetailed).mockReset();
    vi.mocked(fetchRecentInboundLxmfDetailed).mockResolvedValue({ messages: [], ringLen: 0 });
    vi.mocked(window.electronAPI.reticulum.onEvent).mockImplementation((cb) => {
      eventHandler = cb;
      return () => {
        if (eventHandler === cb) eventHandler = null;
      };
    });
    vi.mocked(window.electronAPI.reticulum.start).mockResolvedValue({
      running: true,
      port: 19437,
      pid: 1,
    });
    vi.mocked(window.electronAPI.reticulum.stop).mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.reticulum.getStatus).mockResolvedValue({
      running: true,
      port: 19437,
      pid: 1,
      healthy: true,
    });
  });

  afterEach(() => {
    vi.mocked(window.electronAPI.reticulum.onEvent).mockReset();
    vi.mocked(window.electronAPI.reticulum.onEvent).mockReturnValue(() => {});
  });

  it('connect catch-up ingests buffered inbound that never arrived live', async () => {
    const hash = 'ab'.repeat(32);
    vi.mocked(fetchRecentInboundLxmfDetailed).mockResolvedValue({
      messages: [sampleInbound(hash, 'Test back 1')],
      ringLen: 1,
    });

    const { result, unmount } = renderHook(() => useReticulumRuntime());
    await act(async () => {
      await result.current.connect();
    });

    await waitFor(() => {
      expect(useMessageStore.getState().messages[identityId][hash].payload).toBe('Test back 1');
    });
    expect(fetchRecentInboundLxmfDetailed).toHaveBeenCalledWith({ limit: 200 });
    expect(getReticulumInboundLxmfDiagnostics().lastInboundCatchUpCount).toBe(1);
    unmount();
  });

  it('events_lagged and WS reconnect catch-up dedupe payloads already ingested live', async () => {
    const hash = 'cd'.repeat(32);
    const payload = sampleInbound(hash, 'already live');
    expect(ingestReticulumLxmfPayload(identityId, payload)).toBe(true);

    vi.mocked(fetchRecentInboundLxmfDetailed).mockResolvedValue({
      messages: [payload],
      ringLen: 1,
    });

    const { result, unmount } = renderHook(() => useReticulumRuntime());
    await act(async () => {
      await result.current.connect();
    });
    expect(eventHandler).toBeTruthy();
    const onEvent = eventHandler!;

    const callsAfterConnect = vi.mocked(fetchRecentInboundLxmfDetailed).mock.calls.length;

    act(() => {
      onEvent({ type: 'events_lagged', payload: { skipped: 12 } });
    });
    act(() => {
      onEvent({ type: 'ws_connected', payload: { reconnect: true } });
    });
    // First open (reconnect:false) must not catch up again.
    act(() => {
      onEvent({ type: 'ws_connected', payload: { reconnect: false } });
    });

    await waitFor(() => {
      expect(vi.mocked(fetchRecentInboundLxmfDetailed).mock.calls.length).toBe(
        callsAfterConnect + 2,
      );
    });

    expect(getReticulumInboundLxmfDiagnostics().lastEventsLaggedSkipped).toBe(12);

    const matches = Object.values(useMessageStore.getState().messages[identityId] ?? {}).filter(
      (m) => m.payload === 'already live',
    );
    expect(matches).toHaveLength(1);
    unmount();
  });

  it('sidecar restartStack catch-up ingests missed inbound', async () => {
    const hash = 'ef'.repeat(32);
    vi.mocked(fetchRecentInboundLxmfDetailed).mockResolvedValue({ messages: [], ringLen: 0 });

    const { result, unmount } = renderHook(() => useReticulumRuntime());
    await act(async () => {
      await result.current.connect();
    });

    vi.mocked(fetchRecentInboundLxmfDetailed).mockResolvedValue({
      messages: [sampleInbound(hash, 'after restart')],
      ringLen: 1,
    });
    const restartStack = result.current.restartStack;
    if (!restartStack) {
      throw new Error('expected restartStack on Reticulum runtime');
    }
    await act(async () => {
      await restartStack();
    });

    await waitFor(() => {
      expect(useMessageStore.getState().messages[identityId][hash].payload).toBe('after restart');
    });
    unmount();
  });

  it('mergeMessageRecordsFromDbForIdentity preserves live rows absent from DB snapshot', () => {
    const live: MessageRecord = {
      id: 'live-hash',
      from: 1,
      to: 0,
      payload: 'from WS',
      channelIndex: 0,
      timestamp: 2_000,
    };
    const fromDb: MessageRecord = {
      id: 'db-hash',
      from: 2,
      to: 0,
      payload: 'from DB',
      channelIndex: 0,
      timestamp: 1_000,
    };
    addMessage(identityId, live);
    mergeMessageRecordsFromDbForIdentity(identityId, [fromDb]);
    const bucket = useMessageStore.getState().messages[identityId];
    expect(bucket['live-hash'].payload).toBe('from WS');
    expect(bucket['db-hash'].payload).toBe('from DB');
  });

  it('live inbound lxmf_message advances the catch-up watermark', async () => {
    const hash = '11'.repeat(32);
    const { result, unmount } = renderHook(() => useReticulumRuntime());
    await act(async () => {
      await result.current.connect();
    });
    expect(eventHandler).toBeTruthy();
    const onEvent = eventHandler!;
    resetReticulumInboundLxmfDiagnosticsForTests();

    act(() => {
      onEvent({
        type: 'lxmf_message',
        payload: sampleInbound(hash, 'live inbound', 5_000, 7),
      });
    });

    await waitFor(() => {
      expect(useMessageStore.getState().messages[identityId][hash].payload).toBe('live inbound');
    });
    expect(getReticulumInboundLxmfDiagnostics().inboundCatchUpWatermarkTs).toBe(5_000);
    expect(getReticulumInboundLxmfDiagnostics().inboundCatchUpWatermarkSeq).toBe(7);
    unmount();
  });

  it('outbound lxmf_message does not advance the catch-up watermark', async () => {
    const hash = '22'.repeat(32);
    const { result, unmount } = renderHook(() => useReticulumRuntime());
    await act(async () => {
      await result.current.connect();
    });
    expect(eventHandler).toBeTruthy();
    const onEvent = eventHandler!;
    resetReticulumInboundLxmfDiagnosticsForTests();

    act(() => {
      onEvent({
        type: 'lxmf_message',
        payload: {
          ...sampleInbound(hash, 'outbound echo', 9_000),
          direction: 'outbound',
          to_hash: 'bb'.repeat(16),
        },
      });
    });

    await waitFor(() => {
      expect(useMessageStore.getState().messages[identityId][hash].payload).toBe('outbound echo');
    });
    expect(getReticulumInboundLxmfDiagnostics().inboundCatchUpWatermarkTs).toBeNull();
    unmount();
  });

  it('same-ms catch-up twins are recovered exactly once via ring_seq cursor', async () => {
    const hashA = '33'.repeat(32);
    const hashB = '44'.repeat(32);
    const twinA = sampleInbound(hashA, 'twin-a', 4_000, 1);
    const twinB = sampleInbound(hashB, 'twin-b', 4_000, 2);
    vi.mocked(fetchRecentInboundLxmfDetailed).mockResolvedValue({
      messages: [twinA, twinB],
      ringLen: 2,
    });

    const { result, unmount } = renderHook(() => useReticulumRuntime());
    await act(async () => {
      await result.current.connect();
    });

    await waitFor(() => {
      const bucket = useMessageStore.getState().messages[identityId];
      expect(bucket[hashA].payload).toBe('twin-a');
      expect(bucket[hashB].payload).toBe('twin-b');
    });
    expect(getReticulumInboundLxmfDiagnostics().inboundCatchUpWatermarkTs).toBe(4_000);
    expect(getReticulumInboundLxmfDiagnostics().inboundCatchUpWatermarkSeq).toBe(2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('count=2 reason=connect'));
    warnSpy.mockClear();

    // Complete (ts, seq) cursor → empty ring slice; both twins already ingested once.
    vi.mocked(fetchRecentInboundLxmfDetailed).mockResolvedValue({ messages: [], ringLen: 2 });
    const diag = getReticulumInboundLxmfDiagnostics();
    await expect(
      catchUpRecentInboundLxmf({
        identityId,
        ingest: () => {
          throw new Error('must not re-ingest after complete cursor');
        },
        sinceTs: diag.inboundCatchUpWatermarkTs ?? undefined,
        sinceSeq: diag.inboundCatchUpWatermarkSeq ?? undefined,
        reason: 'periodic',
      }),
    ).resolves.toBeNull();

    expect(fetchRecentInboundLxmfDetailed).toHaveBeenCalledWith({
      limit: 200,
      sinceTs: 4_000,
      sinceSeq: 2,
    });
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('count=2 reason=periodic'));
    expect(getReticulumInboundLxmfDiagnostics().lastInboundCatchUpCount).toBe(2);
    unmount();
  });
});

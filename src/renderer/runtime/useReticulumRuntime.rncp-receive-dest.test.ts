// @vitest-environment jsdom
/**
 * RNCP receive-dest share side effects in useReticulumRuntime.ingestLxmfPayload:
 * reserve → apply → commit (ok / no_share / invalid_sender) or release (upsert_failed).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyRncpReceiveDestShareFromLxmf } from '@/renderer/lib/applyRncpReceiveDestShare';
import { fetchRecentInboundLxmfDetailed } from '@/renderer/lib/reticulum/fetchRecentInboundLxmf';
import { resetReticulumManualStackStopSuppressForTests } from '@/renderer/lib/reticulum/reticulumManualStackStopSuppress';
import {
  resetRncpLxmfControlSideEffectDedupForTests,
  tryMarkRncpLxmfControlHandled,
  tryReserveRncpLxmfControlHandled,
} from '@/renderer/lib/rncpLxmfControlSideEffectDedup';
import { useReticulumRuntime } from '@/renderer/runtime/useReticulumRuntime';
import { useMessageStore } from '@/renderer/stores/messageStore';
import { useRncpEnableRequestStore } from '@/renderer/stores/rncpEnableRequestStore';
import type { ReticulumSidecarEvent } from '@/shared/reticulum-types';
import {
  RNCP_RECEIVE_DEST_SHARE_PREFIX,
  RNCP_REQUEST_ENABLE_SENTINEL,
} from '@/shared/rncpRequestEnable';

vi.mock('@/renderer/lib/applyRncpReceiveDestShare', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    applyRncpReceiveDestShareFromLxmf: vi.fn(),
  };
});

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

vi.mock('@/renderer/components/Toast', () => ({
  pushAppToast: vi.fn(),
  useToast: () => ({ addToast: vi.fn() }),
}));

const SENDER = 'ab'.repeat(16);
const RECEIVE = 'cd'.repeat(16);
const SHARE_TEXT = `Here is my dest.\n\n${RNCP_RECEIVE_DEST_SHARE_PREFIX}${RECEIVE}`;

function shareInbound(messageHash: string) {
  return {
    sender_hash: SENDER,
    sender_name: 'Alice',
    text: SHARE_TEXT,
    timestamp: 1_000,
    direction: 'inbound' as const,
    message_hash: messageHash,
    received_via: 'tcp',
  };
}

describe('useReticulumRuntime RNCP receive-dest share reservation', () => {
  let eventHandler: ((evt: ReticulumSidecarEvent) => void) | null = null;
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

  beforeEach(() => {
    useMessageStore.setState({ messages: {} });
    useRncpEnableRequestStore.getState().clear();
    useRncpEnableRequestStore.setState({ dismissedPeers: new Set() });
    resetReticulumManualStackStopSuppressForTests();
    resetRncpLxmfControlSideEffectDedupForTests();
    eventHandler = null;
    warnSpy.mockClear();
    debugSpy.mockClear();
    vi.mocked(applyRncpReceiveDestShareFromLxmf).mockReset();
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

  async function connectAndGetOnEvent() {
    const { result, unmount } = renderHook(() => useReticulumRuntime());
    await act(async () => {
      await result.current.connect();
    });
    expect(eventHandler).toBeTruthy();
    return { onEvent: eventHandler!, unmount };
  }

  it.each([
    {
      label: 'ok',
      result: { ok: true as const, receiveHash: RECEIVE, lxmfPeerHash: SENDER },
    },
    {
      label: 'no_share',
      result: { ok: false as const, reason: 'no_share' as const },
    },
    {
      label: 'invalid_sender',
      result: { ok: false as const, reason: 'invalid_sender' as const },
    },
  ])(
    'commits reservation when apply returns $label (duplicate early-returns)',
    async ({ result: applyResult }) => {
      const hash = `${'a'.repeat(62)}01`;
      vi.mocked(applyRncpReceiveDestShareFromLxmf).mockResolvedValue(applyResult);

      const { onEvent, unmount } = await connectAndGetOnEvent();
      act(() => {
        onEvent({ type: 'lxmf_message', payload: shareInbound(hash) });
      });
      await waitFor(() => {
        expect(applyRncpReceiveDestShareFromLxmf).toHaveBeenCalledTimes(1);
      });

      // Committed: same message_hash cannot reserve again; duplicate ingest must not re-apply.
      expect(tryReserveRncpLxmfControlHandled(hash)).toBeNull();
      act(() => {
        onEvent({ type: 'lxmf_message', payload: shareInbound(hash) });
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(applyRncpReceiveDestShareFromLxmf).toHaveBeenCalledTimes(1);
      unmount();
    },
  );

  it('releases reservation on upsert_failed so a later catch-up can retry', async () => {
    const hash = `${'b'.repeat(62)}02`;
    vi.mocked(applyRncpReceiveDestShareFromLxmf)
      .mockResolvedValueOnce({ ok: false, reason: 'upsert_failed' })
      .mockResolvedValueOnce({
        ok: true,
        receiveHash: RECEIVE,
        lxmfPeerHash: SENDER,
      });

    const { onEvent, unmount } = await connectAndGetOnEvent();
    act(() => {
      onEvent({ type: 'lxmf_message', payload: shareInbound(hash) });
    });
    await waitFor(() => {
      expect(applyRncpReceiveDestShareFromLxmf).toHaveBeenCalledTimes(1);
    });

    // Released: duplicate catch-up with the same message_hash may apply again.
    act(() => {
      onEvent({ type: 'lxmf_message', payload: shareInbound(hash) });
    });
    await waitFor(() => {
      expect(applyRncpReceiveDestShareFromLxmf).toHaveBeenCalledTimes(2);
    });
    unmount();
  });

  it('skips apply when tryReserve returns no reservation (already handled)', async () => {
    const hash = `${'c'.repeat(62)}03`;
    expect(tryMarkRncpLxmfControlHandled(hash)).toBe(true);
    vi.mocked(applyRncpReceiveDestShareFromLxmf).mockResolvedValue({
      ok: true,
      receiveHash: RECEIVE,
      lxmfPeerHash: SENDER,
    });

    const { onEvent, unmount } = await connectAndGetOnEvent();
    act(() => {
      onEvent({ type: 'lxmf_message', payload: shareInbound(hash) });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(applyRncpReceiveDestShareFromLxmf).not.toHaveBeenCalled();
    unmount();
  });

  it('catch-up redelivery of a committed receive-dest share does not re-apply', async () => {
    const hash = `${'d'.repeat(62)}04`;
    const payload = shareInbound(hash);
    vi.mocked(applyRncpReceiveDestShareFromLxmf).mockResolvedValue({
      ok: true,
      receiveHash: RECEIVE,
      lxmfPeerHash: SENDER,
    });

    const { result, unmount } = renderHook(() => useReticulumRuntime());
    await act(async () => {
      await result.current.connect();
    });
    expect(eventHandler).toBeTruthy();
    const onEvent = eventHandler!;

    act(() => {
      onEvent({ type: 'lxmf_message', payload });
    });
    await waitFor(() => {
      expect(applyRncpReceiveDestShareFromLxmf).toHaveBeenCalledTimes(1);
    });

    // Same control message reappears via catch-up after WS lag — side effect must not fire again.
    vi.mocked(fetchRecentInboundLxmfDetailed).mockResolvedValue({
      messages: [payload],
      ringLen: 1,
    });
    act(() => {
      onEvent({ type: 'events_lagged', payload: { skipped: 3 } });
    });
    await waitFor(() => {
      expect(fetchRecentInboundLxmfDetailed).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(applyRncpReceiveDestShareFromLxmf).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('catch-up redelivery of a committed enable-request does not re-enqueue the modal', async () => {
    const hash = `${'e'.repeat(62)}05`;
    const enableText = `Please enable rncp.\n\n${RNCP_REQUEST_ENABLE_SENTINEL}`;
    const payload = {
      sender_hash: SENDER,
      sender_name: 'Alice',
      text: enableText,
      timestamp: 1_000,
      direction: 'inbound' as const,
      message_hash: hash,
      received_via: 'tcp',
    };

    const { result, unmount } = renderHook(() => useReticulumRuntime());
    await act(async () => {
      await result.current.connect();
    });
    expect(eventHandler).toBeTruthy();
    const onEvent = eventHandler!;

    act(() => {
      onEvent({ type: 'lxmf_message', payload });
    });
    await waitFor(() => {
      expect(useRncpEnableRequestStore.getState().prompts).toHaveLength(1);
    });

    vi.mocked(fetchRecentInboundLxmfDetailed).mockResolvedValue({
      messages: [payload],
      ringLen: 1,
    });
    act(() => {
      onEvent({ type: 'ws_connected', payload: { reconnect: true } });
    });
    await waitFor(() => {
      expect(fetchRecentInboundLxmfDetailed).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useRncpEnableRequestStore.getState().prompts).toHaveLength(1);
    unmount();
  });
});

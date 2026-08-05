// @vitest-environment jsdom
/**
 * Behavioral tests for LRGP games WebSocket event routing
 * (`games.update` / `games.action_result`), mirroring the voice event pattern.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetReticulumManualStackStopSuppressForTests } from '@/renderer/lib/reticulum/reticulumManualStackStopSuppress';
import { useReticulumRuntime } from '@/renderer/runtime/useReticulumRuntime';
import { useReticulumGamesStore } from '@/renderer/stores/reticulumGamesStore';
import type { ReticulumSidecarEvent } from '@/shared/reticulum-types';

vi.mock('@/renderer/lib/reticulum/fetchRecentInboundLxmf', () => ({
  fetchRecentInboundLxmf: vi.fn().mockResolvedValue([]),
  fetchRecentInboundLxmfDetailed: vi.fn().mockResolvedValue({ messages: [], ringLen: 0 }),
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

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 's1',
    identity_id: 'me',
    app_id: 'ttt',
    app_version: 1,
    contact_hash: 'a'.repeat(32),
    initiator: 'a'.repeat(32),
    status: 'active',
    metadata: { board: 'X________', turn: 'me' },
    unread: 1,
    created_at: 1,
    updated_at: 2,
    last_action_at: 2,
    ...overrides,
  };
}

describe('useReticulumRuntime games event routing', () => {
  let eventHandler: ((evt: ReticulumSidecarEvent) => void) | null = null;

  beforeEach(() => {
    resetReticulumManualStackStopSuppressForTests();
    useReticulumGamesStore.getState().clear();
    eventHandler = null;
    vi.mocked(window.electronAPI.reticulum.onEvent).mockImplementation((cb) => {
      eventHandler = cb;
      return () => {
        if (eventHandler === cb) eventHandler = null;
      };
    });
    vi.mocked(window.electronAPI.reticulum.onVoiceAudio).mockImplementation(() => () => {});
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
    vi.mocked(window.electronAPI.reticulum.onVoiceAudio).mockReset();
    vi.mocked(window.electronAPI.reticulum.onVoiceAudio).mockReturnValue(() => {});
    useReticulumGamesStore.getState().clear();
  });

  async function connectAndGetHandler() {
    const { result, unmount } = renderHook(() => useReticulumRuntime());
    await act(async () => {
      await result.current.connect();
    });
    expect(eventHandler).toBeTruthy();
    return { onEvent: eventHandler!, unmount };
  }

  it('upserts sessions from games.update', async () => {
    const { onEvent, unmount } = await connectAndGetHandler();

    act(() => {
      onEvent({
        type: 'games.update',
        payload: {
          app_id: 'ttt',
          session_id: 's1',
          direction: 'inbound',
          session: makeSession(),
        },
      });
    });
    expect(useReticulumGamesStore.getState().sessions).toHaveLength(1);
    expect(useReticulumGamesStore.getState().sessions[0].status).toBe('active');

    act(() => {
      onEvent({
        type: 'games.update',
        payload: {
          app_id: 'ttt',
          session_id: 's1',
          direction: 'outbound',
          session: makeSession({ status: 'completed', last_action_at: 5 }),
        },
      });
    });
    expect(useReticulumGamesStore.getState().sessions).toHaveLength(1);
    expect(useReticulumGamesStore.getState().sessions[0].status).toBe('completed');

    unmount();
  });

  it('applies games.action_result and clears actionBusy', async () => {
    const { onEvent, unmount } = await connectAndGetHandler();

    useReticulumGamesStore.getState().setActionBusy(true);
    act(() => {
      onEvent({
        type: 'games.action_result',
        payload: { app_id: 'ttt', session_id: 's1', ok: false, error: 'not_your_turn' },
      });
    });
    const state = useReticulumGamesStore.getState();
    expect(state.actionBusy).toBe(false);
    expect(state.lastActionResult?.ok).toBe(false);
    expect(state.lastActionResult?.error).toBe('not_your_turn');

    unmount();
  });
});

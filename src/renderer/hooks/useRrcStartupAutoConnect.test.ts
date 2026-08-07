import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RETICULUM_CONFIGURED_EVENT } from '@/renderer/lib/reticulum/reticulumConfiguredEvent';
import * as sidecarReads from '@/renderer/lib/reticulum/reticulumSidecarReads';
import {
  resetRrcHubDisconnectSuppressForTests,
  setRrcHubDisconnectSuppressed,
} from '@/renderer/lib/rrcHubDisconnectSuppress';
import { saveRrcHubAutoJoin } from '@/renderer/lib/rrcHubPrefs';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';

import {
  RRC_AUTO_CONNECT_FAST_MS,
  RRC_AUTO_CONNECT_STEADY_MS,
  runRrcHubAutoConnectBatch,
  useRrcStartupAutoConnect,
} from './useRrcStartupAutoConnect';

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('runRrcHubAutoConnectBatch', () => {
  beforeEach(() => {
    localStorage.clear();
    resetRrcHubDisconnectSuppressForTests();
    useRrcSessionStore.setState({
      sessionsByHub: new Map(),
      focusedHubHash: null,
    });
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockClear();
  });

  it('no-ops when no hubs are marked for auto-join', async () => {
    await runRrcHubAutoConnectBatch('tester');
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();
  });

  it('connects pending auto-join hubs', async () => {
    saveRrcHubAutoJoin(['aabbccddeeff00112233445566778899']);
    await runRrcHubAutoConnectBatch('tester');
    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalledWith({
      dest_hash: 'aabbccddeeff00112233445566778899',
      nickname: 'tester',
    });
  });

  it('skips hubs with sticky disconnect suppress', async () => {
    const hub = 'aabbccddeeff00112233445566778899';
    saveRrcHubAutoJoin([hub]);
    setRrcHubDisconnectSuppressed(hub, true);
    await runRrcHubAutoConnectBatch('tester');
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();
  });

  it('skips hubs that are already linked', async () => {
    const linked = '11112222333344445555666677778888';
    const pending = 'aabbccddeeff00112233445566778899';
    saveRrcHubAutoJoin([linked, pending]);
    useRrcSessionStore.getState().applyStatus('active', linked, null);
    await runRrcHubAutoConnectBatch('tester');

    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalledWith({
      dest_hash: pending,
      nickname: 'tester',
    });
  });
});

describe('useRrcStartupAutoConnect poll timing', () => {
  beforeEach(() => {
    localStorage.clear();
    resetRrcHubDisconnectSuppressForTests();
    useRrcSessionStore.setState({
      sessionsByHub: new Map(),
      focusedHubHash: null,
    });
    vi.useFakeTimers();
    vi.spyOn(sidecarReads, 'isReticulumSidecarRunning').mockResolvedValue(true);
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockClear();
  });

  it('derives fast/steady intervals from MS_PER_SECOND', () => {
    expect(RRC_AUTO_CONNECT_FAST_MS).toBe(500);
    expect(RRC_AUTO_CONNECT_STEADY_MS).toBe(4000);
  });

  it('polls at the fast interval while hubs are pending', async () => {
    // Keep hubs pending: failed connect rolls status back so linked-check stays false.
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockResolvedValue({
      ok: false,
      error: 'rrc connect requires live rns-stack sidecar',
    });
    saveRrcHubAutoJoin(['aabbccddeeff00112233445566778899']);
    renderHook(() => {
      useRrcStartupAutoConnect();
    });
    await flushMicrotasks();
    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalledTimes(1);
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RRC_AUTO_CONNECT_FAST_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalled();
  });

  it('wakes immediately on RETICULUM_CONFIGURED_EVENT', async () => {
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockResolvedValue({
      ok: false,
      error: 'rrc connect requires live rns-stack sidecar',
    });
    saveRrcHubAutoJoin(['aabbccddeeff00112233445566778899']);
    renderHook(() => {
      useRrcStartupAutoConnect();
    });
    await flushMicrotasks();
    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalledTimes(1);
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockClear();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(RETICULUM_CONFIGURED_EVENT));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalled();
  });

  it('does not start a batch when unmounted while status await is pending', async () => {
    let resolveStatus!: (v: boolean) => void;
    vi.spyOn(sidecarReads, 'isReticulumSidecarRunning').mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveStatus = resolve;
        }),
    );
    saveRrcHubAutoJoin(['aabbccddeeff00112233445566778899']);
    const { unmount } = renderHook(() => {
      useRrcStartupAutoConnect();
    });
    await flushMicrotasks();
    expect(sidecarReads.isReticulumSidecarRunning).toHaveBeenCalled();
    unmount();
    await act(async () => {
      resolveStatus(true);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();
  });
});

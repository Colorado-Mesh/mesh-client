import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RETICULUM_CONFIGURED_EVENT } from '@/renderer/lib/reticulum/reticulumConfiguredEvent';
import * as sidecarReads from '@/renderer/lib/reticulum/reticulumSidecarReads';
import {
  clearRrcHubAutoJoinBackoff,
  recordRrcHubAutoJoinFailure,
  resetRrcHubAutoJoinBackoffForTests,
  RRC_AUTO_JOIN_GIVE_UP_AFTER,
} from '@/renderer/lib/rrcHubAutoJoinBackoff';
import {
  resetRrcHubDisconnectSuppressForTests,
  setRrcHubDisconnectSuppressed,
} from '@/renderer/lib/rrcHubDisconnectSuppress';
import { saveRrcHubAutoJoin } from '@/renderer/lib/rrcHubPrefs';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';
import { MS_PER_SECOND } from '@/shared/timeConstants';

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

const HUB = 'aabbccddeeff00112233445566778899';

describe('runRrcHubAutoConnectBatch', () => {
  beforeEach(() => {
    localStorage.clear();
    resetRrcHubDisconnectSuppressForTests();
    resetRrcHubAutoJoinBackoffForTests();
    useRrcSessionStore.setState({
      sessionsByHub: new Map(),
      focusedHubHash: null,
    });
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockResolvedValue({ ok: true });
    vi.spyOn(sidecarReads, 'isReticulumRnsLiveReady').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockClear();
    resetRrcHubAutoJoinBackoffForTests();
    vi.restoreAllMocks();
  });

  it('no-ops when live RNS is not ready (panel and App share this gate)', async () => {
    vi.spyOn(sidecarReads, 'isReticulumRnsLiveReady').mockResolvedValue(false);
    saveRrcHubAutoJoin([HUB]);
    await runRrcHubAutoConnectBatch('tester');
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();
  });

  it('no-ops when no hubs are marked for auto-join', async () => {
    await runRrcHubAutoConnectBatch('tester');
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();
  });

  it('connects pending auto-join hubs', async () => {
    saveRrcHubAutoJoin([HUB]);
    await runRrcHubAutoConnectBatch('tester');
    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalledWith({
      dest_hash: HUB,
      nickname: 'tester',
    });
  });

  it('skips hubs with sticky disconnect suppress', async () => {
    saveRrcHubAutoJoin([HUB]);
    setRrcHubDisconnectSuppressed(HUB, true);
    await runRrcHubAutoConnectBatch('tester');
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();
  });

  it('skips hubs that are already linked', async () => {
    const linked = '11112222333344445555666677778888';
    saveRrcHubAutoJoin([linked, HUB]);
    useRrcSessionStore.getState().applyStatus('active', linked, null);
    await runRrcHubAutoConnectBatch('tester');

    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalledWith({
      dest_hash: HUB,
      nickname: 'tester',
    });
  });

  it('after connect failure does not reconnect until cooldown elapses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockResolvedValue({
      ok: false,
      error: 'timed out waiting for WELCOME',
    });
    saveRrcHubAutoJoin([HUB]);
    await runRrcHubAutoConnectBatch('tester');
    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalledTimes(1);
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockClear();

    await runRrcHubAutoConnectBatch('tester');
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();

    vi.setSystemTime(30 * MS_PER_SECOND);
    await runRrcHubAutoConnectBatch('tester');
    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does not back off when connect fails only because live RNS is not ready yet', async () => {
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockResolvedValue({
      ok: false,
      error: 'rrc connect requires live rns-stack sidecar',
    });
    saveRrcHubAutoJoin([HUB]);
    await runRrcHubAutoConnectBatch('tester');
    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalledTimes(1);
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockClear();
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockResolvedValue({ ok: true });
    await runRrcHubAutoConnectBatch('tester');
    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalledTimes(1);
  });

  it('after give-up stays blocked until clearRrcHubAutoJoinBackoff', async () => {
    saveRrcHubAutoJoin([HUB]);
    for (let i = 0; i < RRC_AUTO_JOIN_GIVE_UP_AFTER; i++) {
      recordRrcHubAutoJoinFailure(HUB, i * 60_000);
    }
    await runRrcHubAutoConnectBatch('tester');
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();
    clearRrcHubAutoJoinBackoff(HUB);
    await runRrcHubAutoConnectBatch('tester');
    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalledTimes(1);
  });
});

describe('useRrcStartupAutoConnect poll timing', () => {
  beforeEach(() => {
    localStorage.clear();
    resetRrcHubDisconnectSuppressForTests();
    resetRrcHubAutoJoinBackoffForTests();
    useRrcSessionStore.setState({
      sessionsByHub: new Map(),
      focusedHubHash: null,
    });
    vi.useFakeTimers();
    vi.spyOn(sidecarReads, 'isReticulumSidecarRunning').mockResolvedValue(true);
    vi.spyOn(sidecarReads, 'isReticulumRnsLiveReady').mockResolvedValue(true);
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockClear();
    resetRrcHubAutoJoinBackoffForTests();
  });

  it('derives fast/steady intervals from MS_PER_SECOND', () => {
    expect(RRC_AUTO_CONNECT_FAST_MS).toBe(500);
    expect(RRC_AUTO_CONNECT_STEADY_MS).toBe(4000);
  });

  it('does not re-fire connect during auto-join cooldown after failure', async () => {
    vi.setSystemTime(0);
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockResolvedValue({
      ok: false,
      error: 'timed out waiting for WELCOME',
    });
    saveRrcHubAutoJoin([HUB]);
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
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();
  });

  it('wakes immediately on RETICULUM_CONFIGURED_EVENT when hub is eligible', async () => {
    saveRrcHubAutoJoin([HUB]);
    renderHook(() => {
      useRrcStartupAutoConnect();
    });
    await flushMicrotasks();
    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalledTimes(1);
    vi.mocked(window.electronAPI.reticulum.rrc.connect).mockClear();
    useRrcSessionStore.getState().clearHubSession(HUB);

    await act(async () => {
      window.dispatchEvent(new CustomEvent(RETICULUM_CONFIGURED_EVENT));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(window.electronAPI.reticulum.rrc.connect).toHaveBeenCalled();
  });

  it('does not start a batch while RNS live is not ready', async () => {
    vi.spyOn(sidecarReads, 'isReticulumRnsLiveReady').mockResolvedValue(false);
    saveRrcHubAutoJoin([HUB]);
    renderHook(() => {
      useRrcStartupAutoConnect();
    });
    await flushMicrotasks();
    expect(window.electronAPI.reticulum.rrc.connect).not.toHaveBeenCalled();
  });

  it('does not start a batch when unmounted while status await is pending', async () => {
    let resolveStatus!: (v: boolean) => void;
    vi.spyOn(sidecarReads, 'isReticulumSidecarRunning').mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveStatus = resolve;
        }),
    );
    saveRrcHubAutoJoin([HUB]);
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

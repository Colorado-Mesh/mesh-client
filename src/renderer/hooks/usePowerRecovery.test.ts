// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSystemSuspended } from '../lib/systemPowerState';
import {
  POWER_RESUME_MESHCORE_STAGGER_MS,
  POWER_RESUME_RECOVERY_DELAY_MS,
  usePowerRecovery,
} from './usePowerRecovery';

describe('usePowerRecovery', () => {
  let suspendCb: (() => void) | null = null;
  let resumeCb: (() => void) | null = null;
  const meshtastic = {
    onPowerSuspend: vi.fn(),
    onPowerResume: vi.fn(),
  };
  const meshcore = {
    onPowerSuspend: vi.fn(),
    onPowerResume: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    setSystemSuspended(false);
    meshtastic.onPowerSuspend.mockClear();
    meshtastic.onPowerResume.mockClear();
    meshcore.onPowerSuspend.mockClear();
    meshcore.onPowerResume.mockClear();
    suspendCb = null;
    resumeCb = null;

    window.electronAPI.onPowerSuspend = vi.fn((cb: () => void) => {
      suspendCb = cb;
      return () => {
        suspendCb = null;
      };
    });
    window.electronAPI.onPowerResume = vi.fn((cb: () => void) => {
      resumeCb = cb;
      return () => {
        resumeCb = null;
      };
    });
    window.electronAPI.mqtt.powerSuspend = vi.fn().mockResolvedValue(undefined);
    window.electronAPI.mqtt.powerResume = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    setSystemSuspended(false);
    vi.useRealTimers();
  });

  it('notifies runtimes and MQTT on suspend', () => {
    renderHook(() => {
      usePowerRecovery({ meshtastic, meshcore });
    });
    expect(suspendCb).not.toBeNull();
    suspendCb!();
    expect(meshtastic.onPowerSuspend).toHaveBeenCalledTimes(1);
    expect(meshcore.onPowerSuspend).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.mqtt.powerSuspend).toHaveBeenCalledTimes(1);
  });

  it('schedules MQTT + runtime recovery after resume delay', async () => {
    renderHook(() => {
      usePowerRecovery({ meshtastic, meshcore });
    });
    suspendCb!();
    resumeCb!();
    expect(meshtastic.onPowerResume).not.toHaveBeenCalled();
    expect(meshcore.onPowerResume).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(POWER_RESUME_RECOVERY_DELAY_MS);
    expect(window.electronAPI.mqtt.powerResume).toHaveBeenCalledTimes(1);
    expect(meshtastic.onPowerResume).toHaveBeenCalledTimes(1);
    expect(meshcore.onPowerResume).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(POWER_RESUME_MESHCORE_STAGGER_MS);
    expect(meshcore.onPowerResume).toHaveBeenCalledTimes(1);
  });

  it('cancels pending MeshCore stagger when suspend fires before stagger elapses', async () => {
    renderHook(() => {
      usePowerRecovery({ meshtastic, meshcore });
    });
    suspendCb!();
    resumeCb!();
    await vi.advanceTimersByTimeAsync(POWER_RESUME_RECOVERY_DELAY_MS);
    expect(meshtastic.onPowerResume).toHaveBeenCalledTimes(1);
    expect(meshcore.onPowerResume).not.toHaveBeenCalled();
    suspendCb!();
    await vi.advanceTimersByTimeAsync(POWER_RESUME_MESHCORE_STAGGER_MS);
    expect(meshcore.onPowerResume).not.toHaveBeenCalled();
  });
});

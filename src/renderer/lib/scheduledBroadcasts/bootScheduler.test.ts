// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetScheduledBroadcastsStoreForTests,
  useScheduledBroadcastsStore,
} from '../../stores/scheduledBroadcastsStore';
import { bootScheduledBroadcastScheduler } from './bootScheduler';

const scheduler = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  stop: vi.fn(),
  refresh: vi.fn(async () => {}),
  onPowerResume: vi.fn(async () => {}),
  sendNow: vi.fn(),
  isRunning: vi.fn(() => false),
}));
vi.mock('./scheduler', () => ({
  getScheduledBroadcastScheduler: () => scheduler,
}));

describe('bootScheduledBroadcastScheduler', () => {
  let resumeCb: (() => void) | undefined;
  const offResume = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetScheduledBroadcastsStoreForTests();
    useScheduledBroadcastsStore.setState({ hydrated: true });
    resumeCb = undefined;
    window.electronAPI.onPowerResume = vi.fn((cb: () => void) => {
      resumeCb = cb;
      return offResume;
    });
  });
  afterEach(() => {
    resetScheduledBroadcastsStoreForTests();
  });

  it('starts, re-arms on setting and slot changes, reconciles on resume, and stops on dispose', async () => {
    const dispose = await bootScheduledBroadcastScheduler();
    expect(scheduler.start).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new CustomEvent('mesh-client:appSettings'));
    expect(scheduler.refresh).toHaveBeenCalledTimes(1);

    useScheduledBroadcastsStore.setState((s) => ({ slots: { ...s.slots, 1: null } }));
    expect(scheduler.refresh).toHaveBeenCalledTimes(2);

    resumeCb?.();
    expect(scheduler.onPowerResume).toHaveBeenCalledTimes(1);

    dispose();
    expect(scheduler.stop).toHaveBeenCalledTimes(1);
    expect(offResume).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new CustomEvent('mesh-client:appSettings'));
    expect(scheduler.refresh).toHaveBeenCalledTimes(2);
  });
});

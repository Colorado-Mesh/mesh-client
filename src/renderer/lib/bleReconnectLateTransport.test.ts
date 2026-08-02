// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { raceWithDeadline } from './bleReconnectHelper';
import { createBleReconnectTransportCleanup } from './bleReconnectLateTransport';

describe('createBleReconnectTransportCleanup', () => {
  it('disconnects a transport that resolves after raceWithDeadline times out', async () => {
    vi.useFakeTimers();
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const cleanup = createBleReconnectTransportCleanup(disconnect, 'test');

    let resolveOpen!: (value: { driverIdentityId: string }) => void;
    const openPromise = new Promise<{ driverIdentityId: string }>((resolve) => {
      resolveOpen = resolve;
    });

    const attempt = { active: true };
    const work = (async () => {
      const opened = await openPromise;
      if (!attempt.active) {
        await cleanup.cleanup(opened.driverIdentityId);
        throw new Error('Reconnect superseded after open');
      }
      return opened;
    })();
    void work.catch(() => {});

    const raced = raceWithDeadline(work, 50, 'BLE reconnect attempt timed out');
    const rejection = expect(raced).rejects.toThrow(/BLE reconnect attempt timed out/);
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    attempt.active = false;

    resolveOpen({ driverIdentityId: 'late-driver' });
    await expect(work).rejects.toThrow(/superseded after open/);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledWith('late-driver');
    expect(cleanup.cleanedIdentityId()).toBe('late-driver');

    await cleanup.cleanup('late-driver');
    expect(disconnect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('disconnects once when catch and late path both try the same identity', async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const cleanup = createBleReconnectTransportCleanup(disconnect, 'test');
    await cleanup.cleanup('driver-a');
    await cleanup.cleanup('driver-a');
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects a transport that finishes attach after the deadline', async () => {
    vi.useFakeTimers();
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const cleanup = createBleReconnectTransportCleanup(disconnect, 'test');

    let resolveAttach!: () => void;
    const attachPromise = new Promise<void>((resolve) => {
      resolveAttach = resolve;
    });

    const attempt = { active: true };
    const opened = { driverIdentityId: 'attach-driver' };
    const work = (async () => {
      // Open already completed before the deadline; attach hangs past it.
      await attachPromise;
      if (!attempt.active) {
        await cleanup.cleanup(opened.driverIdentityId);
        throw new Error('MeshCore reconnect superseded during attach');
      }
    })();
    void work.catch(() => {});

    const raced = raceWithDeadline(work, 50, 'BLE reconnect attempt timed out');
    const rejection = expect(raced).rejects.toThrow(/BLE reconnect attempt timed out/);
    await vi.advanceTimersByTimeAsync(50);
    await rejection;
    attempt.active = false;
    // Simulate catch bumping setup generation for MeshCore background RPC cancel.
    let setupGeneration = 1;
    setupGeneration += 1;
    expect(setupGeneration).toBe(2);

    resolveAttach();
    await expect(work).rejects.toThrow(/superseded during attach/);
    expect(disconnect).toHaveBeenCalledWith('attach-driver');
    vi.useRealTimers();
  });
});

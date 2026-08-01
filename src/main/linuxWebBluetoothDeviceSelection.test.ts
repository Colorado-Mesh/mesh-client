// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BLUETOOTHCTL_NOT_FOUND_MESSAGE,
  formatBluetoothctlSpawnError,
  LinuxWebBluetoothDeviceSelection,
} from './linuxWebBluetoothDeviceSelection';

describe('LinuxWebBluetoothDeviceSelection', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores the first callback and seeds the device map', () => {
    const session = new LinuxWebBluetoothDeviceSelection();
    const a = vi.fn();
    const result = session.beginOrMergeDiscovery([{ deviceId: 'aa:bb', deviceName: 'Radio A' }], a);
    expect(result.isNewRequest).toBe(true);
    expect(result.generation).toBe(1);
    expect(result.devices).toEqual([{ deviceId: 'aa:bb', deviceName: 'Radio A' }]);
    expect(session.hasPendingSelection()).toBe(true);
    expect(session.knownDeviceIds().has('aa:bb')).toBe(true);
  });

  it('retains the first callback on multi-fire and merges devices', () => {
    const session = new LinuxWebBluetoothDeviceSelection();
    const a = vi.fn();
    const b = vi.fn();
    session.beginOrMergeDiscovery([{ deviceId: 'aa:bb', deviceName: 'A' }], a);
    const second = session.beginOrMergeDiscovery([{ deviceId: 'cc:dd', deviceName: 'B' }], b);
    expect(second.isNewRequest).toBe(false);
    expect(second.generation).toBe(1);
    expect(second.devices).toEqual([
      { deviceId: 'aa:bb', deviceName: 'A' },
      { deviceId: 'cc:dd', deviceName: 'B' },
    ]);
    expect(session.resolveSelection('cc:dd')).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith('cc:dd');
    expect(b).not.toHaveBeenCalled();
  });

  it('resolve with a known id calls the first callback once and clears', () => {
    const session = new LinuxWebBluetoothDeviceSelection();
    const a = vi.fn();
    session.beginOrMergeDiscovery([{ deviceId: 'aa:bb' }], a);
    expect(session.resolveSelection('aa:bb')).toBe(true);
    expect(a).toHaveBeenCalledWith('aa:bb');
    expect(session.hasPendingSelection()).toBe(false);
    expect(session.knownDeviceIds().size).toBe(0);
  });

  it('cancel calls the first callback with empty string and clears', () => {
    const session = new LinuxWebBluetoothDeviceSelection();
    const a = vi.fn();
    session.beginOrMergeDiscovery([{ deviceId: 'aa:bb' }], a);
    expect(session.cancelSelection()).toBe(true);
    expect(a).toHaveBeenCalledWith('');
    expect(session.hasPendingSelection()).toBe(false);
  });

  it('starts a fresh session after clear', () => {
    const session = new LinuxWebBluetoothDeviceSelection();
    const a = vi.fn();
    const c = vi.fn();
    session.beginOrMergeDiscovery([{ deviceId: 'aa:bb' }], a);
    session.cancelSelection();
    const next = session.beginOrMergeDiscovery([{ deviceId: 'ee:ff', deviceName: 'C' }], c);
    expect(next.isNewRequest).toBe(true);
    expect(next.generation).toBe(2);
    expect(session.resolveSelection('ee:ff')).toBe(true);
    expect(c).toHaveBeenCalledWith('ee:ff');
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith('');
  });

  it('ignores unknown deviceId without clearing', () => {
    const session = new LinuxWebBluetoothDeviceSelection();
    const a = vi.fn();
    session.beginOrMergeDiscovery([{ deviceId: 'aa:bb' }], a);
    expect(session.resolveSelection('zz:zz')).toBe(false);
    expect(a).not.toHaveBeenCalled();
    expect(session.hasPendingSelection()).toBe(true);
    expect(session.resolveSelection('aa:bb')).toBe(true);
    expect(a).toHaveBeenCalledWith('aa:bb');
  });

  it('retains the first callback when a follow-up event has an empty device list', () => {
    const session = new LinuxWebBluetoothDeviceSelection();
    const a = vi.fn();
    const b = vi.fn();
    session.beginOrMergeDiscovery([{ deviceId: 'aa:bb', deviceName: 'A' }], a);
    const empty = session.beginOrMergeDiscovery([], b);
    expect(empty.isNewRequest).toBe(false);
    expect(empty.devices).toEqual([{ deviceId: 'aa:bb', deviceName: 'A' }]);
    expect(session.cancelIfCallback(a)).toBe(true);
    expect(a).toHaveBeenCalledWith('');
    expect(b).not.toHaveBeenCalled();
  });

  it('cancelIfCallback only cancels when the retained callback matches', () => {
    const session = new LinuxWebBluetoothDeviceSelection();
    const a = vi.fn();
    const b = vi.fn();
    session.beginOrMergeDiscovery([{ deviceId: 'aa:bb' }], a);
    expect(session.cancelIfCallback(b)).toBe(false);
    expect(session.hasPendingSelection()).toBe(true);
    expect(session.cancelIfCallback(a)).toBe(true);
    expect(a).toHaveBeenCalledWith('');
  });

  it('ignores a delayed cancel from an earlier chooser after a later Connect session starts', () => {
    const session = new LinuxWebBluetoothDeviceSelection();
    const first = vi.fn();
    const second = vi.fn();
    const firstSession = session.beginOrMergeDiscovery([{ deviceId: 'aa:bb' }], first);
    expect(firstSession.generation).toBe(1);

    // Simulate handleConnect: cancel prior generation, then a new requestDevice() chooser.
    expect(session.cancelIfGeneration(1)).toBe(true);
    expect(first).toHaveBeenCalledWith('');

    const next = session.beginOrMergeDiscovery([{ deviceId: 'cc:dd' }], second);
    expect(next.generation).toBe(2);
    expect(session.hasPendingSelection()).toBe(true);

    // Delayed cancel from the earlier Cancel / Connect still carries generation 1.
    expect(session.cancelIfGeneration(1)).toBe(false);
    expect(second).not.toHaveBeenCalled();
    expect(session.hasPendingSelection()).toBe(true);
    expect(session.currentGeneration()).toBe(2);
  });

  it('applyCancel force-clears orphans and generation-scopes delayed cancels', () => {
    const session = new LinuxWebBluetoothDeviceSelection();
    const first = vi.fn();
    const second = vi.fn();
    session.beginOrMergeDiscovery([{ deviceId: 'aa:bb' }], first);

    expect(session.applyCancel(undefined)).toEqual({
      cancelled: true,
      mode: 'force',
      generation: 1,
    });
    expect(first).toHaveBeenCalledWith('');
    expect(session.applyCancel(null)).toEqual({ cancelled: false, mode: 'force' });

    session.beginOrMergeDiscovery([{ deviceId: 'cc:dd' }], second);
    expect(session.applyCancel(1)).toEqual({
      cancelled: false,
      mode: 'ignored',
      generation: 1,
      activeGeneration: 2,
    });
    expect(second).not.toHaveBeenCalled();
    expect(session.applyCancel(2)).toEqual({
      cancelled: true,
      mode: 'generation',
      generation: 2,
    });
    expect(second).toHaveBeenCalledWith('');
  });

  it('armStaleTimeout auto-cancels and clears; resolve clears the timer without firing', () => {
    vi.useFakeTimers();
    const session = new LinuxWebBluetoothDeviceSelection();
    const a = vi.fn();
    const onStale = vi.fn();
    session.beginOrMergeDiscovery([{ deviceId: 'aa:bb' }], a);
    session.armStaleTimeout(300_000, onStale);
    expect(session.resolveSelection('aa:bb')).toBe(true);
    vi.advanceTimersByTime(300_000);
    expect(onStale).not.toHaveBeenCalled();
    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith('aa:bb');
  });

  it('armStaleTimeout fires cancel only for the active generation', () => {
    vi.useFakeTimers();
    const session = new LinuxWebBluetoothDeviceSelection();
    const first = vi.fn();
    const second = vi.fn();
    const onStale = vi.fn();
    session.beginOrMergeDiscovery([{ deviceId: 'aa:bb' }], first);
    session.armStaleTimeout(300_000, onStale);
    session.cancelSelection();
    session.beginOrMergeDiscovery([{ deviceId: 'cc:dd' }], second);
    session.armStaleTimeout(300_000, onStale);
    vi.advanceTimersByTime(300_000);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith('');
    expect(second).toHaveBeenCalledWith('');
    expect(session.hasPendingSelection()).toBe(false);
  });

  it('defaults missing device names to Unknown Device', () => {
    const session = new LinuxWebBluetoothDeviceSelection();
    const a = vi.fn();
    const result = session.beginOrMergeDiscovery([{ deviceId: 'aa:bb', deviceName: null }], a);
    expect(result.devices[0]?.deviceName).toBe('Unknown Device');
  });
});

describe('formatBluetoothctlSpawnError', () => {
  it('maps ENOENT to bluetoothctl not found', () => {
    const err = Object.assign(new Error('spawn bluetoothctl ENOENT'), { code: 'ENOENT' });
    expect(formatBluetoothctlSpawnError(err)).toBe(BLUETOOTHCTL_NOT_FOUND_MESSAGE);
  });

  it('maps ENOENT-like messages without code', () => {
    expect(formatBluetoothctlSpawnError(new Error('spawn bluetoothctl ENOENT'))).toBe(
      BLUETOOTHCTL_NOT_FOUND_MESSAGE,
    );
  });

  it('passes through other errors', () => {
    expect(formatBluetoothctlSpawnError(new Error('timed out'))).toBe('timed out');
  });
});

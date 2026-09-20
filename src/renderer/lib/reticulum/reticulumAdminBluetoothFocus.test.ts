import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  consumeReticulumAdminBluetoothFocus,
  peekReticulumAdminBluetoothFocusPending,
  requestReticulumAdminBluetoothFocus,
  resetReticulumAdminBluetoothFocusForTests,
  subscribeReticulumAdminBluetoothFocus,
} from './reticulumAdminBluetoothFocus';

describe('reticulumAdminBluetoothFocus', () => {
  afterEach(() => {
    resetReticulumAdminBluetoothFocusForTests();
  });

  it('latches a pending focus until consumed', () => {
    expect(peekReticulumAdminBluetoothFocusPending()).toBe(false);
    requestReticulumAdminBluetoothFocus();
    expect(peekReticulumAdminBluetoothFocusPending()).toBe(true);
    expect(consumeReticulumAdminBluetoothFocus()).toBe(true);
    expect(peekReticulumAdminBluetoothFocusPending()).toBe(false);
    expect(consumeReticulumAdminBluetoothFocus()).toBe(false);
  });

  it('notifies subscribers when focus is requested', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeReticulumAdminBluetoothFocus(listener);
    requestReticulumAdminBluetoothFocus();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    requestReticulumAdminBluetoothFocus();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

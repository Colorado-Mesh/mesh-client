import { describe, expect, it, vi } from 'vitest';

import {
  getPendingProtocolSelection,
  resetProtocolSwitchUiForTests,
  setPendingProtocolSelection,
  subscribePendingProtocolSelection,
} from './protocolSwitchUiStore';

describe('protocolSwitchUiStore', () => {
  it('notifies subscribers only when the pending protocol changes', () => {
    resetProtocolSwitchUiForTests();
    const listener = vi.fn();
    const unsub = subscribePendingProtocolSelection(listener);

    setPendingProtocolSelection('reticulum');
    expect(getPendingProtocolSelection()).toBe('reticulum');
    expect(listener).toHaveBeenCalledTimes(1);

    setPendingProtocolSelection('reticulum');
    expect(listener).toHaveBeenCalledTimes(1);

    setPendingProtocolSelection(null);
    expect(getPendingProtocolSelection()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    unsub();
    setPendingProtocolSelection('meshcore');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

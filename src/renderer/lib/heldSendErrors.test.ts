import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  holdSendError,
  resetHeldSendErrorsForTests,
  subscribeHeldSendErrors,
  takeHeldSendError,
} from './heldSendErrors';

describe('heldSendErrors', () => {
  beforeEach(() => {
    resetHeldSendErrorsForTests();
  });

  it('returns nothing for a view with no held reason', () => {
    expect(takeHeldSendError('reticulum', 'rrc:hub:#general')).toBeUndefined();
  });

  it('hands a held reason out once, for its own protocol and view only', () => {
    holdSendError('reticulum', 'rrc:hub:#general', 'Send timed out');

    expect(takeHeldSendError('reticulum', 'rrc:hub:#ops')).toBeUndefined();
    expect(takeHeldSendError('meshcore', 'rrc:hub:#general')).toBeUndefined();
    expect(takeHeldSendError('reticulum', 'rrc:hub:#general')).toBe('Send timed out');
    expect(takeHeldSendError('reticulum', 'rrc:hub:#general')).toBeUndefined();
  });

  it('keeps the latest reason when a view fails twice', () => {
    holdSendError('meshtastic', 'ch:1', 'first');
    holdSendError('meshtastic', 'ch:1', 'second');

    expect(takeHeldSendError('meshtastic', 'ch:1')).toBe('second');
  });

  it('tells subscribers when a reason is held, until they unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeHeldSendErrors(listener);

    holdSendError('meshcore', 'ch:2', 'radio busy');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    holdSendError('meshcore', 'ch:2', 'radio busy');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

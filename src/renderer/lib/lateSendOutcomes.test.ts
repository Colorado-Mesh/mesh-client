import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  announceLateSend,
  holdSendError,
  resetLateSendOutcomesForTests,
  subscribeLateSendOutcomes,
  takeHeldSendError,
} from './lateSendOutcomes';

describe('lateSendOutcomes', () => {
  beforeEach(() => {
    resetLateSendOutcomesForTests();
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

  it('tells subscribers which view failed or sent, until they unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLateSendOutcomes(listener);

    holdSendError('meshcore', 'ch:2', 'radio busy');
    announceLateSend('reticulum', 'rrc:hub:#general', '/me waves');
    expect(listener).toHaveBeenNthCalledWith(1, {
      kind: 'failed',
      protocol: 'meshcore',
      viewKey: 'ch:2',
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      kind: 'sent',
      protocol: 'reticulum',
      viewKey: 'rrc:hub:#general',
      text: '/me waves',
    });

    unsubscribe();
    holdSendError('meshcore', 'ch:2', 'radio busy');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('holds nothing for an announced send', () => {
    announceLateSend('meshtastic', 'ch:3', 'hello');

    expect(takeHeldSendError('meshtastic', 'ch:3')).toBeUndefined();
  });
});

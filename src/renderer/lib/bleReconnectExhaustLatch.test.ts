import { describe, expect, it } from 'vitest';

import {
  createBleReconnectExhaustLatch,
  prepareNobleYieldReleasedReconnectNudge,
  shouldIgnoreNobleDisconnectForReconnect,
  shouldSkipBleReconnectAfterExhaustion,
} from './bleReconnectExhaustLatch';
import { createRfReconnectController } from './rfReconnectController';

describe('bleReconnectExhaustLatch', () => {
  it('latches exhaust and clears on user reconnect path', () => {
    const latch = createBleReconnectExhaustLatch();
    expect(latch.isExhausted()).toBe(false);
    latch.markExhausted();
    expect(latch.isExhausted()).toBe(true);
    latch.clear();
    expect(latch.isExhausted()).toBe(false);
  });

  it('after markExhausted, onLinkLost would start owner unless latch skips', () => {
    const controller = createRfReconnectController({ logTag: 'test' });
    const latch = createBleReconnectExhaustLatch();

    const start = controller.onLinkLost();
    expect(start.shouldStartOwner).toBe(true);
    controller.markExhausted();
    expect(controller.isReconnecting).toBe(false);

    latch.markExhausted();

    const late = controller.onLinkLost();
    expect(late.shouldStartOwner).toBe(true);
    expect(
      shouldSkipBleReconnectAfterExhaustion({
        bleExhausted: latch.isExhausted(),
        isReconnecting: false,
      }),
    ).toBe(true);
  });

  it('exhaust → skip late lost → yield release clears latch for exactly one nudge', () => {
    const latch = createBleReconnectExhaustLatch();
    latch.markExhausted();
    expect(
      shouldSkipBleReconnectAfterExhaustion({
        bleExhausted: latch.isExhausted(),
        isReconnecting: false,
      }),
    ).toBe(true);

    expect(
      prepareNobleYieldReleasedReconnectNudge({
        latch,
        isReconnecting: true,
        bleConnectInProgress: false,
      }),
    ).toBe('skip-in-progress');
    expect(latch.isExhausted()).toBe(true);

    expect(
      prepareNobleYieldReleasedReconnectNudge({
        latch,
        isReconnecting: false,
        bleConnectInProgress: false,
      }),
    ).toBe('nudge');
    expect(latch.isExhausted()).toBe(false);
    expect(
      shouldSkipBleReconnectAfterExhaustion({
        bleExhausted: latch.isExhausted(),
        isReconnecting: false,
      }),
    ).toBe(false);
  });

  it('ignores Noble disconnect when already disconnected with connectionLoss', () => {
    expect(
      shouldIgnoreNobleDisconnectForReconnect({
        isReconnecting: false,
        connectionStatus: 'disconnected',
        connectionLoss: true,
      }),
    ).toBe(true);
    expect(
      shouldIgnoreNobleDisconnectForReconnect({
        isReconnecting: true,
        connectionStatus: 'disconnected',
        connectionLoss: true,
      }),
    ).toBe(false);
    expect(
      shouldIgnoreNobleDisconnectForReconnect({
        isReconnecting: false,
        connectionStatus: 'connected',
        connectionLoss: false,
      }),
    ).toBe(false);
  });
});

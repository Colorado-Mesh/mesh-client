import { describe, expect, it } from 'vitest';

import {
  RF_MAX_RECONNECT_ATTEMPTS,
  RF_MAX_RECONNECT_ATTEMPTS_BLE,
  RF_MAX_RECONNECT_ATTEMPTS_SERIAL,
  rfMaxReconnectAttemptsForTransport,
} from './rfReconnectShared';

describe('rfMaxReconnectAttemptsForTransport', () => {
  it.each(['http', 'tcp', null, undefined, 'other'] as const)(
    'uses default budget for %s',
    (transport) => {
      expect(rfMaxReconnectAttemptsForTransport(transport)).toBe(RF_MAX_RECONNECT_ATTEMPTS);
    },
  );

  it('uses a longer budget for BLE and serial', () => {
    expect(rfMaxReconnectAttemptsForTransport('ble')).toBe(RF_MAX_RECONNECT_ATTEMPTS_BLE);
    expect(rfMaxReconnectAttemptsForTransport('serial')).toBe(RF_MAX_RECONNECT_ATTEMPTS_SERIAL);
    expect(RF_MAX_RECONNECT_ATTEMPTS_BLE).toBeGreaterThan(RF_MAX_RECONNECT_ATTEMPTS);
    expect(RF_MAX_RECONNECT_ATTEMPTS_SERIAL).toBeGreaterThan(RF_MAX_RECONNECT_ATTEMPTS);
  });
});

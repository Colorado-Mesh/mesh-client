// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { BLUEZ_UNAVAILABLE_MESSAGE, formatBluezError } from './errors';

describe('formatBluezError', () => {
  it('maps connection failures to BlueZ unavailable', () => {
    expect(formatBluezError(new Error('connect ENOENT'))).toBe(BLUEZ_UNAVAILABLE_MESSAGE);
    expect(formatBluezError(new Error('org.freedesktop.DBus.Error.ServiceUnknown'))).toBe(
      BLUEZ_UNAVAILABLE_MESSAGE,
    );
  });

  it('passes through other messages', () => {
    expect(formatBluezError(new Error('Device not found: AA:BB:CC:DD:EE:FF'))).toBe(
      'Device not found: AA:BB:CC:DD:EE:FF',
    );
  });
});

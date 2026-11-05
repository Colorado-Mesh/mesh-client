// @vitest-environment node
import dbus from 'dbus-next';
import { describe, expect, it } from 'vitest';

import {
  BLUEZ_UNAVAILABLE_MESSAGE,
  formatBluezError,
  isBluezAlreadyExistsOrInProgress,
} from './errors';

describe('formatBluezError', () => {
  it('maps connection failures to BlueZ unavailable', () => {
    expect(formatBluezError(new Error('connect ENOENT'))).toBe(BLUEZ_UNAVAILABLE_MESSAGE);
    expect(formatBluezError(new Error('org.freedesktop.DBus.Error.ServiceUnknown'))).toBe(
      BLUEZ_UNAVAILABLE_MESSAGE,
    );
  });

  it('maps ServiceUnknown from DBusError.type', () => {
    expect(
      formatBluezError(new dbus.DBusError('org.freedesktop.DBus.Error.ServiceUnknown', 'gone')),
    ).toBe(BLUEZ_UNAVAILABLE_MESSAGE);
  });

  it('passes through other messages', () => {
    expect(formatBluezError(new Error('Device not found: AA:BB:CC:DD:EE:FF'))).toBe(
      'Device not found: AA:BB:CC:DD:EE:FF',
    );
  });
});

describe('isBluezAlreadyExistsOrInProgress', () => {
  it('matches DBusError.type', () => {
    expect(
      isBluezAlreadyExistsOrInProgress(new dbus.DBusError('org.bluez.Error.InProgress', 'busy')),
    ).toBe(true);
    expect(
      isBluezAlreadyExistsOrInProgress(new dbus.DBusError('org.bluez.Error.AlreadyExists', 'dup')),
    ).toBe(true);
  });

  it('falls back to message text', () => {
    expect(isBluezAlreadyExistsOrInProgress(new Error('InProgress'))).toBe(true);
    expect(isBluezAlreadyExistsOrInProgress(new Error('other'))).toBe(false);
  });
});

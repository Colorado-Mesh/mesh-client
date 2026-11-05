// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  assertPathBasedSystemBusAddress,
  isAbstractUnixBusAddress,
  resolveSystemBusAddress,
} from './systemBus';

describe('systemBus path-based contract', () => {
  it('treats the dbus-next default as path-based', () => {
    expect(resolveSystemBusAddress({})).toBe('unix:path=/var/run/dbus/system_bus_socket');
    expect(isAbstractUnixBusAddress(resolveSystemBusAddress({}))).toBe(false);
  });

  it('accepts Flatpak-style path addresses', () => {
    const address = 'unix:path=/run/dbus/system_bus_socket';
    expect(() => {
      assertPathBasedSystemBusAddress(address);
    }).not.toThrow();
    expect(isAbstractUnixBusAddress(address)).toBe(false);
  });

  it('rejects abstract system-bus addresses (usocket not built)', () => {
    expect(isAbstractUnixBusAddress('unix:abstract=/tmp/dbus-XXXX')).toBe(true);
    expect(() => {
      assertPathBasedSystemBusAddress('unix:abstract=/tmp/dbus-XXXX');
    }).toThrow(/path-based system bus/);
  });

  it('rejects abstract entries in multi-address DBUS_SYSTEM_BUS_ADDRESS', () => {
    expect(() => {
      assertPathBasedSystemBusAddress(
        'unix:path=/run/dbus/system_bus_socket;unix:abstract=/tmp/dbus-XXXX',
      );
    }).toThrow(/path-based system bus/);
  });
});

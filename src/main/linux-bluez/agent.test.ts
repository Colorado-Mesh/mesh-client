// @vitest-environment node
import dbus from 'dbus-next';
import { describe, expect, it } from 'vitest';

import { BluezPairingAgent } from './agent';

const DEVICE = '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF';
const OTHER = '/org/bluez/hci0/dev_11_22_33_44_55_66';

describe('BluezPairingAgent device scoping', () => {
  it('returns the PIN only for the target device', () => {
    const agent = new BluezPairingAgent('123456', DEVICE);
    expect(agent.RequestPinCode(DEVICE)).toBe('123456');
    expect(agent.RequestPasskey(DEVICE)).toBe(123456);
    expect(() => {
      agent.RequestConfirmation(DEVICE, 123456);
    }).not.toThrow();
    expect(() => {
      agent.RequestAuthorization(DEVICE);
    }).not.toThrow();
    expect(() => {
      agent.AuthorizeService(DEVICE, '0000');
    }).not.toThrow();
  });

  it('rejects callbacks for a different device', () => {
    const agent = new BluezPairingAgent('123456', DEVICE);
    expect(() => agent.RequestPinCode(OTHER)).toThrow(dbus.DBusError);
    expect(() => agent.RequestPasskey(OTHER)).toThrow(dbus.DBusError);
    expect(() => {
      agent.RequestConfirmation(OTHER, 1);
    }).toThrow(dbus.DBusError);
    expect(() => {
      agent.RequestAuthorization(OTHER);
    }).toThrow(dbus.DBusError);
    expect(() => {
      agent.AuthorizeService(OTHER, '0000');
    }).toThrow(dbus.DBusError);
  });
});

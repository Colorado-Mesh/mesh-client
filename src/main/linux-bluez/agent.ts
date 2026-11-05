/**
 * Temporary org.bluez.Agent1 for in-app PIN pairing (KeyboardOnly).
 * The PIN is supplied by ConnectionPanel and must never be logged.
 *
 * Callbacks are scoped to the device object path being paired; other devices
 * are rejected with org.bluez.Error.Rejected.
 */
import dbus from 'dbus-next';

const { interface: iface, DBusError } = dbus;

export const BLUEZ_AGENT_PATH = '/org/coloradomesh/meshclient/agent';
export const BLUEZ_AGENT_CAPABILITY = 'KeyboardOnly';

function ignoreDisplayArgs(...args: unknown[]): void {
  if (args.length === Number.NEGATIVE_INFINITY) {
    throw new Error('unreachable');
  }
}

export class BluezPairingAgent extends iface.Interface {
  constructor(
    private readonly pin: string | undefined,
    private readonly devicePath: string,
  ) {
    super('org.bluez.Agent1');
  }

  /** Reject agent requests that are not for the device currently being paired. */
  private assertTargetDevice(device: string): void {
    if (device !== this.devicePath) {
      throw new DBusError('org.bluez.Error.Rejected', 'unexpected device');
    }
  }

  Release(): void {
    // no-op — BlueZ releases the agent after UnregisterAgent
  }

  Cancel(): void {
    // no-op
  }

  RequestPinCode(device: string): string {
    this.assertTargetDevice(device);
    if (!this.pin) {
      throw new DBusError('org.bluez.Error.Rejected', 'PIN required');
    }
    return this.pin;
  }

  DisplayPinCode(device: string, pincode: string): void {
    this.assertTargetDevice(device);
    ignoreDisplayArgs(pincode);
    // Display-only; PIN already entered in-panel for KeyboardOnly flow.
  }

  RequestPasskey(device: string): number {
    this.assertTargetDevice(device);
    if (!this.pin) {
      throw new DBusError('org.bluez.Error.Rejected', 'PIN required');
    }
    const value = Number.parseInt(this.pin, 10);
    if (!Number.isInteger(value) || value < 0 || value > 999_999) {
      throw new DBusError('org.bluez.Error.Rejected', 'invalid passkey');
    }
    return value;
  }

  DisplayPasskey(device: string, passkey: number, entered: number): void {
    this.assertTargetDevice(device);
    ignoreDisplayArgs(passkey, entered);
    // Display-only; mesh-client does not surface remote-generated passkeys in-panel yet.
  }

  RequestConfirmation(device: string, passkey: number): void {
    this.assertTargetDevice(device);
    ignoreDisplayArgs(passkey);
    // Match prior bluetoothctl behavior (stdin "yes" on confirm/authorize).
  }

  RequestAuthorization(device: string): void {
    this.assertTargetDevice(device);
    // Accept — same as bluetoothctl "yes" on authorize.
  }

  AuthorizeService(device: string, uuid: string): void {
    this.assertTargetDevice(device);
    ignoreDisplayArgs(uuid);
    // Accept service authorization during pairing.
  }
}

BluezPairingAgent.configureMembers({
  methods: {
    Release: { inSignature: '', outSignature: '' },
    Cancel: { inSignature: '', outSignature: '' },
    RequestPinCode: { inSignature: 'o', outSignature: 's' },
    DisplayPinCode: { inSignature: 'os', outSignature: '' },
    RequestPasskey: { inSignature: 'o', outSignature: 'u' },
    DisplayPasskey: { inSignature: 'ouq', outSignature: '' },
    RequestConfirmation: { inSignature: 'ou', outSignature: '' },
    RequestAuthorization: { inSignature: 'o', outSignature: '' },
    AuthorizeService: { inSignature: 'os', outSignature: '' },
  },
});

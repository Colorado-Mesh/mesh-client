import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LAST_SERIAL_PORT_SIGNATURE_KEY,
  selectGrantedSerialPort,
  signaturesEqual,
} from './serialPortSignature';

function mockPort(opts: {
  portId?: string;
  usbVendorId?: number;
  usbProductId?: number;
}): SerialPort {
  return {
    getInfo: () => ({
      usbVendorId: opts.usbVendorId,
      usbProductId: opts.usbProductId,
    }),
    portId: opts.portId,
  } as SerialPort & { portId?: string };
}

describe('serialPortSignature', () => {
  afterEach(() => {
    localStorage.removeItem(LAST_SERIAL_PORT_SIGNATURE_KEY);
    vi.restoreAllMocks();
  });

  it('selectGrantedSerialPort matches by portId when present', () => {
    const a = mockPort({ portId: 'id-a', usbVendorId: 1, usbProductId: 2 });
    const b = mockPort({ portId: 'id-b', usbVendorId: 9, usbProductId: 9 });
    expect(selectGrantedSerialPort([a, b], 'id-b')).toBe(b);
  });

  it('selectGrantedSerialPort matches by saved signature when portId missing', () => {
    localStorage.setItem(
      LAST_SERIAL_PORT_SIGNATURE_KEY,
      JSON.stringify({ usbVendorId: 4292, usbProductId: 60000 }),
    );
    const wrong = mockPort({ usbVendorId: 1086, usbProductId: 39481 });
    const right = mockPort({ usbVendorId: 4292, usbProductId: 60000 });
    expect(selectGrantedSerialPort([wrong, right], 'stale-id-that-does-not-exist')).toBe(right);
  });

  it('selectGrantedSerialPort throws when nothing matches', () => {
    localStorage.setItem(
      LAST_SERIAL_PORT_SIGNATURE_KEY,
      JSON.stringify({ usbVendorId: 1, usbProductId: 1 }),
    );
    const ports = [mockPort({ usbVendorId: 2, usbProductId: 2 })];
    expect(() => selectGrantedSerialPort(ports, null)).toThrow(
      /No matching previously used serial device found/,
    );
  });

  it('signaturesEqual compares bluetoothServiceClassId', () => {
    expect(
      signaturesEqual({ bluetoothServiceClassId: 'abc' }, { bluetoothServiceClassId: 'abc' }),
    ).toBe(true);
    expect(
      signaturesEqual({ bluetoothServiceClassId: 'abc' }, { bluetoothServiceClassId: 'xyz' }),
    ).toBe(false);
  });
});

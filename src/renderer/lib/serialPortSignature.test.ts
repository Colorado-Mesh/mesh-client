import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getPortSignature,
  isAmbiguousSerialPortMatchError,
  LAST_SERIAL_PORT_SIGNATURE_KEY,
  selectGrantedSerialPort,
  SERIAL_MULTIPLE_MATCH_ERROR,
  SERIAL_NO_MATCH_ERROR,
  signaturesEqual,
} from './serialPortSignature';

function mockPort(opts: {
  portId?: string;
  usbVendorId?: number;
  usbProductId?: number;
  serialNumber?: string;
  bluetoothServiceClassId?: string;
}): SerialPort {
  return {
    getInfo: () => ({
      usbVendorId: opts.usbVendorId,
      usbProductId: opts.usbProductId,
      serialNumber: opts.serialNumber,
      bluetoothServiceClassId: opts.bluetoothServiceClassId,
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

  it('selectGrantedSerialPort throws when nothing matches and logs fingerprints', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    localStorage.setItem(
      LAST_SERIAL_PORT_SIGNATURE_KEY,
      JSON.stringify({ usbVendorId: 1, usbProductId: 1 }),
    );
    const ports = [mockPort({ portId: 'p1', usbVendorId: 2, usbProductId: 2 })];
    expect(() => selectGrantedSerialPort(ports, null)).toThrow(SERIAL_NO_MATCH_ERROR);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('"reason":"no-match"'));
  });

  it('selectGrantedSerialPort throws when multiple ports match the saved signature', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    localStorage.setItem(
      LAST_SERIAL_PORT_SIGNATURE_KEY,
      JSON.stringify({ usbVendorId: 4292, usbProductId: 60016 }),
    );
    const standard = mockPort({
      portId: 'com12',
      usbVendorId: 4292,
      usbProductId: 60016,
      serialNumber: 'shared',
    });
    const enhanced = mockPort({
      portId: 'com13',
      usbVendorId: 4292,
      usbProductId: 60016,
      serialNumber: 'shared',
    });
    expect(() => selectGrantedSerialPort([standard, enhanced], 'stale-id')).toThrow(
      SERIAL_MULTIPLE_MATCH_ERROR,
    );
    expect(isAmbiguousSerialPortMatchError(new Error(SERIAL_MULTIPLE_MATCH_ERROR))).toBe(true);
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('"reason":"ambiguous"'));
  });

  it('selectGrantedSerialPort disambiguates by serialNumber when both sides expose it', () => {
    localStorage.setItem(
      LAST_SERIAL_PORT_SIGNATURE_KEY,
      JSON.stringify({
        usbVendorId: 4292,
        usbProductId: 60016,
        serialNumber: 'right-sn',
      }),
    );
    const wrong = mockPort({
      usbVendorId: 4292,
      usbProductId: 60016,
      serialNumber: 'wrong-sn',
    });
    const right = mockPort({
      usbVendorId: 4292,
      usbProductId: 60016,
      serialNumber: 'right-sn',
    });
    expect(selectGrantedSerialPort([wrong, right], null)).toBe(right);
  });

  it('getPortSignature includes serialNumber when present', () => {
    const port = mockPort({
      usbVendorId: 1,
      usbProductId: 2,
      serialNumber: ' ABC ',
    });
    expect(getPortSignature(port)).toEqual({
      usbVendorId: 1,
      usbProductId: 2,
      bluetoothServiceClassId: undefined,
      serialNumber: 'ABC',
    });
  });

  it('signaturesEqual compares bluetoothServiceClassId', () => {
    expect(
      signaturesEqual({ bluetoothServiceClassId: 'abc' }, { bluetoothServiceClassId: 'abc' }),
    ).toBe(true);
    expect(
      signaturesEqual({ bluetoothServiceClassId: 'abc' }, { bluetoothServiceClassId: 'xyz' }),
    ).toBe(false);
  });

  it('signaturesEqual ignores missing serialNumber on one side', () => {
    expect(
      signaturesEqual(
        { usbVendorId: 1, usbProductId: 2, serialNumber: 'only-a' },
        { usbVendorId: 1, usbProductId: 2 },
      ),
    ).toBe(true);
  });

  it('signaturesEqual rejects differing serialNumbers when both present', () => {
    expect(
      signaturesEqual(
        { usbVendorId: 1, usbProductId: 2, serialNumber: 'a' },
        { usbVendorId: 1, usbProductId: 2, serialNumber: 'b' },
      ),
    ).toBe(false);
  });
});

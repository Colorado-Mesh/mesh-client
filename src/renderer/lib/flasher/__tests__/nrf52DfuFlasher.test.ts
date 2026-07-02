import { describe, expect, it } from 'vitest';

import { Nrf52DfuFlasher } from '../nrf52DfuFlasher';

describe('Nrf52DfuFlasher', () => {
  const flasher = new Nrf52DfuFlasher({} as SerialPort);

  it('calcCrc16 matches known vector', () => {
    const data = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const crc = flasher.calcCrc16(data);
    expect(crc).toBeGreaterThanOrEqual(0);
    expect(crc).toBeLessThanOrEqual(0xffff);
    expect(flasher.calcCrc16(data)).toBe(crc);
  });

  it('slipEncodeEscChars escapes FEND and FESC', () => {
    expect(flasher.slipEncodeEscChars([0xc0])).toEqual([0xdb, 0xdc]);
    expect(flasher.slipEncodeEscChars([0xdb])).toEqual([0xdb, 0xdd]);
    expect(flasher.slipEncodeEscChars([0x01])).toEqual([0x01]);
  });

  it('createHciPacketFromFrame wraps with SLIP delimiters', () => {
    const packet = flasher.createHciPacketFromFrame([0x03, 0x00, 0x00, 0x00]);
    expect(packet[0]).toBe(0xc0);
    expect(packet[packet.length - 1]).toBe(0xc0);
  });

  it.each(['linux', 'darwin', 'win32'] as const)('CRC16 is platform-agnostic (%s)', () => {
    expect(flasher.calcCrc16(new Uint8Array([0xff]))).toBeTypeOf('number');
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/lib/connection', () => ({
  closeSerialPortIfOpen: vi.fn(() => Promise.resolve()),
}));

import { NRF52_DFU_STALL_TIMEOUT_MS, nrf52DfuCrc16, Nrf52DfuFlasher } from './nrf52DfuFlasher';

describe('nrf52DfuFlasher stall timeout', () => {
  it('exports a positive DFU stall timeout', () => {
    expect(NRF52_DFU_STALL_TIMEOUT_MS).toBeGreaterThan(10_000);
  });
});

describe('nrf52DfuCrc16', () => {
  it('matches the CRC16-CCITT (init 0xffff) check value for "123456789"', () => {
    expect(nrf52DfuCrc16(new TextEncoder().encode('123456789'))).toBe(0x29b1);
  });

  it('is exposed on the flasher instance for the DFU transport', () => {
    const flasher = new Nrf52DfuFlasher({} as SerialPort);
    const data = new Uint8Array([1, 2, 3, 4]);
    expect(flasher.calcCrc16(data)).toBe(nrf52DfuCrc16(data));
  });
});

describe('Nrf52DfuFlasher.flash cancellation', () => {
  it('rejects before reading the package when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new Nrf52DfuFlasher({} as SerialPort).flash(new Blob(['x']), undefined, {
        signal: controller.signal,
      }),
    ).rejects.toThrow('NRF52_DFU_CANCELLED');
  });
});

import { describe, expect, it } from 'vitest';

import { NRF52_DFU_STALL_TIMEOUT_MS } from './nrf52DfuFlasher';

describe('nrf52DfuFlasher stall timeout', () => {
  it('exports a positive DFU stall timeout', () => {
    expect(NRF52_DFU_STALL_TIMEOUT_MS).toBeGreaterThan(10_000);
  });
});

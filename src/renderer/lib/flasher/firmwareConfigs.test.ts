import { describe, expect, it } from 'vitest';

import { FIRMWARE_PRODUCTS } from './firmwareConfigs';

describe('firmwareConfigs', () => {
  it('assigns unique catalogKey to every product', () => {
    const keys = FIRMWARE_PRODUCTS.map((p) => p.catalogKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('allows duplicate EEPROM product ids for distinct catalog entries', () => {
    const t3s3 = FIRMWARE_PRODUCTS.find((p) => p.catalogKey === 'lilygo-lora-t3s3');
    const rnode = FIRMWARE_PRODUCTS.find((p) => p.catalogKey === 'rnode');
    expect(t3s3?.id).toBe(0x03);
    expect(rnode?.id).toBe(0x03);
    expect(t3s3?.catalogKey).not.toBe(rnode?.catalogKey);
  });
});

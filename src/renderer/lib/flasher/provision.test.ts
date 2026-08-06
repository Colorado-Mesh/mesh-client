import { beforeEach, describe, expect, it, vi } from 'vitest';

import { md5Bytes } from './md5';
import {
  PROVISION_VERIFY_FAILED,
  PROVISION_WIPE_REQUIRED,
  provisionEepromAndVerify,
} from './provision';
import type { RNode } from './rnode';
import { ROM, Rom } from './rom';
import type { RNodeModel, RNodeProduct } from './types';

const product: RNodeProduct = {
  name: 'Test',
  catalogKey: 'test',
  id: ROM.PRODUCT_RAK4631,
  platform: ROM.PLATFORM_NRF52,
  models: [],
};

const model: RNodeModel = {
  id: ROM.MODEL_11,
  name: 'Model 11',
};

function createMockRnode(initialEeprom?: number[]): RNode & { eeprom: number[] } {
  const eeprom = initialEeprom ?? new Array(256).fill(0);
  return {
    eeprom,
    writeRom: vi.fn((addr: number, value: number) => {
      eeprom[addr] = value & 0xff;
      return Promise.resolve();
    }),
    getRomAsObject: vi.fn(() => Promise.resolve(new Rom([...eeprom]))),
    reset: vi.fn(() => Promise.resolve()),
  } as unknown as RNode & { eeprom: number[] };
}

function seedProvisionedEeprom(): number[] {
  const productId = ROM.PRODUCT_RAK4631;
  const modelId = ROM.MODEL_11;
  const hw = 0x01;
  const serial = [0, 0, 0, 1];
  const made = [0x65, 0x43, 0x21, 0x00];
  const checksum = md5Bytes([productId, modelId, hw, ...serial, ...made]);
  const eeprom = new Array(256).fill(0);
  eeprom[ROM.ADDR_PRODUCT] = productId;
  eeprom[ROM.ADDR_MODEL] = modelId;
  eeprom[ROM.ADDR_HW_REV] = hw;
  serial.forEach((b, i) => {
    eeprom[ROM.ADDR_SERIAL + i] = b;
  });
  made.forEach((b, i) => {
    eeprom[ROM.ADDR_MADE + i] = b;
  });
  checksum.forEach((b, i) => {
    eeprom[ROM.ADDR_CHKSUM + i] = b;
  });
  eeprom[ROM.ADDR_INFO_LOCK] = ROM.INFO_LOCK_BYTE;
  return eeprom;
}

describe('provisionEepromAndVerify', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('returns already_provisioned when EEPROM identity is valid', async () => {
    const rnode = createMockRnode(seedProvisionedEeprom());
    await expect(provisionEepromAndVerify(rnode, { product, model })).resolves.toBe(
      'already_provisioned',
    );
    expect(rnode.writeRom).not.toHaveBeenCalled();
  });

  it('writes EEPROM and verifies provisioned identity', async () => {
    const rnode = createMockRnode();
    await expect(provisionEepromAndVerify(rnode, { product, model })).resolves.toBe('provisioned');
    const details = new Rom(rnode.eeprom).parse();
    expect(details?.is_provisioned).toBe(true);
  });

  it('throws PROVISION_WIPE_REQUIRED when locked with invalid checksum', async () => {
    const eeprom = new Array(256).fill(0);
    eeprom[ROM.ADDR_INFO_LOCK] = ROM.INFO_LOCK_BYTE;
    eeprom[ROM.ADDR_PRODUCT] = ROM.PRODUCT_RAK4631;
    const rnode = createMockRnode(eeprom);
    await expect(provisionEepromAndVerify(rnode, { product, model })).rejects.toThrow(
      PROVISION_WIPE_REQUIRED,
    );
    expect(rnode.writeRom).not.toHaveBeenCalled();
  });

  it('throws PROVISION_VERIFY_FAILED when writes do not stick', async () => {
    const rnode = createMockRnode();
    rnode.writeRom = vi.fn(() => Promise.resolve());
    await expect(provisionEepromAndVerify(rnode, { product, model })).rejects.toThrow(
      PROVISION_VERIFY_FAILED,
    );
  });
});

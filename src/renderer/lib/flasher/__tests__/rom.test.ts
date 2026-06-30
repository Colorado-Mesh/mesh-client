import { describe, expect, it } from 'vitest';

import { md5Bytes } from '../md5';
import { ROM, Rom } from '../rom';

describe('md5Bytes', () => {
  it('returns 16-byte digest for device info bytes', () => {
    const digest = md5Bytes([0x10, 0x11, 0x01, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
    expect(digest).toHaveLength(16);
  });
});

describe('Rom', () => {
  it('parse returns null when info lock byte is unset', () => {
    const eeprom = new Array(256).fill(0);
    const rom = new Rom(eeprom);
    expect(rom.parse()).toBeNull();
  });

  it('getCalculatedChecksum matches stored checksum when provisioned', () => {
    const product = ROM.PRODUCT_RAK4631;
    const model = ROM.MODEL_11;
    const hw = 0x01;
    const serial = [0, 0, 0, 1];
    const made = [0x65, 0x43, 0x21, 0x00];
    const checksum = md5Bytes([product, model, hw, ...serial, ...made]);

    const eeprom = new Array(256).fill(0);
    eeprom[ROM.ADDR_PRODUCT] = product;
    eeprom[ROM.ADDR_MODEL] = model;
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

    const rom = new Rom(eeprom);
    const details = rom.parse();
    expect(details?.is_provisioned).toBe(true);
    expect(details?.checksum).toBe(details?.calculated_checksum);
  });

  it('marks unprovisioned when checksum mismatches', () => {
    const eeprom = new Array(256).fill(0);
    eeprom[ROM.ADDR_PRODUCT] = ROM.PRODUCT_RAK4631;
    eeprom[ROM.ADDR_MODEL] = ROM.MODEL_11;
    eeprom[ROM.ADDR_HW_REV] = 0x01;
    eeprom[ROM.ADDR_INFO_LOCK] = ROM.INFO_LOCK_BYTE;
    const rom = new Rom(eeprom);
    const details = rom.parse();
    expect(details?.is_provisioned).toBe(false);
  });
});

import { bytesToHex, unpackUInt32BE } from './binaryUtils';
import { md5Bytes } from './md5';
import type { RomDetails } from './types';

export const ROM = {
  PLATFORM_AVR: 0x90,
  PLATFORM_ESP32: 0x80,
  PLATFORM_NRF52: 0x70,

  MCU_1284P: 0x91,
  MCU_2560: 0x92,
  MCU_ESP32: 0x81,
  MCU_NRF52: 0x71,

  PRODUCT_RAK4631: 0x10,
  MODEL_11: 0x11,
  MODEL_12: 0x12,

  PRODUCT_RNODE: 0x03,
  MODEL_A1: 0xa1,
  MODEL_A6: 0xa6,
  MODEL_A4: 0xa4,
  MODEL_A9: 0xa9,
  MODEL_A3: 0xa3,
  MODEL_A8: 0xa8,
  MODEL_A2: 0xa2,
  MODEL_A7: 0xa7,
  MODEL_A5: 0xa5,
  MODEL_AA: 0xaa,
  MODEL_AC: 0xac,

  PRODUCT_T32_10: 0xb2,
  MODEL_BA: 0xba,
  MODEL_BB: 0xbb,

  PRODUCT_T32_20: 0xb0,
  MODEL_B3: 0xb3,
  MODEL_B8: 0xb8,

  PRODUCT_T32_21: 0xb1,
  MODEL_B4: 0xb4,
  MODEL_B9: 0xb9,
  MODEL_B4_TCXO: 0x04,
  MODEL_B9_TCXO: 0x09,

  PRODUCT_H32_V2: 0xc0,
  MODEL_C4: 0xc4,
  MODEL_C9: 0xc9,

  PRODUCT_H32_V3: 0xc1,
  MODEL_C5: 0xc5,
  MODEL_CA: 0xca,

  PRODUCT_H32_V4: 0xc3,
  MODEL_C8: 0xc8,

  PRODUCT_HELTEC_T114: 0xc2,
  MODEL_C6: 0xc6,
  MODEL_C7: 0xc7,

  PRODUCT_TBEAM: 0xe0,
  MODEL_E4: 0xe4,
  MODEL_E9: 0xe9,
  MODEL_E3: 0xe3,
  MODEL_E8: 0xe8,

  PRODUCT_TBEAM_S_V1: 0xea,
  MODEL_DB: 0xdb,
  MODEL_DC: 0xdc,

  PRODUCT_TDECK: 0xd0,
  MODEL_D4: 0xd4,
  MODEL_D9: 0xd9,

  PRODUCT_TECHO: 0x15,
  MODEL_16: 0x16,
  MODEL_17: 0x17,

  PRODUCT_HMBRW: 0xf0,
  MODEL_FF: 0xff,
  MODEL_FE: 0xfe,

  ADDR_PRODUCT: 0x00,
  ADDR_MODEL: 0x01,
  ADDR_HW_REV: 0x02,
  ADDR_SERIAL: 0x03,
  ADDR_MADE: 0x07,
  ADDR_CHKSUM: 0x0b,
  ADDR_SIGNATURE: 0x1b,
  ADDR_INFO_LOCK: 0x9b,
  ADDR_CONF_SF: 0x9c,
  ADDR_CONF_CR: 0x9d,
  ADDR_CONF_TXP: 0x9e,
  ADDR_CONF_BW: 0x9f,
  ADDR_CONF_FREQ: 0xa3,
  ADDR_CONF_OK: 0xa7,

  INFO_LOCK_BYTE: 0x73,
  CONF_OK_BYTE: 0x73,

  BOARD_RNODE: 0x31,
  BOARD_HMBRW: 0x32,
  BOARD_TBEAM: 0x33,
  BOARD_HUZZAH32: 0x34,
  BOARD_GENERIC_ESP32: 0x35,
  BOARD_LORA32_V2_0: 0x36,
  BOARD_LORA32_V2_1: 0x37,
  BOARD_RAK4631: 0x51,

  MANUAL_FLASH_MODELS: [0xa1, 0xa6] as const,
} as const;

export class Rom {
  constructor(private readonly eeprom: number[]) {}

  getProduct(): number {
    return this.eeprom[ROM.ADDR_PRODUCT] ?? 0;
  }

  getModel(): number {
    return this.eeprom[ROM.ADDR_MODEL] ?? 0;
  }

  getHardwareRevision(): number {
    return this.eeprom[ROM.ADDR_HW_REV] ?? 0;
  }

  getSerialNumber(): number[] {
    return [
      this.eeprom[ROM.ADDR_SERIAL] ?? 0,
      this.eeprom[ROM.ADDR_SERIAL + 1] ?? 0,
      this.eeprom[ROM.ADDR_SERIAL + 2] ?? 0,
      this.eeprom[ROM.ADDR_SERIAL + 3] ?? 0,
    ];
  }

  getMade(): number[] {
    return [
      this.eeprom[ROM.ADDR_MADE] ?? 0,
      this.eeprom[ROM.ADDR_MADE + 1] ?? 0,
      this.eeprom[ROM.ADDR_MADE + 2] ?? 0,
      this.eeprom[ROM.ADDR_MADE + 3] ?? 0,
    ];
  }

  getChecksum(): number[] {
    const checksum: number[] = [];
    for (let i = 0; i < 16; i++) {
      checksum.push(this.eeprom[ROM.ADDR_CHKSUM + i] ?? 0);
    }
    return checksum;
  }

  getSignature(): number[] {
    const signature: number[] = [];
    for (let i = 0; i < 128; i++) {
      signature.push(this.eeprom[ROM.ADDR_SIGNATURE + i] ?? 0);
    }
    return signature;
  }

  getCalculatedChecksum(): number[] {
    return md5Bytes([
      this.getProduct(),
      this.getModel(),
      this.getHardwareRevision(),
      ...this.getSerialNumber(),
      ...this.getMade(),
    ]);
  }

  getConfiguredSpreadingFactor(): number {
    return this.eeprom[ROM.ADDR_CONF_SF] ?? 0;
  }

  getConfiguredCodingRate(): number {
    return this.eeprom[ROM.ADDR_CONF_CR] ?? 0;
  }

  getConfiguredTxPower(): number {
    return this.eeprom[ROM.ADDR_CONF_TXP] ?? 0;
  }

  getConfiguredFrequency(): number {
    return (
      ((this.eeprom[ROM.ADDR_CONF_FREQ] ?? 0) << 24) |
      ((this.eeprom[ROM.ADDR_CONF_FREQ + 1] ?? 0) << 16) |
      ((this.eeprom[ROM.ADDR_CONF_FREQ + 2] ?? 0) << 8) |
      (this.eeprom[ROM.ADDR_CONF_FREQ + 3] ?? 0)
    );
  }

  getConfiguredBandwidth(): number {
    return (
      ((this.eeprom[ROM.ADDR_CONF_BW] ?? 0) << 24) |
      ((this.eeprom[ROM.ADDR_CONF_BW + 1] ?? 0) << 16) |
      ((this.eeprom[ROM.ADDR_CONF_BW + 2] ?? 0) << 8) |
      (this.eeprom[ROM.ADDR_CONF_BW + 3] ?? 0)
    );
  }

  isInfoLocked(): boolean {
    return this.eeprom[ROM.ADDR_INFO_LOCK] === ROM.INFO_LOCK_BYTE;
  }

  isConfigured(): boolean {
    return this.eeprom[ROM.ADDR_CONF_OK] === ROM.CONF_OK_BYTE;
  }

  parse(): RomDetails | null {
    if (!this.isInfoLocked()) {
      return null;
    }

    const checksumHex = bytesToHex(this.getChecksum());
    const calculatedChecksumHex = bytesToHex(this.getCalculatedChecksum());
    const signatureHex = bytesToHex(this.getSignature());

    let details: RomDetails = {
      is_provisioned: true,
      is_configured: this.isConfigured(),
      product: this.getProduct(),
      model: this.getModel(),
      hardware_revision: this.getHardwareRevision(),
      serial_number: unpackUInt32BE(this.getSerialNumber()),
      made: unpackUInt32BE(this.getMade()),
      checksum: checksumHex,
      calculated_checksum: calculatedChecksumHex,
      signature: signatureHex,
    };

    if (details.is_configured) {
      details = {
        ...details,
        configured_spreading_factor: this.getConfiguredSpreadingFactor(),
        configured_coding_rate: this.getConfiguredCodingRate(),
        configured_tx_power: this.getConfiguredTxPower(),
        configured_frequency: this.getConfiguredFrequency(),
        configured_bandwidth: this.getConfiguredBandwidth(),
      };
    }

    if (details.checksum !== details.calculated_checksum) {
      details.is_provisioned = false;
    }

    return details;
  }
}

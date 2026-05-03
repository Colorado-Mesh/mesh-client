// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  ATT_MTU_DEFAULT,
  attMtuOrDefault,
  BLE_TO_RADIO_PAYLOAD_CAP,
  maxWriteRequestPayloadBytes,
} from './bleAttWriteLimit';

describe('attMtuOrDefault', () => {
  it('uses 23 for null, undefined, NaN', () => {
    expect(attMtuOrDefault(null)).toBe(ATT_MTU_DEFAULT);
    expect(attMtuOrDefault(undefined)).toBe(ATT_MTU_DEFAULT);
    expect(attMtuOrDefault(Number.NaN)).toBe(ATT_MTU_DEFAULT);
  });

  it('coerces Darwin/Noble quirk 20 and other sub-23 values to 23', () => {
    expect(attMtuOrDefault(20)).toBe(ATT_MTU_DEFAULT);
    expect(attMtuOrDefault(22)).toBe(ATT_MTU_DEFAULT);
    expect(attMtuOrDefault(1)).toBe(ATT_MTU_DEFAULT);
  });

  it('passes through valid negotiated MTU', () => {
    expect(attMtuOrDefault(23)).toBe(23);
    expect(attMtuOrDefault(185)).toBe(185);
    expect(attMtuOrDefault(247)).toBe(247);
  });

  it('floors non-integers and caps at ATT_MTU_MAX', () => {
    expect(attMtuOrDefault(247.7)).toBe(247);
    expect(attMtuOrDefault(9999)).toBe(517);
  });
});

describe('maxWriteRequestPayloadBytes', () => {
  it('default ATT gives 20-byte write payload', () => {
    expect(maxWriteRequestPayloadBytes(null)).toBe(20);
    expect(maxWriteRequestPayloadBytes(20)).toBe(20);
  });

  it('247 ATT MTU yields 244 payload capped below 512', () => {
    expect(maxWriteRequestPayloadBytes(247)).toBe(244);
  });

  it('caps at BLE_TO_RADIO_PAYLOAD_CAP when ATT allows more', () => {
    expect(maxWriteRequestPayloadBytes(517)).toBe(BLE_TO_RADIO_PAYLOAD_CAP);
  });
});

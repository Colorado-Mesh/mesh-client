// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  isMeshtasticDefaultPublicPsk,
  MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES,
} from './meshtasticDefaultPublicPsk';

describe('isMeshtasticDefaultPublicPsk', () => {
  it('returns true for AQ== padded 16-byte key material', () => {
    expect(isMeshtasticDefaultPublicPsk(MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES)).toBe(true);
    expect(isMeshtasticDefaultPublicPsk(new Uint8Array([0x01]))).toBe(true);
  });

  it('returns false for empty buffer', () => {
    expect(isMeshtasticDefaultPublicPsk(new Uint8Array())).toBe(false);
  });

  it('returns false for non-default PSK', () => {
    expect(isMeshtasticDefaultPublicPsk(new Uint8Array(16).fill(0xff))).toBe(false);
    expect(isMeshtasticDefaultPublicPsk(new Uint8Array([0x02]))).toBe(false);
  });
});

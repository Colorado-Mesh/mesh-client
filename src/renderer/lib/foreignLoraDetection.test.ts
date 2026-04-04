import { describe, expect, it } from 'vitest';

import {
  classifyPayload,
  classifyProximity,
  containsMeshCorePattern,
  extractMeshtasticSenderId,
  extractRssiSnr,
  RollingRateCounter,
} from './foreignLoraDetection';

describe('containsMeshCorePattern', () => {
  it('returns false when message has no dropped/crc context', () => {
    expect(containsMeshCorePattern('normal log line')).toBe(false);
    expect(containsMeshCorePattern('3c 00 01 hex bytes')).toBe(false);
    expect(containsMeshCorePattern('RX <payload>')).toBe(false);
  });

  it('returns false when message has dropped/crc but no 0x3c pattern', () => {
    expect(containsMeshCorePattern('packet dropped rssi=-90')).toBe(false);
    expect(containsMeshCorePattern('CRC err snr=2')).toBe(false);
  });

  it('returns true for packet dropped with hex 3c pattern', () => {
    expect(containsMeshCorePattern('packet dropped 3c 00 01 rssi=-85')).toBe(true);
    expect(containsMeshCorePattern('Packet dropped 3c 4a 2b')).toBe(true);
    expect(containsMeshCorePattern('packet dropped 3c0001')).toBe(true);
    expect(containsMeshCorePattern('packet dropped 0x3c 0x00 0x01')).toBe(true);
  });

  it('returns true for CRC err with hex 3c pattern', () => {
    expect(containsMeshCorePattern('crc err 3c 00 01')).toBe(true);
    expect(containsMeshCorePattern('CRC error 0x3c 0x12 0x34')).toBe(true);
  });

  it('returns true for dropped/crc with ASCII < (0x3c)', () => {
    expect(containsMeshCorePattern('packet dropped <garbage rssi=-90')).toBe(true);
    expect(containsMeshCorePattern('crc err <payload')).toBe(true);
  });

  it('returns true for preamble/decode-fail wording with 0x3c (common firmware log style)', () => {
    expect(containsMeshCorePattern('Preamble detected but CRC failed. First byte: 0x3c')).toBe(
      true,
    );
    expect(containsMeshCorePattern('decode failed 3c 00 01')).toBe(true);
    expect(containsMeshCorePattern('CRC fail <')).toBe(true);
  });

  it('returns false for preamble/decode-fail without 0x3c or <', () => {
    expect(
      containsMeshCorePattern('Preamble detected but CRC/decode failed (non-Meshtastic LoRa)'),
    ).toBe(false);
  });
});

describe('extractRssiSnr', () => {
  it('extracts rssi and snr with = separator', () => {
    const out = extractRssiSnr('rssi=-85 snr=3.2');
    expect(out.rssi).toBe(-85);
    expect(out.snr).toBe(3.2);
  });

  it('extracts rssi and snr with : separator', () => {
    const out = extractRssiSnr('rssi: -90 snr: 2.5');
    expect(out.rssi).toBe(-90);
    expect(out.snr).toBe(2.5);
  });

  it('extracts when only one is present', () => {
    expect(extractRssiSnr('rssi=-95')).toEqual({ rssi: -95, snr: undefined });
    expect(extractRssiSnr('snr=1.0')).toEqual({ rssi: undefined, snr: 1 });
  });

  it('returns undefined when neither present', () => {
    expect(extractRssiSnr('packet dropped 3c 00')).toEqual({
      rssi: undefined,
      snr: undefined,
    });
  });

  it('is case insensitive', () => {
    expect(extractRssiSnr('RSSI=-80 SNR=4.5')).toEqual({ rssi: -80, snr: 4.5 });
  });
});

describe('classifyPayload', () => {
  it('classifies MeshCore by first byte 0x3c', () => {
    expect(classifyPayload(new Uint8Array([0x3c, 0x00, 0x01]))).toBe('meshcore');
    expect(classifyPayload(new Uint8Array([0x3c]))).toBe('meshcore');
  });

  it('classifies Meshtastic with 8-byte packet and valid IDs (MeshCore always starts with 0x3c)', () => {
    const header = new Uint8Array(8);
    const dest = 0x01020304;
    const sender = 0x05060708;
    header[0] = dest & 0xff;
    header[1] = (dest >> 8) & 0xff;
    header[2] = (dest >> 16) & 0xff;
    header[3] = (dest >> 24) & 0xff;
    header[4] = sender & 0xff;
    header[5] = (sender >> 8) & 0xff;
    header[6] = (sender >> 16) & 0xff;
    header[7] = (sender >> 24) & 0xff;
    expect(classifyPayload(header)).toBe('meshtastic');
  });

  it('classifies Meshtastic with 16-byte header and valid flags (hop_start=3, hop_limit=3)', () => {
    const packet = new Uint8Array(16);
    const dest = 0x01020304;
    const sender = 0x05060708;
    packet[0] = dest & 0xff;
    packet[1] = (dest >> 8) & 0xff;
    packet[2] = (dest >> 16) & 0xff;
    packet[3] = (dest >> 24) & 0xff;
    packet[4] = sender & 0xff;
    packet[5] = (sender >> 8) & 0xff;
    packet[6] = (sender >> 16) & 0xff;
    packet[7] = (sender >> 24) & 0xff;
    // byte 12: flags — hop_start=3 (bits [7:5]=011), hop_limit=3 (bits [2:0]=011) → 0x63
    packet[12] = 0x63;
    expect(classifyPayload(packet)).toBe('meshtastic');
  });

  it('returns unknown-lora for 16-byte packet with invalid flags (hop_limit > hop_start)', () => {
    const packet = new Uint8Array(16);
    const dest = 0x01020304;
    const sender = 0x05060708;
    packet[0] = dest & 0xff;
    packet[1] = (dest >> 8) & 0xff;
    packet[2] = (dest >> 16) & 0xff;
    packet[3] = (dest >> 24) & 0xff;
    packet[4] = sender & 0xff;
    packet[5] = (sender >> 8) & 0xff;
    packet[6] = (sender >> 16) & 0xff;
    packet[7] = (sender >> 24) & 0xff;
    // byte 12: flags — hop_start=1 (bits [7:5]=001), hop_limit=3 (bits [2:0]=011) → 0x23
    // hop_limit(3) > hop_start(1): structurally impossible in a real Meshtastic packet
    packet[12] = 0x23;
    expect(classifyPayload(packet)).toBe('unknown-lora');
  });

  it('classifies Meshtastic for 8-15 byte packets with valid IDs (short MeshCore frames start with 0x3c)', () => {
    const dest = 0x01020304;
    const sender = 0x05060708;
    for (const len of [8, 15]) {
      const packet = new Uint8Array(len);
      packet[0] = dest & 0xff;
      packet[1] = (dest >> 8) & 0xff;
      packet[2] = (dest >> 16) & 0xff;
      packet[3] = (dest >> 24) & 0xff;
      packet[4] = sender & 0xff;
      packet[5] = (sender >> 8) & 0xff;
      packet[6] = (sender >> 16) & 0xff;
      packet[7] = (sender >> 24) & 0xff;
      expect(classifyPayload(packet)).toBe('meshtastic');
    }
  });

  it('classifies Meshtastic for 16-byte packet with hop_start=0 hop_limit=0 (direct-only device)', () => {
    const packet = new Uint8Array(16);
    const dest = 0x01020304;
    const sender = 0x05060708;
    packet[0] = dest & 0xff;
    packet[1] = (dest >> 8) & 0xff;
    packet[2] = (dest >> 16) & 0xff;
    packet[3] = (dest >> 24) & 0xff;
    packet[4] = sender & 0xff;
    packet[5] = (sender >> 8) & 0xff;
    packet[6] = (sender >> 16) & 0xff;
    packet[7] = (sender >> 24) & 0xff;
    // byte 12: flags — hop_start=0 (bits [7:5]=000), hop_limit=0 (bits [2:0]=000) → 0x00
    // Valid for Meshtastic direct-only devices (hop_limit=0 set intentionally).
    packet[12] = 0x00;
    expect(classifyPayload(packet)).toBe('meshtastic');
  });

  it('returns unknown-lora for short or non-matching payload', () => {
    expect(classifyPayload(new Uint8Array([0x00]))).toBe('unknown-lora');
    expect(classifyPayload(new Uint8Array([0x0a, 0, 0, 0, 0, 0, 0, 0]))).toBe('unknown-lora');
    expect(classifyPayload(new Uint8Array([]))).toBe('unknown-lora');
  });
});

describe('classifyProximity', () => {
  it('uses RSSI when present', () => {
    expect(classifyProximity(-70)).toBe('very-close');
    expect(classifyProximity(-90)).toBe('nearby');
    expect(classifyProximity(-100)).toBe('distant');
  });

  it('falls back to SNR when RSSI absent', () => {
    expect(classifyProximity(undefined, 10)).toBe('very-close');
    expect(classifyProximity(undefined, 5)).toBe('nearby');
    expect(classifyProximity(undefined, 1)).toBe('distant');
  });

  it('returns unknown when neither present', () => {
    expect(classifyProximity()).toBe('unknown');
  });
});

describe('extractMeshtasticSenderId', () => {
  it('extracts little-endian sender from bytes 4-7', () => {
    const raw = new Uint8Array(12);
    raw[4] = 0x78;
    raw[5] = 0x56;
    raw[6] = 0x34;
    raw[7] = 0x12;
    expect(extractMeshtasticSenderId(raw)).toBe(0x12345678);
  });

  it('returns null for short payload', () => {
    expect(extractMeshtasticSenderId(new Uint8Array(4))).toBe(null);
  });

  it('returns null for sender 0 or broadcast', () => {
    const zeros = new Uint8Array(8);
    expect(extractMeshtasticSenderId(zeros)).toBe(null);
    const broadcast = new Uint8Array(8);
    broadcast[4] = 0xff;
    broadcast[5] = 0xff;
    broadcast[6] = 0xff;
    broadcast[7] = 0xff;
    expect(extractMeshtasticSenderId(broadcast)).toBe(null);
  });
});

describe('RollingRateCounter', () => {
  it('returns zero when no records', () => {
    const c = new RollingRateCounter(60_000);
    expect(c.getRate()).toBe(0);
  });

  it('computes rate over window', () => {
    const c = new RollingRateCounter(60_000);
    c.record();
    c.record();
    c.record();
    expect(c.getRate()).toBeCloseTo(3, 0);
  });
});

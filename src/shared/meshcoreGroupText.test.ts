import { describe, expect, it } from 'vitest';

import {
  decodeMeshcoreGroupText,
  encodeMeshcoreGroupText,
  meshcoreChannelHash,
} from './meshcoreGroupText';

const secret = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
const otherSecret = Uint8Array.from({ length: 16 }, (_, i) => 0xf0 - i);

describe('meshcoreGroupText', () => {
  it('matches the firmware channel hash for the default Public channel', () => {
    const publicSecret = Uint8Array.from(
      '8b3387e9c5cdea6ac9e5edbaa115cd72'.match(/../g) ?? [],
      (h) => parseInt(h, 16),
    );
    expect(meshcoreChannelHash(publicSecret)).toBe(0x11);
  });

  it('round-trips timestamp, flags, and text', () => {
    const payload = encodeMeshcoreGroupText(secret, 1_791_938_071, 'N4CNR Heltec V4: Test', 0);
    expect(payload[0]).toBe(meshcoreChannelHash(secret));
    expect((payload.length - 3) % 16).toBe(0);
    expect(decodeMeshcoreGroupText(secret, payload)).toEqual({
      timestampSec: 1_791_938_071,
      flags: 0,
      text: 'N4CNR Heltec V4: Test',
    });
  });

  it('handles multi-block UTF-8 text', () => {
    const text = 'Sender: héllo wörld, this message spans several AES blocks ✓';
    const payload = encodeMeshcoreGroupText(secret, 42, text);
    expect(decodeMeshcoreGroupText(secret, payload)?.text).toBe(text);
  });

  it('rejects a payload for a different channel key', () => {
    const payload = encodeMeshcoreGroupText(secret, 1, 'A: hi');
    expect(decodeMeshcoreGroupText(otherSecret, payload)).toBeNull();
  });

  it('rejects a tampered MAC', () => {
    const payload = encodeMeshcoreGroupText(secret, 1, 'A: hi');
    payload[1] = (payload.at(1) ?? 0) ^ 0xff;
    expect(decodeMeshcoreGroupText(secret, payload)).toBeNull();
  });

  it('rejects tampered ciphertext', () => {
    const payload = encodeMeshcoreGroupText(secret, 1, 'A: hi');
    payload[payload.length - 1] = (payload.at(-1) ?? 0) ^ 0x01;
    expect(decodeMeshcoreGroupText(secret, payload)).toBeNull();
  });

  it('rejects short or misaligned payloads and wrong-size secrets', () => {
    expect(decodeMeshcoreGroupText(secret, new Uint8Array(10))).toBeNull();
    const payload = encodeMeshcoreGroupText(secret, 1, 'A: hi');
    expect(decodeMeshcoreGroupText(secret, payload.subarray(0, payload.length - 1))).toBeNull();
    expect(decodeMeshcoreGroupText(new Uint8Array(32), payload)).toBeNull();
  });
});

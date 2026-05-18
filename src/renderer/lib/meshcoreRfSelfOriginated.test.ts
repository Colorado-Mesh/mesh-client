import { describe, expect, it } from 'vitest';

import { parseMeshCoreRfPacket } from '../../shared/meshcoreRfPacketParse';
import { meshcoreRfIsSelfOriginated } from './meshcoreRawPacketSender';
import { pubkeyToNodeId } from './meshcoreUtils';

const FLOOD_ADVERT_HEX =
  '110649cc80710706ce47b76233ce222c37bdb3bb394a75d08dfdd2d0b30d74ff5003409f10acb5a7c420dc69b3ec2d02fec6c29583702b2c8a482a64c6c8f1d0b16ba19a5ac36261512feda7c10ac08a2248146d9193ab55887227dfae25b2e9f1bfee29726efd2537aefa0692c8046302d2d9b9f944454e2d424c44522d5754562d52452d43453437';

function hexToU8(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe('meshcoreRfIsSelfOriginated', () => {
  it('detects own pubkey in a flood ADVERT frame', () => {
    const raw = hexToU8(FLOOD_ADVERT_HEX);
    const parsed = parseMeshCoreRfPacket(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !parsed.advert) return;
    const myNodeId = pubkeyToNodeId(parsed.advert.publicKey);
    expect(meshcoreRfIsSelfOriginated(raw, parsed.advert.publicKey, myNodeId)).toBe(true);
  });

  it('returns false when myNodeNum is 0 (caller must guard before invoking)', () => {
    const raw = hexToU8(FLOOD_ADVERT_HEX);
    const parsed = parseMeshCoreRfPacket(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !parsed.advert) return;
    expect(meshcoreRfIsSelfOriginated(raw, parsed.advert.publicKey, 0)).toBe(false);
  });

  it('returns false for a frame with a different pubkey', () => {
    const raw = hexToU8(FLOOD_ADVERT_HEX);
    const parsed = parseMeshCoreRfPacket(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !parsed.advert) return;
    const otherKey = new Uint8Array(parsed.advert.publicKey);
    otherKey[0] ^= 0xff;
    const otherId = pubkeyToNodeId(otherKey);
    expect(meshcoreRfIsSelfOriginated(raw, otherKey, otherId)).toBe(false);
  });
});

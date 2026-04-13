import { describe, expect, it } from 'vitest';

import { classifyPayload } from './foreignLoraDetection';
import { meshcoreRawPacketLogFromBytesFallback } from './meshcoreRawPacketSender';
import { pubkeyToNodeId } from './meshcoreUtils';

/** Real RF flood advert sample (fails `Packet.fromBytes` in some builds; path-prefix decode works). */
const FLOOD_ADVERT_HEX =
  '110649cc80710706ce47b76233ce222c37bdb3bb394a75d08dfdd2d0b30d74ff5003409f10acb5a7c420dc69b3ec2d02fec6c29583702b2c8a482a64c6c8f1d0b16ba19a5ac36261512feda7c10ac08a2248146d9193ab55887227dfae25b2e9f1bfee29726efd2537aefa0692c8046302d2d9b9f944454e2d424c44522d5754562d52452d43453437';

function hexToU8(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe('meshcoreRawPacketLogFromBytesFallback', () => {
  it('classifies RF flood advert as meshcore (not Meshtastic heuristic)', () => {
    const raw = hexToU8(FLOOD_ADVERT_HEX);
    expect(classifyPayload(raw)).toBe('meshcore');
  });

  it('recovers FLOOD, ADVERT, hop count, and node id from raw bytes', () => {
    const raw = hexToU8(FLOOD_ADVERT_HEX);
    const prefix = new Map<string, number>();
    const fb = meshcoreRawPacketLogFromBytesFallback(raw, prefix);
    expect(fb).not.toBeNull();
    expect(fb!.routeTypeString).toBe('FLOOD');
    expect(fb!.payloadTypeString).toBe('ADVERT');
    expect(fb!.hopCount).toBe(6);
    const innerStart = 8;
    const expectId = pubkeyToNodeId(raw.subarray(innerStart, innerStart + 32));
    expect(fb!.fromNodeId).toBe(expectId);
    expect(expectId).not.toBe(0);
  });
});

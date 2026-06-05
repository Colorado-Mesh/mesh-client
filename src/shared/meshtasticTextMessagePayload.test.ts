import { create, toBinary } from '@bufbuild/protobuf';
import { StoreForward } from '@meshtastic/protobufs';
import { describe, expect, it } from 'vitest';

import {
  isLikelyReadableChatText,
  resolveMeshtasticTextMessagePayload,
} from './meshtasticTextMessagePayload';

function sfTextPacket(text: string): Uint8Array {
  const msg = create(StoreForward.StoreAndForwardSchema, {
    rr: StoreForward.StoreAndForward_RequestResponse.ROUTER_TEXT_BROADCAST,
    variant: { case: 'text', value: new TextEncoder().encode(text) },
  });
  return toBinary(StoreForward.StoreAndForwardSchema, msg);
}

describe('meshtasticTextMessagePayload', () => {
  it('rejects garbled control-byte payloads', () => {
    const garbled = new Uint8Array(20).fill(0x01);
    expect(isLikelyReadableChatText(garbled)).toBe(false);
    expect(resolveMeshtasticTextMessagePayload(garbled)).toBeNull();
  });

  it('accepts readable UTF-8 text', () => {
    const bytes = new TextEncoder().encode('hello mesh');
    expect(resolveMeshtasticTextMessagePayload(bytes)).toEqual({ text: 'hello mesh' });
  });

  it('returns null for store-forward text variant with empty or whitespace-only payload', () => {
    expect(resolveMeshtasticTextMessagePayload(sfTextPacket(''))).toBeNull();
    expect(resolveMeshtasticTextMessagePayload(sfTextPacket('   '))).toBeNull();
  });
});

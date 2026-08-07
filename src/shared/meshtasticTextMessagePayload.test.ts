import { create, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import {
  meshtasticStoreAndForwardSchema,
  meshtasticStoreForwardRequestResponse,
} from './meshtasticProtobufSchemas';
import {
  isLikelyReadableChatText,
  parseStoreForwardPacket,
  resolveMeshtasticTextMessagePayload,
} from './meshtasticTextMessagePayload';

function sfTextPacket(text: string): Uint8Array {
  const msg = create(meshtasticStoreAndForwardSchema, {
    rr: meshtasticStoreForwardRequestResponse.ROUTER_TEXT_BROADCAST,
    variant: { case: 'text', value: new TextEncoder().encode(text) },
  });
  return toBinary(meshtasticStoreAndForwardSchema, msg);
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

  it('parseStoreForwardPacket returns null for empty/malformed bytes and decodes text variants', () => {
    expect(parseStoreForwardPacket(new Uint8Array())).toBeNull();
    expect(parseStoreForwardPacket(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeNull();
    const parsed = parseStoreForwardPacket(sfTextPacket('sf hello'));
    expect(parsed?.variant.case).toBe('text');
    expect(parsed?.rr).toBe(meshtasticStoreForwardRequestResponse.ROUTER_TEXT_BROADCAST);
  });
});

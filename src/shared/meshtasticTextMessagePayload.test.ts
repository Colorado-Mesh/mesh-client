import { describe, expect, it } from 'vitest';

import {
  isLikelyReadableChatText,
  resolveMeshtasticTextMessagePayload,
} from './meshtasticTextMessagePayload';

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
});

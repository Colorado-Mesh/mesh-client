import { describe, expect, it } from 'vitest';

import { toPacketPayloadBytes, truncatePacketText } from './packetPayload';

describe('toPacketPayloadBytes', () => {
  it('returns a Uint8Array unchanged', () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    expect(toPacketPayloadBytes(bytes)).toBe(bytes);
  });

  it('unwraps raw / data / payload carriers', () => {
    expect(toPacketPayloadBytes({ raw: Uint8Array.from([9]) })).toEqual(Uint8Array.from([9]));
    expect(toPacketPayloadBytes({ data: Uint8Array.from([8]) })).toEqual(Uint8Array.from([8]));
    expect(toPacketPayloadBytes({ payload: Uint8Array.from([7]) })).toEqual(Uint8Array.from([7]));
  });

  it('accepts ArrayBuffer, typed-array views, and byte arrays', () => {
    expect(toPacketPayloadBytes(Uint8Array.from([1, 2]).buffer)).toEqual(Uint8Array.from([1, 2]));
    expect(toPacketPayloadBytes(Int8Array.from([3]))).toEqual(Uint8Array.from([3]));
    expect(toPacketPayloadBytes([4, 5])).toEqual(Uint8Array.from([4, 5]));
  });

  it('returns empty bytes for payloads it cannot interpret', () => {
    for (const value of [undefined, null, 42, 'text', {}, { data: { nested: true } }]) {
      expect(toPacketPayloadBytes(value)).toEqual(new Uint8Array());
    }
  });

  it('does not recurse infinitely on a self-referential wrapper', () => {
    const wrapper: { data?: unknown } = {};
    wrapper.data = wrapper;
    expect(toPacketPayloadBytes(wrapper)).toEqual(new Uint8Array());
  });

  it('does not recurse infinitely on a multi-level object cycle', () => {
    const a: { payload?: unknown } = {};
    const b: { raw?: unknown } = {};
    a.payload = b;
    b.raw = a;
    expect(toPacketPayloadBytes(a)).toEqual(new Uint8Array());
  });
});

describe('truncatePacketText', () => {
  it('leaves text at or below the limit untouched', () => {
    expect(truncatePacketText('hello', 5)).toBe('hello');
    expect(truncatePacketText('hi', 5)).toBe('hi');
  });

  it('clamps longer text to the limit', () => {
    expect(truncatePacketText('abcdef', 3)).toBe('abc');
  });

  it('treats negative limits as zero', () => {
    expect(truncatePacketText('abc', -1)).toBe('');
  });
});

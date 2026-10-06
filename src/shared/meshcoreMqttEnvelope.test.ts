import { describe, expect, it } from 'vitest';

import { tryParseMeshcoreMqttChatEnvelope } from './meshcoreMqttEnvelope';

describe('tryParseMeshcoreMqttChatEnvelope', () => {
  it('parses valid minimal envelope', () => {
    const raw = JSON.stringify({
      v: 1,
      text: 'Hello MeshCore',
      channelIdx: 0,
    });
    expect(tryParseMeshcoreMqttChatEnvelope(raw)).toEqual({
      v: 1,
      text: 'Hello MeshCore',
      channelIdx: 0,
    });
  });

  it('parses full envelope with all optional fields', () => {
    const raw = JSON.stringify({
      v: 1,
      text: 'Emergency notice',
      channelIdx: 1,
      senderName: 'Alice',
      senderNodeId: 12345678,
      timestamp: 1710000000000,
    });
    expect(tryParseMeshcoreMqttChatEnvelope(raw)).toEqual({
      v: 1,
      text: 'Emergency notice',
      channelIdx: 1,
      senderName: 'Alice',
      senderNodeId: 12345678,
      timestamp: 1710000000000,
    });
  });

  it('truncates senderName longer than 200 chars', () => {
    const longName = 'A'.repeat(250);
    const raw = JSON.stringify({
      v: 1,
      text: 'Test',
      channelIdx: 0,
      senderName: longName,
    });
    const parsed = tryParseMeshcoreMqttChatEnvelope(raw);
    expect(parsed?.senderName).toBe('A'.repeat(200));
  });

  it('casts senderNodeId to uint32', () => {
    const raw = JSON.stringify({
      v: 1,
      text: 'Test',
      channelIdx: 0,
      senderNodeId: 0xffffffff,
    });
    const parsed = tryParseMeshcoreMqttChatEnvelope(raw);
    expect(parsed?.senderNodeId).toBe(4294967295);
  });

  it('rejects malformed JSON', () => {
    expect(tryParseMeshcoreMqttChatEnvelope('not json')).toBeNull();
    expect(tryParseMeshcoreMqttChatEnvelope('{')).toBeNull();
  });

  it('rejects missing or wrong protocol version', () => {
    expect(
      tryParseMeshcoreMqttChatEnvelope(JSON.stringify({ text: 'hi', channelIdx: 0 })),
    ).toBeNull();
    expect(
      tryParseMeshcoreMqttChatEnvelope(JSON.stringify({ v: 2, text: 'hi', channelIdx: 0 })),
    ).toBeNull();
  });

  it('rejects missing, non-string, or oversized text (>16000 chars)', () => {
    expect(tryParseMeshcoreMqttChatEnvelope(JSON.stringify({ v: 1, channelIdx: 0 }))).toBeNull();
    expect(
      tryParseMeshcoreMqttChatEnvelope(JSON.stringify({ v: 1, text: 12345, channelIdx: 0 })),
    ).toBeNull();
    expect(
      tryParseMeshcoreMqttChatEnvelope(
        JSON.stringify({ v: 1, text: 'x'.repeat(16001), channelIdx: 0 }),
      ),
    ).toBeNull();
  });

  it('rejects invalid channel index (<0, >255, NaN)', () => {
    expect(
      tryParseMeshcoreMqttChatEnvelope(JSON.stringify({ v: 1, text: 'hi', channelIdx: -1 })),
    ).toBeNull();
    expect(
      tryParseMeshcoreMqttChatEnvelope(JSON.stringify({ v: 1, text: 'hi', channelIdx: 256 })),
    ).toBeNull();
    expect(
      tryParseMeshcoreMqttChatEnvelope(JSON.stringify({ v: 1, text: 'hi', channelIdx: 'invalid' })),
    ).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import { tryParseMeshcoreMqttChatEnvelope } from '../shared/meshcoreMqttEnvelope';

describe('tryParseMeshcoreMqttChatEnvelope', () => {
  it('parses minimal v1', () => {
    expect(
      tryParseMeshcoreMqttChatEnvelope(JSON.stringify({ v: 1, text: 'hi', channelIdx: 0 })),
    ).toEqual({ v: 1, text: 'hi', channelIdx: 0 });
  });

  it('parses optional fields', () => {
    const raw = JSON.stringify({
      v: 1,
      text: 'x',
      channelIdx: 3,
      senderName: 'Bob',
      senderNodeId: 305419896,
      timestamp: 1_700_000_000_000,
    });
    expect(tryParseMeshcoreMqttChatEnvelope(raw)).toEqual({
      v: 1,
      text: 'x',
      channelIdx: 3,
      senderName: 'Bob',
      senderNodeId: 305419896,
      timestamp: 1_700_000_000_000,
    });
  });

  it('rejects wrong version', () => {
    expect(
      tryParseMeshcoreMqttChatEnvelope(JSON.stringify({ v: 2, text: 'x', channelIdx: 0 })),
    ).toBeNull();
  });

  it('rejects invalid channel', () => {
    expect(
      tryParseMeshcoreMqttChatEnvelope(JSON.stringify({ v: 1, text: 'x', channelIdx: 999 })),
    ).toBeNull();
  });

  it('rejects non-json', () => {
    expect(tryParseMeshcoreMqttChatEnvelope('not json')).toBeNull();
  });

  it('rejects negative senderNodeId', () => {
    expect(
      tryParseMeshcoreMqttChatEnvelope(
        JSON.stringify({ v: 1, text: 'x', channelIdx: 0, senderNodeId: -1 }),
      ),
    ).toEqual({ v: 1, text: 'x', channelIdx: 0, senderNodeId: undefined });
  });
});

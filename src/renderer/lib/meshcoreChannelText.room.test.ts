import { describe, expect, it } from 'vitest';

import { isMeshcoreRoomChatMessage } from '@/renderer/hooks/meshcore/meshcoreHookPreamble';

import {
  buildMeshcoreRoomIncomingMessage,
  parseMeshcoreRoomPostPayload,
} from './meshcoreChannelText';

describe('parseMeshcoreRoomPostPayload', () => {
  it('extracts author prefix and post body', () => {
    const prefix = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const prefixHex = Array.from(prefix)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const map = new Map<string, number>([[prefixHex, 0xdeadbeef]]);
    const raw = String.fromCharCode(...prefix) + 'Hello room';
    const parsed = parseMeshcoreRoomPostPayload(raw, map);
    expect(parsed.authorId).toBe(0xdeadbeef);
    expect(parsed.payload).toBe('Hello room');
  });
});

describe('buildMeshcoreRoomIncomingMessage', () => {
  it('tags roomServerId and uses room channel', () => {
    const msg = buildMeshcoreRoomIncomingMessage({
      rawText: 'Post body',
      roomServerId: 0x100,
      authorId: 0x200,
      authorName: 'Alice',
      timestamp: 1000,
      receivedVia: 'rf',
    });
    expect(msg.roomServerId).toBe(0x100);
    expect(msg.channel).toBe(-2);
    expect(msg.payload).toBe('Post body');
  });

  it('is classified as room traffic for Chat DM filtering', () => {
    const msg = buildMeshcoreRoomIncomingMessage({
      rawText: 'Post body',
      roomServerId: 0x100,
      authorId: 0x200,
      authorName: 'Alice',
      timestamp: 1000,
      receivedVia: 'rf',
    });
    expect(isMeshcoreRoomChatMessage(msg)).toBe(true);
  });
});

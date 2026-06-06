import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import { meshtasticDataSchema } from './meshtasticProtobufSchemas';
import { MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG } from './reactionEmoji';

describe('Meshtastic tapback wire shape (mesh.proto Data)', () => {
  it('stores the glyph in payload and uses emoji as boolean flag 1', () => {
    const glyph = '👍';
    const data = create(meshtasticDataSchema, {
      portnum: 1, // Portnums.PortNum.TEXT_MESSAGE_APP
      payload: new TextEncoder().encode(glyph),
      emoji: MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG,
      replyId: 0x12345678,
    });
    const round = fromBinary(meshtasticDataSchema, toBinary(meshtasticDataSchema, data)) as {
      emoji?: number;
      payload?: Uint8Array;
      replyId?: number;
    };
    expect(round.emoji).toBe(1);
    expect(new TextDecoder().decode(round.payload ?? new Uint8Array())).toBe(glyph);
    expect(round.replyId).toBe(0x12345678 >>> 0);
  });
});

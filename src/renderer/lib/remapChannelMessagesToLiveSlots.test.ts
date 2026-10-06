import { describe, expect, it } from 'vitest';

import {
  remapChannelMessagesToLiveSlots,
  retainChannelRemapContext,
} from './remapChannelMessagesToLiveSlots';
import type { ChatMessage } from './types';

const KEY_EMERGENCY = 'aaaaaaaaaaaaaaaa';
const KEY_REACH = 'bbbbbbbbbbbbbbbb';
const KEY_GONE = 'cccccccccccccccc';
const RADIO_OLD = 111;
const RADIO_NEW = 222;

function msg(payload: string, extra: Partial<ChatMessage>): ChatMessage {
  return {
    sender_id: 1,
    sender_name: 'n',
    payload,
    channel: 1,
    timestamp: 1,
    ...extra,
  };
}

/** New radio: `#emergency` in slot 1, `#cm-reach` in slot 2. */
const NEW_RADIO_CTX = {
  keyByIndex: { 1: KEY_EMERGENCY, 2: KEY_REACH },
  radioNodeId: RADIO_NEW,
};

describe('remapChannelMessagesToLiveSlots', () => {
  it('moves history recorded in another radio’s slot to the slot holding that channel now', () => {
    // Old radio had #cm-reach in slot 1 — those rows must land in slot 2, not under #emergency.
    const reach = msg('reach from old radio', {
      channel: 1,
      channelKey: KEY_REACH,
      radioNodeId: RADIO_OLD,
    });
    const emergency = msg('emergency from old radio', {
      channel: 3,
      channelKey: KEY_EMERGENCY,
      radioNodeId: RADIO_OLD,
    });
    const out = remapChannelMessagesToLiveSlots([reach, emergency], NEW_RADIO_CTX);
    expect(out.map((m) => [m.payload, m.channel])).toEqual([
      ['reach from old radio', 2],
      ['emergency from old radio', 1],
    ]);
  });

  it('hides keyed history for channels the connected radio does not have', () => {
    const out = remapChannelMessagesToLiveSlots(
      [msg('gone', { channelKey: KEY_GONE, radioNodeId: RADIO_OLD })],
      NEW_RADIO_CTX,
    );
    expect(out).toEqual([]);
  });

  it('keeps unkeyed rows from this radio or with no radio in their stored slot', () => {
    const own = msg('own', { channel: 2, radioNodeId: RADIO_NEW });
    const legacy = msg('legacy', { channel: 1 });
    const input = [own, legacy];
    expect(remapChannelMessagesToLiveSlots(input, NEW_RADIO_CTX)).toBe(input);
  });

  it('hides unkeyed rows recorded by a different radio', () => {
    const out = remapChannelMessagesToLiveSlots(
      [msg('old unkeyed', { radioNodeId: RADIO_OLD })],
      NEW_RADIO_CTX,
    );
    expect(out).toEqual([]);
  });

  it('passes DMs and room posts through untouched', () => {
    const dm = msg('dm', { channel: -1, to: 5, radioNodeId: RADIO_OLD });
    const meshtasticDm = msg('mt dm', { channel: 0, to: 5, radioNodeId: RADIO_OLD });
    const room = msg('room', { channel: -2, roomServerId: 9, radioNodeId: RADIO_OLD });
    const input = [dm, meshtasticDm, room];
    expect(remapChannelMessagesToLiveSlots(input, NEW_RADIO_CTX)).toBe(input);
  });

  it('treats broadcast-addressed rows as channel messages', () => {
    const out = remapChannelMessagesToLiveSlots(
      [msg('bcast', { channel: 1, to: 0xffffffff, channelKey: KEY_REACH })],
      NEW_RADIO_CTX,
    );
    expect(out[0]?.channel).toBe(2);
  });

  it('keeps filtering after the channel list clears until the next radio publishes a map', () => {
    const hidden = msg('other radio', { channelKey: KEY_GONE, radioNodeId: RADIO_OLD });
    const cleared = retainChannelRemapContext(NEW_RADIO_CTX, {
      keyByIndex: {},
      radioNodeId: null,
    });
    expect(remapChannelMessagesToLiveSlots([hidden], cleared)).toEqual([]);
    const published = retainChannelRemapContext(cleared, {
      keyByIndex: { 1: KEY_GONE },
      radioNodeId: RADIO_OLD,
    });
    expect(remapChannelMessagesToLiveSlots([hidden], published)[0]?.channel).toBe(1);
  });

  it('collapses the same group message heard in two slots on two radios', () => {
    const oldSlot = msg('same', {
      sender_id: 7,
      timestamp: 50,
      channel: 1,
      channelKey: KEY_REACH,
      radioNodeId: RADIO_OLD,
    });
    const newSlot = msg('same', {
      sender_id: 7,
      timestamp: 50,
      channel: 4,
      channelKey: KEY_REACH,
      radioNodeId: RADIO_NEW,
    });
    const other = msg('other', {
      sender_id: 7,
      timestamp: 50,
      channel: 1,
      channelKey: KEY_REACH,
      radioNodeId: RADIO_OLD,
    });
    const dm = msg('same', {
      sender_id: 7,
      timestamp: 50,
      channel: -1,
      to: 5,
      channelKey: KEY_REACH,
    });
    const out = remapChannelMessagesToLiveSlots([oldSlot, newSlot, other, dm], NEW_RADIO_CTX);
    expect(out.map((m) => [m.payload, m.channel, m.to])).toEqual([
      ['same', 2, undefined],
      ['other', 2, undefined],
      ['same', -1, 5],
    ]);
  });

  it('passes everything through when no live channel list is loaded', () => {
    const input = [msg('a', { channelKey: KEY_GONE, radioNodeId: RADIO_OLD })];
    expect(remapChannelMessagesToLiveSlots(input, null)).toBe(input);
    expect(remapChannelMessagesToLiveSlots(input, { keyByIndex: {}, radioNodeId: RADIO_NEW })).toBe(
      input,
    );
  });

  it('keeps unkeyed rows when the connected radio is unknown (MQTT-only)', () => {
    const input = [msg('old unkeyed', { radioNodeId: RADIO_OLD })];
    expect(
      remapChannelMessagesToLiveSlots(input, {
        keyByIndex: { 1: KEY_EMERGENCY },
        radioNodeId: null,
      }),
    ).toBe(input);
  });

  it('uses the lowest slot when the same channel is configured twice', () => {
    const out = remapChannelMessagesToLiveSlots(
      [msg('dup', { channel: 0, channelKey: KEY_REACH })],
      {
        keyByIndex: { 4: KEY_REACH, 2: KEY_REACH },
        radioNodeId: RADIO_NEW,
      },
    );
    expect(out[0]?.channel).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';

import {
  buildChannelChatCot,
  buildChannelContactCot,
  buildGeochatCot,
  channelContactUid,
  geochatSenderUid,
  parseTakChannelChatMessage,
  parseTakChatChannels,
} from './geochat-cot';

const NOW = Date.parse('2026-10-09T12:00:00.000Z');
const MSG = { room: 'Mesh Ops', senderCallsign: 'Bob', text: 'on scene', timeMs: NOW - 5000 };
const KEY = '0123456789abcdef';
const CHANNEL = { key: KEY, name: '#MC Ops', send: true, remote: false };
const HEARD = { channelKey: KEY, senderCallsign: 'Bob', text: 'on scene', timeMs: NOW - 5000 };

describe('buildGeochatCot', () => {
  it('builds a standard GeoChat event addressed to the room', () => {
    const cot = buildGeochatCot(MSG, NOW, 'msg-1');
    const sender = geochatSenderUid('Bob');
    expect(cot).toContain(`uid="GeoChat.${sender}.Mesh Ops.msg-1"`);
    expect(cot).toContain('type="b-t-f"');
    expect(cot).toContain('chatroom="Mesh Ops" id="Mesh Ops" senderCallsign="Bob"');
    expect(cot).toContain(`<chatgrp uid0="${sender}" uid1="Mesh Ops" id="Mesh Ops"/>`);
    expect(cot).toContain(
      `<remarks source="BAO.F.ATAK.${sender}" to="Mesh Ops" time="2026-10-09T11:59:55.000Z">on scene</remarks>`,
    );
    expect(cot).toContain('<point lat="0" lon="0" hae="9999999"');
  });

  it('uses the sender position when known', () => {
    const cot = buildGeochatCot({ ...MSG, latitude: 39.7, longitude: -105 }, NOW, 'x');
    expect(cot).toContain('<point lat="39.7" lon="-105" hae="9999999"');
  });

  it('escapes XML in the room, callsign, and text', () => {
    const cot = buildGeochatCot(
      { ...MSG, room: 'A&B', senderCallsign: '"Q"', text: '<b>hi</b>' },
      NOW,
      'x',
    );
    expect(cot).toContain('chatroom="A&amp;B"');
    expect(cot).toContain('senderCallsign="&quot;Q&quot;"');
    expect(cot).toContain('&lt;b&gt;hi&lt;/b&gt;</remarks>');
    expect(cot).not.toContain('<b>');
  });

  it('uses a given sender uid in place of the callsign-derived one', () => {
    const cot = buildGeochatCot(MSG, NOW, 'msg-1', 'ANDROID-1');
    expect(cot).toContain('uid="GeoChat.ANDROID-1.Mesh Ops.msg-1"');
    expect(cot).toContain('<chatgrp uid0="ANDROID-1" uid1="Mesh Ops" id="Mesh Ops"/>');
    expect(cot).toContain('<link uid="ANDROID-1" type="a-f-G-U-C" relation="p-p"/>');
    expect(cot).toContain('source="BAO.F.ATAK.ANDROID-1"');
    expect(cot).not.toContain('MESHCHAT-');
    expect(buildGeochatCot(MSG, NOW, 'msg-1', 'a"b')).toContain('uid0="a&quot;b"');
  });

  it('gives each callsign a stable sender uid', () => {
    expect(geochatSenderUid('Bob')).toBe(geochatSenderUid('Bob'));
    expect(geochatSenderUid('Bob')).not.toBe(geochatSenderUid('Alice'));
    expect(geochatSenderUid('Bob')).toMatch(/^MESHCHAT-[0-9a-f]{8}$/);
  });
});

describe('parseTakChannelChatMessage', () => {
  it('accepts and trims a valid message', () => {
    expect(parseTakChannelChatMessage({ ...HEARD, text: ' on scene ', extra: 1 })).toEqual(HEARD);
    expect(parseTakChannelChatMessage({ ...HEARD, latitude: 39.7, longitude: -105 })).toMatchObject(
      { latitude: 39.7, longitude: -105 },
    );
  });

  it.each([
    ['not an object', null],
    ['no channel key', { ...HEARD, channelKey: undefined }],
    ['a channel key that is not one', { ...HEARD, channelKey: 'Mesh Ops' }],
    ['an overlong callsign', { ...HEARD, senderCallsign: 'x'.repeat(65) }],
    ['empty text', { ...HEARD, text: '  ' }],
    ['overlong text', { ...HEARD, text: 'x'.repeat(1025) }],
    ['a bad time', { ...HEARD, timeMs: Number.NaN }],
    ['half a position', { ...HEARD, latitude: 1 }],
    ['an out-of-range position', { ...HEARD, latitude: 95, longitude: 0 }],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseTakChannelChatMessage(raw)).toThrow(/tak:pushChatMessage/);
  });
});

describe('channel contacts', () => {
  it('gives each channel key a stable contact uid', () => {
    expect(channelContactUid(KEY)).toBe(channelContactUid(KEY));
    expect(channelContactUid(KEY)).not.toBe(channelContactUid('fedcba9876543210'));
    expect(channelContactUid(KEY)).toMatch(/^MESHROOM-[0-9a-f]{8}$/);
  });

  it('announces a channel ATAK can send to as a contact reached through the server', () => {
    const cot = buildChannelContactCot({ ...CHANNEL, name: '#MT R&D "lab"' }, NOW);
    expect(cot.startsWith('<event ')).toBe(true);
    expect(cot).toContain(`uid="${channelContactUid(KEY)}"`);
    expect(cot).toContain('type="a-f-G-U-C"');
    expect(cot).toContain('<contact callsign="#MT R&amp;D &quot;lab&quot;" endpoint="*:-1:stcp"/>');
    expect(cot).toContain('stale="2026-10-10T12:00:00.000Z"');
  });

  it('gives a receive-only channel no endpoint, so ATAK offers no way to type to it', () => {
    const cot = buildChannelContactCot({ ...CHANNEL, send: false }, NOW);
    expect(cot).toContain('<contact callsign="#MC Ops"/>');
    expect(cot).not.toContain('endpoint=');
  });

  it("builds a channel line as a direct message from the channel's contact", () => {
    const line = { senderCallsign: 'Bob', text: 'on scene', timeMs: NOW - 5000 };
    const cot = buildChannelChatCot(
      CHANNEL,
      line,
      { uid: 'ANDROID-1', callsign: 'VIPER' },
      NOW,
      'm-1',
    );
    const contact = channelContactUid(KEY);
    expect(cot).toContain(`uid="GeoChat.${contact}.ANDROID-1.m-1"`);
    expect(cot).toContain('chatroom="VIPER" id="ANDROID-1" senderCallsign="#MC Ops"');
    expect(cot).toContain(`<chatgrp uid0="${contact}" uid1="ANDROID-1" id="ANDROID-1"/>`);
    expect(cot).toContain('time="2026-10-09T11:59:55.000Z">Bob: on scene</remarks>');
    expect(cot).toContain('<point lat="0" lon="0"');
  });

  it('escapes the recipient and the text', () => {
    const cot = buildChannelChatCot(
      CHANNEL,
      { senderCallsign: 'A<B', text: '1 & 2', timeMs: NOW },
      { uid: 'a"b', callsign: 'C>D' },
      NOW,
      'm-1',
    );
    expect(cot).toContain('chatroom="C&gt;D" id="a&quot;b"');
    expect(cot).toContain('>A&lt;B: 1 &amp; 2</remarks>');
  });
});

describe('parseTakChatChannels', () => {
  it('trims names and keeps the last entry for a repeated key', () => {
    expect(
      parseTakChatChannels([
        { ...CHANNEL, name: ' #MC Ops ' },
        { key: 'fedcba9876543210', name: '#MT LongFast', send: false, remote: true },
        { ...CHANNEL, send: false },
      ]),
    ).toEqual([
      { ...CHANNEL, send: false },
      { key: 'fedcba9876543210', name: '#MT LongFast', send: false, remote: true },
    ]);
    expect(parseTakChatChannels([])).toEqual([]);
  });

  it.each([
    ['not an array', CHANNEL],
    ['too many channels', Array.from({ length: 65 }, () => CHANNEL)],
    ['a channel that is not an object', ['#MC Ops']],
    ['a bad key', [{ ...CHANNEL, key: 'Ops' }]],
    ['an empty name', [{ ...CHANNEL, name: ' ' }]],
    ['an overlong name', [{ ...CHANNEL, name: 'x'.repeat(65) }]],
    ['a control character in a name', [{ ...CHANNEL, name: 'a\nb' }]],
    ['a send flag that is not boolean', [{ ...CHANNEL, send: 'yes' }]],
    ['no remote flag', [{ key: KEY, name: '#MC Ops', send: true }]],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseTakChatChannels(raw)).toThrow(/tak:setChatChannels/);
  });
});

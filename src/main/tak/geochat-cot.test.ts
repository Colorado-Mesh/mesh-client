import { describe, expect, it } from 'vitest';

import {
  buildChatRoomContactCot,
  buildGeochatCot,
  buildRoomContactChatCot,
  chatRoomContactUid,
  geochatSenderUid,
  parseTakChatSendRooms,
  parseTakGeochatMessage,
} from './geochat-cot';

const NOW = Date.parse('2026-10-09T12:00:00.000Z');
const MSG = { room: 'Mesh Ops', senderCallsign: 'Bob', text: 'on scene', timeMs: NOW - 5000 };

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

describe('parseTakGeochatMessage', () => {
  it('accepts and trims a valid message', () => {
    expect(parseTakGeochatMessage({ ...MSG, room: ' Mesh Ops ', extra: 1 })).toEqual(MSG);
  });

  it.each([
    ['not an object', null],
    ['an empty room', { ...MSG, room: ' ' }],
    ['a control character in the room', { ...MSG, room: 'a\nb' }],
    ['an overlong callsign', { ...MSG, senderCallsign: 'x'.repeat(65) }],
    ['empty text', { ...MSG, text: '  ' }],
    ['overlong text', { ...MSG, text: 'x'.repeat(1025) }],
    ['a bad time', { ...MSG, timeMs: Number.NaN }],
    ['half a position', { ...MSG, latitude: 1 }],
    ['an out-of-range position', { ...MSG, latitude: 95, longitude: 0 }],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseTakGeochatMessage(raw)).toThrow(/tak:pushChatMessage/);
  });
});

describe('room contacts', () => {
  it('gives each room a stable contact uid', () => {
    expect(chatRoomContactUid('Mesh Ops')).toBe(chatRoomContactUid('Mesh Ops'));
    expect(chatRoomContactUid('Mesh Ops')).not.toBe(chatRoomContactUid('Public'));
    expect(chatRoomContactUid('Mesh Ops')).toMatch(/^MESHROOM-[0-9a-f]{8}$/);
  });

  it('announces a room as a contact reached through the server connection', () => {
    const cot = buildChatRoomContactCot('R&D "lab"', NOW);
    expect(cot.startsWith('<event ')).toBe(true);
    expect(cot).toContain(`uid="${chatRoomContactUid('R&D "lab"')}"`);
    expect(cot).toContain('type="a-f-G-U-C"');
    expect(cot).toContain('<contact callsign="R&amp;D &quot;lab&quot;" endpoint="*:-1:stcp"/>');
    expect(cot).toContain('stale="2026-10-10T12:00:00.000Z"');
  });

  it("builds a room message as a direct message from the room's contact", () => {
    const cot = buildRoomContactChatCot(MSG, { uid: 'ANDROID-1', callsign: 'VIPER' }, NOW, 'm-1');
    const room = chatRoomContactUid('Mesh Ops');
    expect(cot).toContain(`uid="GeoChat.${room}.ANDROID-1.m-1"`);
    expect(cot).toContain('chatroom="VIPER" id="ANDROID-1" senderCallsign="Mesh Ops"');
    expect(cot).toContain(`<chatgrp uid0="${room}" uid1="ANDROID-1" id="ANDROID-1"/>`);
    expect(cot).toContain('>Bob: on scene</remarks>');
  });

  it('escapes the recipient and the text', () => {
    const cot = buildRoomContactChatCot(
      { ...MSG, senderCallsign: 'A<B', text: '1 & 2' },
      { uid: 'a"b', callsign: 'C>D' },
      NOW,
      'm-1',
    );
    expect(cot).toContain('chatroom="C&gt;D" id="a&quot;b"');
    expect(cot).toContain('>A&lt;B: 1 &amp; 2</remarks>');
  });
});

describe('parseTakChatSendRooms', () => {
  it('trims rooms and drops repeats', () => {
    expect(parseTakChatSendRooms([' Mesh Ops ', 'Public', 'Mesh Ops'])).toEqual([
      'Mesh Ops',
      'Public',
    ]);
    expect(parseTakChatSendRooms([])).toEqual([]);
  });

  it.each([
    ['not an array', 'Mesh'],
    ['too many rooms', Array.from({ length: 65 }, (_, i) => `r${i}`)],
    ['a room that is not a string', [1]],
    ['an empty room', [' ']],
    ['an overlong room', ['x'.repeat(65)]],
    ['a control character in a room', ['a\nb']],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseTakChatSendRooms(raw)).toThrow(/tak:setChatSendRooms/);
  });
});

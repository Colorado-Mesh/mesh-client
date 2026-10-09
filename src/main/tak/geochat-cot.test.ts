import { describe, expect, it } from 'vitest';

import { buildGeochatCot, geochatSenderUid, parseTakGeochatMessage } from './geochat-cot';

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

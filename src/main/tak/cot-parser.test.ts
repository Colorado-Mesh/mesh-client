// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { COT_STALE_MS } from './cot-converter';
import { COT_FRAME_MAX_BYTES, CotFramer, parseCotEvent } from './cot-parser';

const NOW = Date.parse('2026-10-02T12:00:00Z');

function cot({
  uid = 'ANDROID-1',
  type = 'a-f-G-U-C',
  lat = '39.75',
  lon = '-104.99',
  time = '2026-10-02T11:59:00Z',
  stale = '2026-10-02T12:01:00Z',
  detail = '<contact callsign="ALPHA"/>',
}: Partial<Record<'uid' | 'type' | 'lat' | 'lon' | 'time' | 'stale' | 'detail', string>> = {}) {
  return (
    `<event version="2.0" uid="${uid}" type="${type}" time="${time}" start="${time}" ` +
    `stale="${stale}" how="m-g"><point lat="${lat}" lon="${lon}" hae="1609.3" ce="10" le="10"/>` +
    `<detail>${detail}</detail></event>`
  );
}

describe('CotFramer', () => {
  it('splits events across chunk boundaries, with or without XML declarations', () => {
    const framer = new CotFramer();
    const a = `<?xml version="1.0" encoding="UTF-8"?>${cot({ uid: 'A' })}`;
    const b = cot({ uid: 'B' });
    const stream = `${a}\n${b}`;
    expect(framer.push(stream.slice(0, 50))).toEqual([]);
    const frames = framer.push(stream.slice(50));
    expect(frames).toHaveLength(2);
    expect(frames[0]?.startsWith('<event ')).toBe(true);
    expect(frames[1]).toBe(b);
  });

  it('decodes multi-byte UTF-8 split between chunks', () => {
    const framer = new CotFramer();
    const bytes = Buffer.from(cot({ detail: '<contact callsign="ÉCHO"/>' }), 'utf8');
    const split = bytes.indexOf(0xc3) + 1;
    expect(framer.push(bytes.subarray(0, split))).toEqual([]);
    const [frame] = framer.push(bytes.subarray(split));
    expect(parseCotEvent(frame ?? '', 'local', NOW)?.callsign).toBe('ÉCHO');
  });

  it('drops an oversized partial event and recovers on the next one', () => {
    const framer = new CotFramer();
    expect(framer.push('<event uid="X">' + 'x'.repeat(COT_FRAME_MAX_BYTES + 1))).toEqual([]);
    expect(framer.push(cot({ uid: 'NEXT' }))).toHaveLength(1);
  });
});

describe('parseCotEvent', () => {
  it('extracts a unit contact', () => {
    const contact = parseCotEvent(
      cot({
        detail:
          '<contact callsign="ALPHA &amp; CO"/><__group name="Cyan" role="Team Lead"/>' +
          '<remarks>On &lt;scene&gt;</remarks>',
      }),
      'remote',
      NOW,
    );
    expect(contact).toEqual({
      uid: 'ANDROID-1',
      type: 'a-f-G-U-C',
      callsign: 'ALPHA & CO',
      lat: 39.75,
      lon: -104.99,
      hae: 1609.3,
      group: 'Cyan',
      role: 'Team Lead',
      remarks: 'On <scene>',
      source: 'remote',
      receivedAt: NOW,
      staleAt: NOW + 2 * 60 * 1000,
    });
  });

  it('applies the sender stale window to the local clock, clamped', () => {
    const skewed = parseCotEvent(
      cot({ time: '2020-01-01T00:00:00Z', stale: '2020-01-01T00:02:00Z' }),
      'local',
      NOW,
    );
    expect(skewed?.staleAt).toBe(NOW + 2 * 60 * 1000);
    const tiny = parseCotEvent(
      cot({ time: '2026-10-02T12:00:00Z', stale: '2026-10-02T12:00:01Z' }),
      'local',
      NOW,
    );
    expect(tiny?.staleAt).toBe(NOW + 30 * 1000);
    const missing = parseCotEvent(cot({ time: 'garbage' }), 'local', NOW);
    expect(missing?.staleAt).toBe(NOW + COT_STALE_MS);
  });

  it('falls back to the uid when there is no callsign and omits an unknown height', () => {
    const contact = parseCotEvent(
      '<event uid="U-1" type="b-m-p-s-m"><point lat="1" lon="2" hae="9999999"/></event>',
      'local',
      NOW,
    );
    expect(contact?.callsign).toBe('U-1');
    expect(contact?.hae).toBeUndefined();
  });

  it('accepts single-quoted attributes', () => {
    const contact = parseCotEvent(
      "<event uid='Q' type='a-h-G'><point lat='10' lon='20'/></event>",
      'local',
      NOW,
    );
    expect(contact).toMatchObject({ uid: 'Q', lat: 10, lon: 20 });
  });

  it.each([
    ['ping', cot({ type: 't-x-c-t' })],
    ['chat', cot({ type: 'b-t-f' })],
    ['own Meshtastic echo', cot({ uid: 'MESH-12' })],
    ['own MeshCore echo', cot({ uid: 'MC-12' })],
    ['own Reticulum echo', cot({ uid: 'RN-12' })],
    ['latitude out of range', cot({ lat: '91' })],
    ['longitude not a number', cot({ lon: 'east' })],
    ['null island', cot({ lat: '0', lon: '0' })],
    ['no point', '<event uid="X" type="a-f-G"><detail/></event>'],
    ['no uid', '<event type="a-f-G"><point lat="1" lon="1"/></event>'],
  ])('ignores %s', (_label, xml) => {
    expect(parseCotEvent(xml, 'local', NOW)).toBeNull();
  });
});

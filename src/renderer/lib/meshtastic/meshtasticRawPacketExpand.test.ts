import { create, toBinary } from '@bufbuild/protobuf';
import { Mesh, Portnums } from '@meshtastic/protobufs';
import { describe, expect, it } from 'vitest';

import {
  formatMeshtasticRawPacketExpandDebugLine,
  MESHTASTIC_BROADCAST,
  parseMeshtasticRawPacketExpand,
} from './meshtasticRawPacketExpand';

function wireMeshPacket(
  fields: Parameters<typeof create<typeof Mesh.MeshPacketSchema>>[1],
): Uint8Array {
  return toBinary(Mesh.MeshPacketSchema, create(Mesh.MeshPacketSchema, fields) as never);
}

describe('parseMeshtasticRawPacketExpand', () => {
  it('parses RF packet hop fields and decoded payload case', () => {
    const raw = wireMeshPacket({
      id: 0x12345678,
      from: 0xabcdef01,
      to: 0x11111111,
      channel: 2,
      hopStart: 7,
      hopLimit: 4,
      payloadVariant: {
        case: 'decoded',
        value: {
          portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
          payload: new Uint8Array([1, 2, 3]),
        },
      },
    });
    const parsed = parseMeshtasticRawPacketExpand(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.id).toBe(0x12345678);
    expect(parsed.to).toBe(0x11111111);
    expect(parsed.channel).toBe(2);
    expect(parsed.hopStart).toBe(7);
    expect(parsed.hopLimit).toBe(4);
    expect(parsed.hopsAway).toBe(3);
    expect(parsed.payloadCase).toBe('decoded');
  });

  it('returns undefined hops for MQTT via entry flag', () => {
    const raw = wireMeshPacket({
      hopStart: 7,
      hopLimit: 4,
      payloadVariant: { case: 'encrypted', value: new Uint8Array([0xaa]) },
    });
    const parsed = parseMeshtasticRawPacketExpand(raw, { viaMqtt: true });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.hopsAway).toBeUndefined();
    expect(parsed.payloadCase).toBe('encrypted');
  });

  it('returns ok false for invalid bytes', () => {
    expect(parseMeshtasticRawPacketExpand(new Uint8Array([0xff, 0xfe]))).toEqual({ ok: false });
  });

  it('returns ok false when raw exceeds size cap', () => {
    expect(parseMeshtasticRawPacketExpand(new Uint8Array(65_537))).toEqual({ ok: false });
  });
});

describe('formatMeshtasticRawPacketExpandDebugLine', () => {
  it('formats broadcast to and hex ids', () => {
    const line = formatMeshtasticRawPacketExpandDebugLine({
      ok: true,
      id: 0x12345678,
      to: MESHTASTIC_BROADCAST,
      channel: 0,
      hopStart: null,
      hopLimit: null,
      hopsAway: undefined,
      payloadCase: 'decoded',
    });
    expect(line).toContain('id=0x12345678');
    expect(line).toContain('to=BROADCAST');
    expect(line).toContain('channel=0');
    expect(line).toContain('payload=decoded');
  });
});

import { create, toBinary } from '@bufbuild/protobuf';
import { ATAK } from '@meshtastic/protobufs';
import { describe, expect, it } from 'vitest';

import { decodeTakPacket } from './takPacketDecode';

describe('decodeTakPacket', () => {
  it('decodes a TAKPacketV2 position report', () => {
    const bytes = toBinary(
      ATAK.TAKPacketV2Schema,
      create(ATAK.TAKPacketV2Schema, {
        callsign: 'RANGER-1',
        cotTypeId: 1,
        latitudeI: 398_000_000,
        longitudeI: -1_050_000_000,
        altitude: 1620,
        battery: 87,
        team: 2,
      }),
    );

    expect(decodeTakPacket(bytes)).toMatchObject({
      version: 2,
      callsign: 'RANGER-1',
      latitude: 39.8,
      longitude: -105,
      altitude: 1620,
      battery: 87,
      team: 'Yellow',
    });
  });

  it('prefers the cot_type_str override over the enum name', () => {
    const bytes = toBinary(
      ATAK.TAKPacketV2Schema,
      create(ATAK.TAKPacketV2Schema, {
        callsign: 'SCOUT',
        cotTypeId: 1,
        cotTypeStr: 'a-f-G-U-C-I-T',
      }),
    );
    expect(decodeTakPacket(bytes)?.cotType).toBe('a-f-G-U-C-I-T');
  });

  it('surfaces the populated oneof branch and chat text', () => {
    const bytes = toBinary(
      ATAK.TAKPacketV2Schema,
      create(ATAK.TAKPacketV2Schema, {
        callsign: 'BASE',
        payloadVariant: {
          case: 'chat',
          value: { message: 'moving to rally point', to: 'All Chat Rooms' },
        },
      }),
    );
    expect(decodeTakPacket(bytes)).toMatchObject({
      payloadKind: 'chat',
      chatMessage: 'moving to rally point',
    });
  });

  it('converts TAKEnvironment and SensorFov units', () => {
    const bytes = toBinary(
      ATAK.TAKPacketV2Schema,
      create(ATAK.TAKPacketV2Schema, {
        callsign: 'WX',
        environment: { temperatureCX10: 213, windDirectionDeg: 270, windSpeedCmS: 450 },
        sensorFov: { type: 1, rangeM: 800 },
      }),
    );
    const summary = decodeTakPacket(bytes);
    expect(summary?.temperatureC).toBeCloseTo(21.3, 5);
    expect(summary?.windSpeedMs).toBeCloseTo(4.5, 5);
    expect(summary?.sensorFovType).toBe(
      ATAK.SensorFov_SensorTypeSchema.values.find((v) => v.number === 1)?.name,
    );
  });

  it('reports a drawn-shape payload without inventing position data', () => {
    const bytes = toBinary(
      ATAK.TAKPacketV2Schema,
      create(ATAK.TAKPacketV2Schema, {
        callsign: 'ENGINEER',
        payloadVariant: { case: 'shape', value: { kind: 1, majorCm: 5000 } },
      }),
    );
    expect(decodeTakPacket(bytes)).toMatchObject({ payloadKind: 'shape' });
    expect(decodeTakPacket(bytes)?.latitude).toBeUndefined();
  });

  it('falls back to the v1 wire format for legacy plugin packets', () => {
    const bytes = toBinary(
      ATAK.TAKPacketSchema,
      create(ATAK.TAKPacketSchema, {
        contact: { callsign: 'LEGACY', deviceCallsign: 'MESH-1' },
        group: { team: 2, role: 1 },
        status: { battery: 55 },
        payloadVariant: {
          case: 'pli',
          value: { latitudeI: 398_000_000, longitudeI: -1_050_000_000, altitude: 1600 },
        },
      }),
    );
    expect(decodeTakPacket(bytes)).toMatchObject({
      version: 1,
      callsign: 'LEGACY',
      battery: 55,
      latitude: 39.8,
      payloadKind: 'pli',
    });
  });

  it('returns null for empty or unparseable payloads', () => {
    expect(decodeTakPacket(new Uint8Array())).toBeNull();
    expect(decodeTakPacket(new Uint8Array([0xff, 0xff, 0xff, 0xff]))).toBeNull();
  });
});

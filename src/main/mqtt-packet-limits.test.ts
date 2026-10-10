// @vitest-environment node
import { parser } from 'mqtt-packet';
import { describe, expect, it, vi } from 'vitest';

import {
  isMqttPacketTooLargeError,
  MQTT_MAX_PACKET_BYTES,
  MQTT_PACKET_TOO_LARGE_ERROR_CODE,
  MQTT_WEBSOCKET_PACKET_TOO_LARGE_ERROR_CODE,
  mqttPayloadByteLength,
} from './mqtt-packet-limits';

function encodeRemainingLength(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  do {
    let encoded = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) encoded |= 0x80;
    bytes.push(encoded);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

describe('mqtt-packet inbound size limit', () => {
  it.each([MQTT_PACKET_TOO_LARGE_ERROR_CODE, MQTT_WEBSOCKET_PACKET_TOO_LARGE_ERROR_CODE])(
    'recognizes %s as an oversized inbound packet',
    (code) => {
      expect(
        isMqttPacketTooLargeError(Object.assign(new Error('oversized packet'), { code })),
      ).toBe(true);
    },
  );

  it('rejects an oversized packet as soon as fragmented Remaining Length completes', () => {
    const mqttParser = parser({ maximumPacketSize: MQTT_MAX_PACKET_BYTES });
    const onError = vi.fn();
    mqttParser.on('error', onError);
    const remainingLength = encodeRemainingLength(MQTT_MAX_PACKET_BYTES);

    mqttParser.parse(Buffer.from([0x30]));
    for (const byte of remainingLength) mqttParser.parse(Buffer.from([byte]));

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      code: MQTT_PACKET_TOO_LARGE_ERROR_CODE,
    });
  });

  it('accepts a declared packet whose complete encoded size is exactly the limit', () => {
    const remainingLengthBytes = encodeRemainingLength(MQTT_MAX_PACKET_BYTES).length;
    const declaredPayloadBytes = MQTT_MAX_PACKET_BYTES - 1 - remainingLengthBytes;
    const mqttParser = parser({ maximumPacketSize: MQTT_MAX_PACKET_BYTES });
    const onError = vi.fn();
    mqttParser.on('error', onError);

    mqttParser.parse(
      Buffer.concat([Buffer.from([0x30]), encodeRemainingLength(declaredPayloadBytes)]),
    );

    expect(onError).not.toHaveBeenCalled();
  });

  it('measures string payloads without converting them to a Buffer first', () => {
    expect(mqttPayloadByteLength('é')).toBe(2);
    expect(mqttPayloadByteLength(Buffer.from([1, 2, 3]))).toBe(3);
  });
});

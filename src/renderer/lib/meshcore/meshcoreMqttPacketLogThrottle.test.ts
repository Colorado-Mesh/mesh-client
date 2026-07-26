import { describe, expect, it } from 'vitest';

import {
  createMeshcoreMqttPacketLogBucket,
  MESHCORE_MQTT_PACKET_LOG_BUCKET_CAPACITY,
  MESHCORE_MQTT_PACKET_LOG_REFILL_INTERVAL_MS,
  tryTakeMeshcoreMqttPacketLogToken,
} from './meshcoreMqttPacketLogThrottle';

describe('meshcoreMqttPacketLogThrottle', () => {
  it('allows a burst up to capacity then denies until refill', () => {
    const bucket = createMeshcoreMqttPacketLogBucket(1_000);
    for (let i = 0; i < MESHCORE_MQTT_PACKET_LOG_BUCKET_CAPACITY; i += 1) {
      expect(tryTakeMeshcoreMqttPacketLogToken(bucket, 1_000)).toBe(true);
    }
    expect(tryTakeMeshcoreMqttPacketLogToken(bucket, 1_000)).toBe(false);
    expect(
      tryTakeMeshcoreMqttPacketLogToken(
        bucket,
        1_000 + MESHCORE_MQTT_PACKET_LOG_REFILL_INTERVAL_MS,
      ),
    ).toBe(true);
    expect(
      tryTakeMeshcoreMqttPacketLogToken(
        bucket,
        1_000 + MESHCORE_MQTT_PACKET_LOG_REFILL_INTERVAL_MS,
      ),
    ).toBe(false);
  });

  it('refills multiple tokens for longer idle gaps without exceeding capacity', () => {
    const bucket = createMeshcoreMqttPacketLogBucket(0);
    bucket.tokens = 0;
    const now = MESHCORE_MQTT_PACKET_LOG_REFILL_INTERVAL_MS * 100;
    expect(tryTakeMeshcoreMqttPacketLogToken(bucket, now)).toBe(true);
    expect(bucket.tokens).toBe(MESHCORE_MQTT_PACKET_LOG_BUCKET_CAPACITY - 1);
  });
});

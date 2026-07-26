/**
 * Token bucket for MeshCore RF → MQTT packet-log publishes.
 * Sustained RF floods must not enqueue unbounded MQTT IPC.
 */

import { MS_PER_SECOND } from '../timeConstants';

/** Burst capacity before MQTT packet-log publishes start dropping. */
export const MESHCORE_MQTT_PACKET_LOG_BUCKET_CAPACITY = 8;

/** One token refilled every this many ms (~5 publishes/sec sustained). */
export const MESHCORE_MQTT_PACKET_LOG_REFILL_INTERVAL_MS = 200;

/** @deprecated Prefer the token bucket; kept for callers that still track last publish time. */
export const MESHCORE_MQTT_PACKET_LOG_MIN_INTERVAL_MS = Math.floor(MS_PER_SECOND / 10);

export interface MeshcoreMqttPacketLogBucket {
  tokens: number;
  lastRefillMs: number;
}

export function createMeshcoreMqttPacketLogBucket(now = Date.now()): MeshcoreMqttPacketLogBucket {
  return {
    tokens: MESHCORE_MQTT_PACKET_LOG_BUCKET_CAPACITY,
    lastRefillMs: now,
  };
}

/** Refill by elapsed intervals, then consume one token when available. */
export function tryTakeMeshcoreMqttPacketLogToken(
  bucket: MeshcoreMqttPacketLogBucket,
  now = Date.now(),
): boolean {
  const elapsed = Math.max(0, now - bucket.lastRefillMs);
  const refill = Math.floor(elapsed / MESHCORE_MQTT_PACKET_LOG_REFILL_INTERVAL_MS);
  if (refill > 0) {
    bucket.tokens = Math.min(MESHCORE_MQTT_PACKET_LOG_BUCKET_CAPACITY, bucket.tokens + refill);
    bucket.lastRefillMs += refill * MESHCORE_MQTT_PACKET_LOG_REFILL_INTERVAL_MS;
  }
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

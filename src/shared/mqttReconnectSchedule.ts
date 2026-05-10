/**
 * Shared MQTT reconnect delay policy for Meshtastic and MeshCore main-process clients.
 * Capped exponential backoff with light jitter so long broker outages (e.g. overnight reboots)
 * are covered without fixed 10-minute steps or JWT "machine-gun" retries.
 */

/** First long-wait step: 60s → 120s → … capped. */
export const MQTT_RECONNECT_EXPONENTIAL_BASE_MS = 60_000;

/** Max single wait between reconnect attempts. */
export const MQTT_RECONNECT_EXPONENTIAL_CAP_MS = 45 * 60_000;

/** Meshtastic: first reconnect after connect watchdog ends stuck pre-CONNACK session. */
export const MQTT_RECONNECT_MESHTASTIC_CONNACK_FAST_MS = 250;

/** MeshCore non-JWT: first reconnect after broker drop (spread with jitter). */
export const MQTT_RECONNECT_MESHCORE_IMMEDIATE_BASE_MS = 500;

export const MQTT_RECONNECT_MESHCORE_IMMEDIATE_JITTER_MS = 2000;

function applyPositiveJitterMs(delayMs: number): number {
  const spread = Math.floor(delayMs * 0.1);
  if (spread <= 0) return delayMs;
  return delayMs + Math.floor(Math.random() * (spread + 1));
}

/** Exponential delay for attempt ≥ 1 (post-increment counter). */
export function computeMqttExponentialReconnectDelayMs(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error('attempt must be a positive integer');
  }
  const raw = Math.min(
    MQTT_RECONNECT_EXPONENTIAL_CAP_MS,
    MQTT_RECONNECT_EXPONENTIAL_BASE_MS * 2 ** (attempt - 1),
  );
  return applyPositiveJitterMs(raw);
}

export interface ComputeMqttReconnectDelayParams {
  protocol: 'meshtastic' | 'meshcore';
  /** 1-based reconnect attempt (same as logged "attempt X"). */
  attempt: number;
  /** Meshtastic only: attempt 1 after `connack timeout` teardown. */
  meshtasticConnackFastReconnect?: boolean;
  /** MeshCore non-JWT only: attempt 1 uses sub-minute spread instead of exponential minute. */
  meshcoreNonJwtFirstReconnectImmediate?: boolean;
}

export function computeMqttReconnectDelayMs(p: ComputeMqttReconnectDelayParams): number {
  if (p.protocol === 'meshtastic' && p.attempt === 1 && p.meshtasticConnackFastReconnect) {
    return MQTT_RECONNECT_MESHTASTIC_CONNACK_FAST_MS;
  }
  if (
    p.protocol === 'meshcore' &&
    p.attempt === 1 &&
    p.meshcoreNonJwtFirstReconnectImmediate === true
  ) {
    return (
      MQTT_RECONNECT_MESHCORE_IMMEDIATE_BASE_MS +
      Math.floor(Math.random() * MQTT_RECONNECT_MESHCORE_IMMEDIATE_JITTER_MS)
    );
  }
  return computeMqttExponentialReconnectDelayMs(p.attempt);
}

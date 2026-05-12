import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  computeMqttExponentialReconnectDelayMs,
  computeMqttReconnectDelayMs,
  MQTT_RECONNECT_EXPONENTIAL_BASE_MS,
  MQTT_RECONNECT_EXPONENTIAL_CAP_MS,
  MQTT_RECONNECT_MESHTASTIC_CONNACK_FAST_MS,
} from './mqttReconnectSchedule';

describe('mqttReconnectSchedule', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('meshtastic connack-fast path returns 250ms', () => {
    expect(
      computeMqttReconnectDelayMs({
        protocol: 'meshtastic',
        attempt: 1,
        meshtasticConnackFastReconnect: true,
      }),
    ).toBe(MQTT_RECONNECT_MESHTASTIC_CONNACK_FAST_MS);
  });

  it('meshcore non-JWT first attempt uses immediate window only', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const d = computeMqttReconnectDelayMs({
      protocol: 'meshcore',
      attempt: 1,
      meshcoreNonJwtFirstReconnectImmediate: true,
    });
    expect(d).toBeGreaterThanOrEqual(500);
    expect(d).toBeLessThanOrEqual(500 + 2000);
  });

  it('exponential delay grows and caps (deterministic jitter)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(computeMqttExponentialReconnectDelayMs(1)).toBe(MQTT_RECONNECT_EXPONENTIAL_BASE_MS);
    expect(computeMqttExponentialReconnectDelayMs(2)).toBe(MQTT_RECONNECT_EXPONENTIAL_BASE_MS * 2);
    const huge = computeMqttExponentialReconnectDelayMs(20);
    expect(huge).toBe(MQTT_RECONNECT_EXPONENTIAL_CAP_MS);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  computeMqttExponentialReconnectDelayMs,
  computeMqttReconnectDelayMs,
  MQTT_RECONNECT_EXPONENTIAL_BASE_MS,
  MQTT_RECONNECT_EXPONENTIAL_CAP_MS,
  MQTT_RECONNECT_MESHCORE_IMMEDIATE_BASE_MS,
  MQTT_RECONNECT_MESHCORE_IMMEDIATE_JITTER_MS,
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

  it.each([0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999999])(
    'meshcore non-JWT first attempt jitter stays in [base, base + jitter) (random=%s)',
    (r) => {
      vi.spyOn(Math, 'random').mockReturnValue(r);
      const d = computeMqttReconnectDelayMs({
        protocol: 'meshcore',
        attempt: 1,
        meshcoreNonJwtFirstReconnectImmediate: true,
      });
      expect(d).toBeGreaterThanOrEqual(MQTT_RECONNECT_MESHCORE_IMMEDIATE_BASE_MS);
      expect(d).toBeLessThan(
        MQTT_RECONNECT_MESHCORE_IMMEDIATE_BASE_MS + MQTT_RECONNECT_MESHCORE_IMMEDIATE_JITTER_MS,
      );
    },
  );

  it('meshcore non-JWT first attempt hits min and max jitter from Math.random extremes', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(
      computeMqttReconnectDelayMs({
        protocol: 'meshcore',
        attempt: 1,
        meshcoreNonJwtFirstReconnectImmediate: true,
      }),
    ).toBe(MQTT_RECONNECT_MESHCORE_IMMEDIATE_BASE_MS);

    vi.spyOn(Math, 'random').mockReturnValue(0.999999999999);
    expect(
      computeMqttReconnectDelayMs({
        protocol: 'meshcore',
        attempt: 1,
        meshcoreNonJwtFirstReconnectImmediate: true,
      }),
    ).toBe(
      MQTT_RECONNECT_MESHCORE_IMMEDIATE_BASE_MS + MQTT_RECONNECT_MESHCORE_IMMEDIATE_JITTER_MS - 1,
    );
  });

  it('exponential delay grows and caps (deterministic jitter)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(computeMqttExponentialReconnectDelayMs(1)).toBe(MQTT_RECONNECT_EXPONENTIAL_BASE_MS);
    expect(computeMqttExponentialReconnectDelayMs(2)).toBe(MQTT_RECONNECT_EXPONENTIAL_BASE_MS * 2);
    const huge = computeMqttExponentialReconnectDelayMs(20);
    expect(huge).toBe(MQTT_RECONNECT_EXPONENTIAL_CAP_MS);
  });

  it.each([
    [1, MQTT_RECONNECT_EXPONENTIAL_BASE_MS, 6000],
    [2, MQTT_RECONNECT_EXPONENTIAL_BASE_MS * 2, 12_000],
  ] as const)(
    'exponential attempt %i jitter spans full 10%% spread at Math.random extremes',
    (attempt, baseMs, spreadMax) => {
      vi.spyOn(Math, 'random').mockReturnValue(0);
      expect(computeMqttExponentialReconnectDelayMs(attempt)).toBe(baseMs);

      vi.spyOn(Math, 'random').mockReturnValue(0.999999999999);
      expect(computeMqttExponentialReconnectDelayMs(attempt)).toBe(baseMs + spreadMax);
    },
  );
});

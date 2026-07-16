import { describe, expect, it } from 'vitest';

import {
  clampMqttMaxRetries,
  MQTT_DEFAULT_RECONNECT_ATTEMPTS,
  MQTT_MAX_RECONNECT_ATTEMPTS,
} from './meshtasticMqttReconnect';

describe('clampMqttMaxRetries', () => {
  it('passes through valid in-range values', () => {
    expect(clampMqttMaxRetries(1)).toBe(1);
    expect(clampMqttMaxRetries('7')).toBe(7);
    expect(clampMqttMaxRetries(MQTT_MAX_RECONNECT_ATTEMPTS)).toBe(MQTT_MAX_RECONNECT_ATTEMPTS);
  });

  it('clamps values above the max', () => {
    expect(clampMqttMaxRetries(999)).toBe(MQTT_MAX_RECONNECT_ATTEMPTS);
    expect(clampMqttMaxRetries(String(MQTT_MAX_RECONNECT_ATTEMPTS + 1))).toBe(
      MQTT_MAX_RECONNECT_ATTEMPTS,
    );
  });

  it('clamps values below 1', () => {
    expect(clampMqttMaxRetries(0)).toBe(1);
    expect(clampMqttMaxRetries(-5)).toBe(1);
    expect(clampMqttMaxRetries('-5')).toBe(1);
  });

  it('falls back to the default for non-numeric input', () => {
    expect(clampMqttMaxRetries('not-a-number')).toBe(MQTT_DEFAULT_RECONNECT_ATTEMPTS);
    expect(clampMqttMaxRetries('')).toBe(MQTT_DEFAULT_RECONNECT_ATTEMPTS);
    expect(clampMqttMaxRetries(NaN)).toBe(MQTT_DEFAULT_RECONNECT_ATTEMPTS);
  });

  it('parses partial numeric strings like parseInt', () => {
    expect(clampMqttMaxRetries('3abc')).toBe(3);
  });
});

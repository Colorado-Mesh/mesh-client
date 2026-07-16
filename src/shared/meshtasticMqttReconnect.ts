/** Default reconnect budget for both MQTT protocols. */
export const MQTT_DEFAULT_RECONNECT_ATTEMPTS = 5;
/** Maximum reconnect attempts allowed for both MQTT protocols. */
export const MQTT_MAX_RECONNECT_ATTEMPTS = 12;

/** Clamp a user-entered MQTT max-retries value to [1, MQTT_MAX_RECONNECT_ATTEMPTS], falling back to the default when invalid. */
export function clampMqttMaxRetries(value: string | number): number {
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  if (!Number.isFinite(n)) return MQTT_DEFAULT_RECONNECT_ATTEMPTS;
  return Math.min(MQTT_MAX_RECONNECT_ATTEMPTS, Math.max(1, n));
}

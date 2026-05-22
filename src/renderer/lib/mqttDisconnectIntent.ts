let userRequestedDisconnect = false;

/** Call immediately before `electronAPI.mqtt.disconnect()` from the UI. */
export function markMqttUserDisconnect(): void {
  userRequestedDisconnect = true;
}

/** Returns true once if the last disconnect was user-initiated. */
export function consumeMqttUserDisconnect(): boolean {
  const v = userRequestedDisconnect;
  userRequestedDisconnect = false;
  return v;
}

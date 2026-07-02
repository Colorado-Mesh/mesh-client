/** Thrown when deleting the active MQTT-only identity while MQTT is still connected. */
export interface DeleteActiveMqttIdentityError extends Error {
  deleteActiveMqttIdentity: true;
}

export function markDeleteActiveMqttIdentityError(message: string): Error {
  const error = new Error(message);
  (error as DeleteActiveMqttIdentityError).deleteActiveMqttIdentity = true;
  return error;
}

export function isDeleteActiveMqttIdentityError(
  err: unknown,
): err is DeleteActiveMqttIdentityError {
  return (
    err instanceof Error &&
    'deleteActiveMqttIdentity' in err &&
    (err as DeleteActiveMqttIdentityError).deleteActiveMqttIdentity
  );
}

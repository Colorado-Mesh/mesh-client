import {
  MESHCORE_MQTT_CHAT_CONNECTION_ID,
  MESHCORE_MQTT_CONNECTION_ID_MAX_LENGTH,
  type MeshcoreMqttConnectionRole,
} from '../shared/meshcoreMqttConnections';

/**
 * Normalize a renderer-supplied MeshCore connection id. `null` means "not supplied" so callers can
 * keep the legacy single-connection behavior distinct from a targeted disconnect.
 */
export function normalizeOptionalMeshcoreConnectionId(
  value: unknown,
  channel: string,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`${channel}: connectionId must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MESHCORE_MQTT_CONNECTION_ID_MAX_LENGTH) {
    throw new Error(`${channel}: connectionId too long`);
  }
  return trimmed;
}

/** Connection id defaulting to the chat broker when omitted (token/clientId lookups). */
export function resolveMeshcoreConnectionId(value: unknown, channel: string): string {
  return normalizeOptionalMeshcoreConnectionId(value, channel) ?? MESHCORE_MQTT_CHAT_CONNECTION_ID;
}

/**
 * Validate a `mqtt:connect` role/id pair. Omitting both keeps the legacy chat connection; a feed
 * must never target the chat slot and chat must never target a feed id.
 */
export function resolveMeshcoreConnectTarget(
  value: unknown,
  role: unknown,
): { connectionId: string; role: MeshcoreMqttConnectionRole } {
  const connectionId =
    normalizeOptionalMeshcoreConnectionId(value, 'mqtt:connect') ??
    MESHCORE_MQTT_CHAT_CONNECTION_ID;
  const resolvedRole: MeshcoreMqttConnectionRole = role === 'feed' ? 'feed' : 'chat';
  if (resolvedRole === 'feed' && connectionId === MESHCORE_MQTT_CHAT_CONNECTION_ID) {
    throw new Error("mqtt:connect: role 'feed' requires a non-chat connectionId");
  }
  if (resolvedRole === 'chat' && connectionId !== MESHCORE_MQTT_CHAT_CONNECTION_ID) {
    throw new Error("mqtt:connect: role 'chat' requires the chat connectionId");
  }
  return { connectionId, role: resolvedRole };
}

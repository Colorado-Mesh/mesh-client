import { mergeMeshtasticConfigApplyValue } from './meshtasticConfigApply';

/** Meshtastic Config.DeviceConfig.Role.CLIENT_MUTE */
export const MESHTASTIC_CLIENT_MUTE_ROLE = 1;

/** Position config overrides applied when user selects Client Mute role. */
export function buildClientMutePositionSuppressValue(
  devicePosition: unknown,
): Record<string, unknown> {
  return mergeMeshtasticConfigApplyValue(devicePosition, {
    gpsMode: 0,
    positionBroadcastSecs: 0,
  });
}

/** MQTT module overrides applied when user selects Client Mute role. */
export function buildClientMuteMqttSuppressValue(deviceMqtt: unknown): Record<string, unknown> {
  return mergeMeshtasticConfigApplyValue(deviceMqtt, {
    mapReportingEnabled: false,
  });
}

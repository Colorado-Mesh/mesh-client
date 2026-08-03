import type { MeshcorePrefixedHint, MeshcoreUserMessage } from './meshcore/meshcoreMessageI18n';

function mqttPrefixedHint(message: string, hintKey: string): MeshcorePrefixedHint {
  return { type: 'prefixed', message, hintKey };
}

/**
 * Optional user-facing suffix for MeshCore MQTT main-process errors (no secrets).
 * Returns an i18n ref; callers translate with `translateMeshcoreUserMessage(t, ref)`.
 */
export function meshcoreMqttUserFacingHint(rawMessage: string): MeshcoreUserMessage {
  const m = rawMessage.trim();
  if (!m) return m;

  if (/not authorized|connection refused:\s*not authorized/i.test(m)) {
    return mqttPrefixedHint(m, 'meshcore.mqttHints.notAuthorized');
  }
  if (/\bECONNREFUSED\b|\bENOTFOUND\b|\bETIMEDOUT\b|getaddrinfo/i.test(m)) {
    return mqttPrefixedHint(m, 'meshcore.mqttHints.network');
  }
  if (/no CONNACK within|timed out before MQTT session/i.test(m)) {
    return mqttPrefixedHint(m, 'meshcore.mqttHints.connackTimeout');
  }
  if (/^Subscribe failed:\s*/i.test(m) || /^Subscribe to .+ failed:/i.test(m)) {
    return mqttPrefixedHint(m, 'meshcore.mqttHints.subscribeFailed');
  }
  if (/keepalive/i.test(m)) {
    return mqttPrefixedHint(m, 'meshcore.mqttHints.keepalive');
  }
  if (
    /\bEPROTO\b/i.test(m) ||
    /TLSV1_ALERT_INTERNAL_ERROR/i.test(m) ||
    /OPENSSL_internal:TLSV1_ALERT/i.test(m)
  ) {
    return mqttPrefixedHint(m, 'meshcore.mqttHints.tlsHandshake');
  }
  return m;
}

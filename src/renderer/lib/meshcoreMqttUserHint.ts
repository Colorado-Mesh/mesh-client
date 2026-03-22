/**
 * Optional user-facing suffix for MeshCore MQTT main-process errors (no secrets).
 */
export function meshcoreMqttUserFacingHint(rawMessage: string): string {
  const m = rawMessage.trim();
  if (!m) return m;

  if (/not authorized|connection refused:\s*not authorized/i.test(m)) {
    return `${m} — Verify v1_ username, token signature, and JWT audience vs broker; see docs/letsmesh-mqtt-auth.md. Use Custom to paste an operator-issued token if needed.`;
  }
  if (/\bECONNREFUSED\b|\bENOTFOUND\b|\bETIMEDOUT\b|getaddrinfo/i.test(m)) {
    return `${m} Check network, DNS, firewall, and VPN.`;
  }
  if (
    /no CONNACK within|no SUBACK|timed out before MQTT session|subscribe did not complete/i.test(m)
  ) {
    return `${m} If you see no prior “client error” line, the TLS/WebSocket handshake may be stalling (try another network; the app prefers IPv4 for WSS).`;
  }
  if (/^Subscribe failed:/i.test(m)) {
    return `${m} The broker may deny subscribe on your topic prefix or role.`;
  }
  return m;
}

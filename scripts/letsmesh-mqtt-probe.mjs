#!/usr/bin/env node
/**
 * Optional dev probe: connect to LetsMesh WSS with mqtt.js using env-supplied credentials.
 * Does not ship with the app. Compare behavior with Electron main if debugging transport.
 *
 * Usage:
 *   MESHCORE_PUBLIC_KEY_HEX=... MESHCORE_PRIVATE_KEY_HEX=... \
 *   node scripts/letsmesh-mqtt-probe.mjs
 *
 * Token `aud` must match LETSMESH_HOST (same as mesh-client: regional broker hostname).
 * Generate offline with mesh-client or @michaelhart/meshcore-decoder createAuthToken.
 *
 * Or set MQTT_PASSWORD to a pre-built token and MQTT_USERNAME to v1_<64-hex UPPERCASE>.
 */

import mqtt from 'mqtt';

const host = process.env.LETSMESH_HOST ?? 'mqtt-us-v1.letsmesh.net';
const port = Number(process.env.LETSMESH_PORT ?? 443);
const username =
  process.env.MQTT_USERNAME ??
  (process.env.MESHCORE_PUBLIC_KEY_HEX
    ? `v1_${String(process.env.MESHCORE_PUBLIC_KEY_HEX).trim().toUpperCase()}`
    : '');
const password = process.env.MQTT_PASSWORD ?? '';

if (!username || !password) {
  console.error(
    'Set MQTT_USERNAME + MQTT_PASSWORD, or MESHCORE_PUBLIC_KEY_HEX + MQTT_PASSWORD (token).',
  );
  process.exit(1);
}

const client = mqtt.connect({
  protocol: 'wss',
  host,
  port,
  path: '/mqtt',
  clientId: `probe-${Math.random().toString(36).slice(2, 10)}`,
  username,
  password,
  clean: true,
  // Match meshcore-mqtt-adapter WSS MQTT keepalive (WS-level ping is app-only, not in probe).
  keepalive: 60,
  reconnectPeriod: 0,
  connectTimeout: 15_000,
  protocolVersion: 4,
  rejectUnauthorized: true,
  wsOptions: { family: 4 },
});

const t = setTimeout(() => {
  console.error('TIMEOUT');
  try {
    client.end(true);
  } catch {
    // ignore
  }
  process.exit(2);
}, 18_000);

client.on('connect', () => {
  clearTimeout(t);
  console.log('OK: CONNACK received');
  client.subscribe('meshcore/#', (err) => {
    if (err) {
      console.error('Subscribe error:', err.message);
      process.exit(3);
    }
    console.log('OK: subscribed meshcore/#');
    client.end(true);
    process.exit(0);
  });
});

client.on('error', (err) => {
  clearTimeout(t);
  console.error('ERROR:', err.message);
  process.exit(4);
});

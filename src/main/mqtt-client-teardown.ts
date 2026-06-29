import type { MqttClient } from 'mqtt';

/**
 * mqtt.js may emit `error` (e.g. connack timeout) after `end()` if internal timers
 * were not cleared yet. With no listener that becomes an uncaught exception.
 */
export function attachMqttClientErrorSink(client: MqttClient): void {
  client.on('error', () => {});
}

/** Force-disconnect without racing mqtt.js internal connack/keepalive timers. */
export function forceEndMqttClient(client: MqttClient): void {
  attachMqttClientErrorSink(client);
  try {
    client.end(true);
  } catch {
    // catch-no-log-ok forced end during stuck connect/teardown
  }
}

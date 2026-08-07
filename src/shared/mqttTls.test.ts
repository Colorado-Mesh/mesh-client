// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { mqttUsesTls } from './mqttTls';

describe('shared mqttUsesTls', () => {
  it('infers TLS from default ports and explicit tlsEnabled', () => {
    expect(mqttUsesTls({ port: 8883 })).toBe(true);
    expect(mqttUsesTls({ port: 1883 })).toBe(false);
    expect(mqttUsesTls({ port: 1883, tlsEnabled: true })).toBe(true);
    expect(mqttUsesTls({ port: 8883, tlsEnabled: false })).toBe(false);
  });

  it('infers WebSocket TLS from port 443 by default', () => {
    expect(mqttUsesTls({ port: 443, useWebSocket: true })).toBe(true);
    expect(mqttUsesTls({ port: 80, useWebSocket: true })).toBe(false);
    expect(mqttUsesTls({ port: 80, useWebSocket: true, tlsEnabled: true })).toBe(true);
    expect(mqttUsesTls({ port: 443, useWebSocket: true, tlsEnabled: false })).toBe(false);
  });
});

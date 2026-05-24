import { describe, expect, it } from 'vitest';

import type { MQTTSettings } from '@/renderer/lib/types';

import { mqttUsesTls } from './mqttTls';

const base: MQTTSettings = {
  server: 'localhost',
  port: 1883,
  username: '',
  password: '',
  topicPrefix: 'msh/',
  autoLaunch: false,
};

describe('mqttUsesTls', () => {
  it('uses TLS on port 8883 by default for native TCP', () => {
    expect(mqttUsesTls({ ...base, port: 8883 })).toBe(true);
  });

  it('allows plaintext on 8883 when tlsEnabled is false', () => {
    expect(mqttUsesTls({ ...base, port: 8883, tlsEnabled: false })).toBe(false);
  });

  it('uses TLS on 1883 when tlsEnabled is true', () => {
    expect(mqttUsesTls({ ...base, port: 1883, tlsEnabled: true })).toBe(true);
  });

  it('uses wss on 443 WebSocket by default', () => {
    expect(mqttUsesTls({ ...base, port: 443, useWebSocket: true })).toBe(true);
  });
});

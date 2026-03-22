import { describe, expect, it } from 'vitest';

import {
  letsMeshPresetConfigurationDeviation,
  validateLetsMeshManualCredentials,
  validateLetsMeshPresetConnect,
} from './letsMeshConnectionGuards';
import { LETSMESH_HOST_US } from './letsMeshJwt';
import type { MQTTSettings } from './types';

const base: MQTTSettings = {
  server: LETSMESH_HOST_US,
  port: 443,
  username: '',
  password: '',
  topicPrefix: 'meshcore',
  autoLaunch: false,
  useWebSocket: true,
};

describe('validateLetsMeshPresetConnect', () => {
  it('accepts valid LetsMesh-shaped settings', () => {
    expect(validateLetsMeshPresetConnect(base)).toBeNull();
  });

  it('rejects WebSocket off', () => {
    expect(
      validateLetsMeshPresetConnect({
        ...base,
        useWebSocket: false,
      }),
    ).toContain('WebSocket');
  });

  it('rejects wrong port', () => {
    expect(
      validateLetsMeshPresetConnect({
        ...base,
        port: 1883,
      }),
    ).toContain('443');
  });

  it('rejects unknown server', () => {
    expect(
      validateLetsMeshPresetConnect({
        ...base,
        server: 'mqtt.example.com',
      }),
    ).toContain('Custom');
  });
});

describe('validateLetsMeshManualCredentials', () => {
  it('allows empty password', () => {
    expect(validateLetsMeshManualCredentials(base)).toBeNull();
  });

  it('rejects password with invalid username', () => {
    expect(
      validateLetsMeshManualCredentials({
        ...base,
        username: 'bad',
        password: 'x',
      }),
    ).toContain('v1_');
  });

  it('accepts password with v1_ username', () => {
    const pk = 'a'.repeat(64);
    expect(
      validateLetsMeshManualCredentials({
        ...base,
        username: `v1_${pk}`,
        password: 'tok',
      }),
    ).toBeNull();
  });

  it('does not throw when username is undefined', () => {
    const s = { ...base, password: 'tok', username: undefined as unknown as string };
    expect(() => validateLetsMeshManualCredentials(s)).not.toThrow();
    expect(validateLetsMeshManualCredentials(s)).toContain('v1_');
  });
});

describe('letsMeshPresetConfigurationDeviation', () => {
  it('is false for valid base', () => {
    expect(letsMeshPresetConfigurationDeviation(base)).toBe(false);
  });

  it('is true when WebSocket off', () => {
    expect(letsMeshPresetConfigurationDeviation({ ...base, useWebSocket: false })).toBe(true);
  });
});

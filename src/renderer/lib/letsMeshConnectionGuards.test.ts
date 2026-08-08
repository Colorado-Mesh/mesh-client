import { describe, expect, it, vi } from 'vitest';

vi.mock('./i18n', () => ({
  default: {
    t: (key: string, opts?: { port?: number; wsPath?: string }) => {
      switch (key) {
        case 'connectionPanel.letsMeshRequiresWebSocket':
          return 'This broker preset requires WebSocket transport (wss).';
        case 'connectionPanel.letsMeshRequiresPort':
          return `This broker preset requires port ${opts?.port ?? ''} (WebSocket TLS).`;
        case 'connectionPanel.letsMeshRequiresTls':
          return 'This broker preset requires TLS (wss). Enable TLS or switch to Custom.';
        case 'connectionPanel.letsMeshRequiresWsPath':
          return `This broker preset requires WebSocket path ${opts?.wsPath ?? ''}. Reset the preset or switch to Custom.`;
        case 'connectionPanel.letsMeshKnownBrokersOnly':
          return 'This preset only supports known public MeshCore MQTT brokers. Switch to Custom for other brokers.';
        case 'connectionPanel.letsMeshUsernameV1Hex':
          return 'Username must be v1_ followed by 64 hex characters (public key).';
        default:
          return key;
      }
    },
  },
}));

import {
  letsMeshPresetConfigurationDeviation,
  validateLetsMeshManualCredentials,
  validateLetsMeshPresetConnect,
} from './letsMeshConnectionGuards';
import {
  EASTMESH_HOST,
  LETSMESH_HOST_US,
  MESHATSE_HOST,
  MESHCORE_CA_HOST_BACKUP,
  MESHCORE_CA_HOST_PRIMARY,
  MESHMAPPER_HOST,
  WAEV_HOST,
} from './letsMeshJwt';
import type { MQTTSettings } from './types';

const base: MQTTSettings = {
  server: LETSMESH_HOST_US,
  port: 443,
  username: '',
  password: '',
  topicPrefix: 'meshcore',
  autoLaunch: false,
  useWebSocket: true,
  tlsEnabled: true,
  wsPath: '/ws',
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

  it('accepts MeshMapper server', () => {
    expect(
      validateLetsMeshPresetConnect({
        ...base,
        server: MESHMAPPER_HOST,
      }),
    ).toBeNull();
  });

  it.each([
    [WAEV_HOST],
    [MESHATSE_HOST],
    [MESHCORE_CA_HOST_PRIMARY],
    [MESHCORE_CA_HOST_BACKUP],
    [EASTMESH_HOST],
  ])('accepts device-signing host %s with its /mqtt path', (server) => {
    expect(validateLetsMeshPresetConnect({ ...base, server, wsPath: '/mqtt' })).toBeNull();
  });

  it('rejects TLS disabled', () => {
    expect(
      validateLetsMeshPresetConnect({
        ...base,
        tlsEnabled: false,
      }),
    ).toContain('TLS');
  });

  it('rejects wrong wsPath for /mqtt broker', () => {
    expect(
      validateLetsMeshPresetConnect({
        ...base,
        server: WAEV_HOST,
        wsPath: '/ws',
      }),
    ).toContain('/mqtt');
  });

  it('rejects wrong wsPath for /ws broker', () => {
    expect(
      validateLetsMeshPresetConnect({
        ...base,
        wsPath: '/mqtt',
      }),
    ).toContain('/ws');
  });

  it('rejects an omitted wsPath for a /ws broker (stale settings)', () => {
    expect(validateLetsMeshPresetConnect({ ...base, wsPath: undefined })).toContain('/ws');
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

  it('is true when TLS off', () => {
    expect(letsMeshPresetConfigurationDeviation({ ...base, tlsEnabled: false })).toBe(true);
  });

  it('is true when wsPath does not match the broker', () => {
    expect(
      letsMeshPresetConfigurationDeviation({ ...base, server: WAEV_HOST, wsPath: '/ws' }),
    ).toBe(true);
  });

  it('is false for a /mqtt broker with its matching path', () => {
    expect(
      letsMeshPresetConfigurationDeviation({ ...base, server: WAEV_HOST, wsPath: '/mqtt' }),
    ).toBe(false);
  });

  it('accepts LetsMesh region keepalive of 60', () => {
    expect(letsMeshPresetConfigurationDeviation({ ...base, keepalive: 60 })).toBe(false);
  });

  it('is true for an unexpected keepalive', () => {
    expect(letsMeshPresetConfigurationDeviation({ ...base, keepalive: 90 })).toBe(true);
  });
});

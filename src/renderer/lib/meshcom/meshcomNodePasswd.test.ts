import { beforeEach, describe, expect, it, vi } from 'vitest';

const cache = new Map<string, string>();

vi.mock('../secureSecretStorage', () => ({
  getCachedSecureSecret: (key: string) => cache.get(key) ?? null,
  setSecureSecret: (key: string, value: string) => {
    cache.set(key, value);
    return Promise.resolve({ persistent: true });
  },
  removeSecureSecret: (key: string) => {
    cache.delete(key);
    return Promise.resolve();
  },
}));

import {
  getMeshcomNodePasswd,
  MESHCOM_NODE_PASSWD_LEGACY_SECRET_KEY,
  meshcomNodePasswdSecretKey,
  normalizeMeshcomAuthEndpoint,
  setMeshcomNodePasswd,
} from './meshcomNodePasswd';

describe('meshcomNodePasswd', () => {
  beforeEach(() => {
    cache.clear();
  });

  it('normalizes host and default ports', () => {
    expect(normalizeMeshcomAuthEndpoint('10.0.0.1', 8001)).toBe('10.0.0.1:8001');
    expect(normalizeMeshcomAuthEndpoint('10.0.0.1:2323', 2323)).toBe('10.0.0.1:2323');
    expect(normalizeMeshcomAuthEndpoint('Host.Example', 8001)).toBe('host.example:8001');
  });

  it('derives distinct keys for kiss vs netconsole on the same host', () => {
    const kiss = meshcomNodePasswdSecretKey('tcp', '10.0.0.1');
    const net = meshcomNodePasswdSecretKey('netconsole', '10.0.0.1');
    expect(kiss).toMatch(/^meshcom:node-passwd:[a-f0-9]{64}$/);
    expect(net).toMatch(/^meshcom:node-passwd:[a-f0-9]{64}$/);
    expect(kiss).not.toBe(net);
  });

  it('isolates passwords across endpoints (A→B reconnect)', async () => {
    await setMeshcomNodePasswd('tcp', '10.0.0.1:8001', 'alpha-secret');
    await setMeshcomNodePasswd('tcp', '10.0.0.2:8001', 'bravo-secret');

    expect(getMeshcomNodePasswd('tcp', '10.0.0.1')).toBe('alpha-secret');
    expect(getMeshcomNodePasswd('tcp', '10.0.0.2')).toBe('bravo-secret');
    expect(getMeshcomNodePasswd('tcp', '10.0.0.3')).toBe('');
  });

  it('migrates legacy single-slot secret into the first endpoint only', async () => {
    cache.set(MESHCOM_NODE_PASSWD_LEGACY_SECRET_KEY, 'legacy-pw');

    expect(getMeshcomNodePasswd('tcp', '192.168.1.10')).toBe('legacy-pw');
    await vi.waitFor(() => {
      expect(cache.has(MESHCOM_NODE_PASSWD_LEGACY_SECRET_KEY)).toBe(false);
    });

    // After migrate, a different endpoint must not inherit the legacy value.
    expect(getMeshcomNodePasswd('tcp', '192.168.1.11')).toBe('');
    expect(getMeshcomNodePasswd('tcp', '192.168.1.10')).toBe('legacy-pw');
  });

  it('clears endpoint secret when password is empty', async () => {
    await setMeshcomNodePasswd('netconsole', '10.0.0.5', 'temp');
    expect(getMeshcomNodePasswd('netconsole', '10.0.0.5:2323')).toBe('temp');
    await setMeshcomNodePasswd('netconsole', '10.0.0.5', '');
    expect(getMeshcomNodePasswd('netconsole', '10.0.0.5')).toBe('');
  });
});

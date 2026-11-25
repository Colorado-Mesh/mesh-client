import { beforeEach, describe, expect, it, vi } from 'vitest';

const cache = new Map<string, string>();
let setSecureSecretImpl: (key: string, value: string) => Promise<{ persistent: boolean }> = (
  key,
  value,
) => {
  cache.set(key, value);
  return Promise.resolve({ persistent: true });
};
let removeSecureSecretImpl: (key: string) => Promise<void> = (key) => {
  cache.delete(key);
  return Promise.resolve();
};

vi.mock('../secureSecretStorage', () => ({
  getCachedSecureSecret: (key: string) => cache.get(key) ?? null,
  setSecureSecret: (key: string, value: string) => setSecureSecretImpl(key, value),
  removeSecureSecret: (key: string) => removeSecureSecretImpl(key),
}));

import {
  getMeshcomNodePasswd,
  MESHCOM_NODE_PASSWD_LEGACY_SECRET_KEY,
  meshcomNodePasswdSecretKey,
  normalizeMeshcomAuthEndpoint,
  resetMeshcomNodePasswdLegacyClaimForTests,
  setMeshcomNodePasswd,
} from './meshcomNodePasswd';

describe('meshcomNodePasswd', () => {
  beforeEach(() => {
    cache.clear();
    resetMeshcomNodePasswdLegacyClaimForTests();
    setSecureSecretImpl = (key, value) => {
      cache.set(key, value);
      return Promise.resolve({ persistent: true });
    };
    removeSecureSecretImpl = (key) => {
      cache.delete(key);
      return Promise.resolve();
    };
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

  it('claims legacy synchronously so a second endpoint cannot inherit it', () => {
    cache.set(MESHCOM_NODE_PASSWD_LEGACY_SECRET_KEY, 'legacy-pw');

    expect(getMeshcomNodePasswd('tcp', '192.168.1.10')).toBe('legacy-pw');
    // No await — claim must already exclude B.
    expect(getMeshcomNodePasswd('tcp', '192.168.1.11')).toBe('');
    expect(getMeshcomNodePasswd('tcp', '192.168.1.10')).toBe('legacy-pw');
  });

  it('migrates legacy single-slot secret into the first endpoint only', async () => {
    cache.set(MESHCOM_NODE_PASSWD_LEGACY_SECRET_KEY, 'legacy-pw');

    expect(getMeshcomNodePasswd('tcp', '192.168.1.10')).toBe('legacy-pw');
    await vi.waitFor(() => {
      expect(cache.has(MESHCOM_NODE_PASSWD_LEGACY_SECRET_KEY)).toBe(false);
    });

    expect(getMeshcomNodePasswd('tcp', '192.168.1.11')).toBe('');
    expect(getMeshcomNodePasswd('tcp', '192.168.1.10')).toBe('legacy-pw');
  });

  it('keeps a failed migrate claimed for that endpoint only', async () => {
    cache.set(MESHCOM_NODE_PASSWD_LEGACY_SECRET_KEY, 'legacy-pw');
    setSecureSecretImpl = () => Promise.reject(new Error('persist failed'));

    expect(getMeshcomNodePasswd('tcp', '192.168.1.10')).toBe('legacy-pw');
    expect(getMeshcomNodePasswd('tcp', '192.168.1.11')).toBe('');
    // Flush the rejected persist so the claim remains for retries.
    await Promise.resolve();
    await Promise.resolve();
    expect(getMeshcomNodePasswd('tcp', '192.168.1.10')).toBe('legacy-pw');
    expect(getMeshcomNodePasswd('tcp', '192.168.1.11')).toBe('');
  });

  it('clears endpoint secret when password is empty', async () => {
    await setMeshcomNodePasswd('netconsole', '10.0.0.5', 'temp');
    expect(getMeshcomNodePasswd('netconsole', '10.0.0.5:2323')).toBe('temp');
    await setMeshcomNodePasswd('netconsole', '10.0.0.5', '');
    expect(getMeshcomNodePasswd('netconsole', '10.0.0.5')).toBe('');
  });

  it('empty password also removes legacy so get cannot re-migrate it', async () => {
    cache.set(MESHCOM_NODE_PASSWD_LEGACY_SECRET_KEY, 'stale-legacy');
    await setMeshcomNodePasswd('tcp', '10.0.0.9', '');
    expect(cache.has(MESHCOM_NODE_PASSWD_LEGACY_SECRET_KEY)).toBe(false);
    expect(getMeshcomNodePasswd('tcp', '10.0.0.9')).toBe('');
    expect(getMeshcomNodePasswd('tcp', '10.0.0.8')).toBe('');
  });

  it('surfaces legacy wipe failures on the empty-password path', async () => {
    cache.set(MESHCOM_NODE_PASSWD_LEGACY_SECRET_KEY, 'stale-legacy');
    removeSecureSecretImpl = (key) => {
      if (key === MESHCOM_NODE_PASSWD_LEGACY_SECRET_KEY) {
        return Promise.reject(new Error('legacy wipe failed'));
      }
      cache.delete(key);
      return Promise.resolve();
    };
    await expect(setMeshcomNodePasswd('tcp', '10.0.0.9', '')).rejects.toThrow(/legacy wipe failed/);
    // Claim remains so get cannot re-migrate the stale legacy into any endpoint.
    expect(getMeshcomNodePasswd('tcp', '10.0.0.9')).toBe('');
    expect(getMeshcomNodePasswd('tcp', '10.0.0.8')).toBe('');
  });
});

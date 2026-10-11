// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMeshcorePerNodeCredentialStorage,
  parseLegacyCredentialRaw,
} from './meshcorePerNodeCredentialStorage';
import {
  getCachedSecureSecret,
  resetSecureSecretCacheForTests,
  setSecureSecret,
} from './secureSecretStorage';

const PREFIX = 'meshcoreTestCredential:';

interface TestCred {
  secret: string;
}

function createTestStorage() {
  return createMeshcorePerNodeCredentialStorage<TestCred>({
    prefix: PREFIX,
    logTag: 'meshcoreTestCredential',
    securePrefix: 'meshcore:repeater:',
    parseValue: (raw) => {
      if (typeof raw !== 'string' || !raw.trim()) return undefined;
      try {
        const parsed = JSON.parse(raw) as { secret?: string };
        return parsed.secret ? { secret: parsed.secret } : undefined;
      } catch {
        return { secret: raw.trim() };
      }
    },
    serialize: (cred) => JSON.stringify(cred),
  });
}

describe('createMeshcorePerNodeCredentialStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSecureSecretCacheForTests();
  });

  it('persists and reads credentials by node id', async () => {
    const storage = createTestStorage();
    await storage.set(0x1001, { secret: 'alpha' });
    expect(storage.get(0x1001)?.secret).toBe('alpha');
    expect(storage.listNodeIds()).toEqual([0x1001]);
    expect(getCachedSecureSecret('meshcore:repeater:4097')).toContain('alpha');
    expect(localStorage.length).toBe(0);
  });

  it('coerces node ids with unsigned shift', async () => {
    const storage = createTestStorage();
    await storage.set(-1 >>> 0, { secret: 'unsigned' });
    expect(storage.get(0xffffffff)?.secret).toBe('unsigned');
  });

  it('skips invalid keys and unparseable values when reading map', async () => {
    await setSecureSecret('meshcore:repeater:10', JSON.stringify({ secret: 'ok' }));
    await setSecureSecret('meshcore:repeater:bad', JSON.stringify({ secret: 'skip' }));
    await setSecureSecret('meshcore:repeater:11', '');
    const storage = createTestStorage();
    const map = storage.readMap();
    expect(map.size).toBe(1);
    expect(map.get(10)?.secret).toBe('ok');
  });

  it('clears credential when set to null', async () => {
    const storage = createTestStorage();
    await storage.set(0x20, { secret: 'temp' });
    await storage.set(0x20, null);
    expect(storage.get(0x20)).toBeUndefined();
  });

  it('rethrows when secure-store persistence fails without a plaintext fallback', async () => {
    vi.mocked(window.electronAPI.secureSecrets.set).mockRejectedValueOnce(new Error('ipc fail'));
    const storage = createTestStorage();
    await expect(storage.set(0x30, { secret: 'x' })).rejects.toThrow('ipc fail');
    expect(getCachedSecureSecret('meshcore:repeater:48')).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});

describe('parseLegacyCredentialRaw', () => {
  it('parses plain strings and JSON objects', () => {
    const mappers = {
      fromPlainString: (value: string) => ({ secret: value }),
      fromObject: (o: Record<string, unknown>) =>
        typeof o.secret === 'string' ? { secret: o.secret } : undefined,
    };
    expect(parseLegacyCredentialRaw('plain', mappers)).toEqual({ secret: 'plain' });
    expect(parseLegacyCredentialRaw(JSON.stringify({ secret: 'json' }), mappers)).toEqual({
      secret: 'json',
    });
    expect(parseLegacyCredentialRaw({ secret: 'obj' }, mappers)).toEqual({ secret: 'obj' });
  });

  it('propagates mapper failures instead of treating them as plain strings', () => {
    const mappers = {
      fromPlainString: (value: string) => ({ secret: value }),
      fromObject: (): never => {
        throw new Error('mapper boom');
      },
    };
    expect(() => parseLegacyCredentialRaw(JSON.stringify({ secret: 'x' }), mappers)).toThrow(
      'mapper boom',
    );
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from './appSettingsStorage';
import { createMeshcorePerNodeCredentialStorage } from './meshcorePerNodeCredentialStorage';

const PREFIX = 'meshcoreTestCredential:';

interface TestCred {
  secret: string;
}

function createTestStorage() {
  return createMeshcorePerNodeCredentialStorage<TestCred>({
    prefix: PREFIX,
    logTag: 'meshcoreTestCredential',
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
    vi.mocked(window.electronAPI.appSettings.set).mockResolvedValue({ changes: 1 });
  });

  it('persists and reads credentials by node id', async () => {
    const storage = createTestStorage();
    await storage.set(0x1001, { secret: 'alpha' });
    expect(storage.get(0x1001)?.secret).toBe('alpha');
    expect(storage.listNodeIds()).toEqual([0x1001]);
    expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toContain(`${PREFIX}4097`);
  });

  it('coerces node ids with unsigned shift', async () => {
    const storage = createTestStorage();
    await storage.set(-1 >>> 0, { secret: 'unsigned' });
    expect(storage.get(0xffffffff)?.secret).toBe('unsigned');
  });

  it('skips invalid keys and unparseable values when reading map', () => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        [`${PREFIX}10`]: JSON.stringify({ secret: 'ok' }),
        [`${PREFIX}bad`]: JSON.stringify({ secret: 'skip' }),
        [`${PREFIX}11`]: '',
        other: 'ignored',
      }),
    );
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

  it('rethrows when IPC persist fails after local merge', async () => {
    vi.mocked(window.electronAPI.appSettings.set).mockRejectedValueOnce(new Error('ipc fail'));
    const storage = createTestStorage();
    await expect(storage.set(0x30, { secret: 'x' })).rejects.toThrow('ipc fail');
    expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toContain(`${PREFIX}48`);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONNECTION_HISTORY_MAX,
  connectionHistoryIdentityKey,
  connectionHistoryStorageKey,
  deleteConnectionHistory,
  loadConnectionHistory,
  savedConnectionPrimaryLabel,
  upsertConnectionHistory,
} from './connectionHistoryStorage';
import { loadLastConnection, saveLastConnection } from './lastConnectionStorage';

describe('connectionHistoryStorage', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    });
    vi.stubGlobal('window', {
      location: { href: 'mesh-client://renderer/' },
      electronAPI: {
        appSettings: {
          getAll: vi.fn(() => Promise.resolve({})),
          set: vi.fn(() => Promise.resolve(undefined)),
        },
      },
    });
  });

  it('seeds history from lastConnection when empty', () => {
    saveLastConnection('meshtastic', {
      type: 'tcp',
      httpAddress: '10.0.0.1:4403',
    });
    const history = loadConnectionHistory('meshtastic');
    expect(history).toHaveLength(1);
    expect(history[0]?.type).toBe('tcp');
    expect(history[0]?.httpAddress).toBe('10.0.0.1:4403');
    expect(history[0]?.id).toBeTruthy();
  });

  it('upserts distinct TCP hosts without wiping earlier entries', () => {
    upsertConnectionHistory(
      'meshtastic',
      { type: 'tcp', httpAddress: '10.0.0.1:4403' },
      1000,
      'id-1',
    );
    upsertConnectionHistory(
      'meshtastic',
      { type: 'tcp', httpAddress: '10.0.0.2:4403' },
      2000,
      'id-2',
    );
    const history = loadConnectionHistory('meshtastic');
    expect(history).toHaveLength(2);
    expect(history[0]?.httpAddress).toBe('10.0.0.2:4403');
    expect(history[1]?.httpAddress).toBe('10.0.0.1:4403');
    expect(loadLastConnection('meshtastic')?.httpAddress).toBe('10.0.0.2:4403');
  });

  it('dedups the same host:port and moves it to the front', () => {
    upsertConnectionHistory(
      'meshcore',
      { type: 'http', httpAddress: '192.168.1.10:5000' },
      1000,
      'id-a',
    );
    const next = upsertConnectionHistory(
      'meshcore',
      { type: 'http', httpAddress: '192.168.1.10:5000' },
      2000,
      'id-b',
    );
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe('id-a');
    expect(next[0]?.lastUsedAt).toBe(2000);
  });

  it('keeps meshtastic tcp and meshcom kiss http distinct by type', () => {
    expect(connectionHistoryIdentityKey({ type: 'tcp', httpAddress: '10.0.0.5:4403' })).toBe(
      'tcp:10.0.0.5:4403',
    );
    expect(connectionHistoryIdentityKey({ type: 'http', httpAddress: '10.0.0.5:8001' })).toBe(
      'http:10.0.0.5:8001',
    );
  });

  it('deletes one entry and promotes the next as MRU', () => {
    upsertConnectionHistory(
      'meshtastic',
      { type: 'tcp', httpAddress: '10.0.0.1:4403' },
      1000,
      'id-1',
    );
    upsertConnectionHistory(
      'meshtastic',
      { type: 'tcp', httpAddress: '10.0.0.2:4403' },
      2000,
      'id-2',
    );
    const after = deleteConnectionHistory('meshtastic', 'id-2');
    expect(after).not.toBeNull();
    expect(after).toHaveLength(1);
    expect(after?.[0]?.id).toBe('id-1');
    expect(loadLastConnection('meshtastic')?.httpAddress).toBe('10.0.0.1:4403');
  });

  it('clears MRU when deleting the last remaining entry', () => {
    upsertConnectionHistory(
      'meshcom',
      { type: 'http', httpAddress: '127.0.0.1:8001' },
      1000,
      'id-only',
    );
    deleteConnectionHistory('meshcom', 'id-only');
    expect(loadConnectionHistory('meshcom')).toEqual([]);
    expect(loadLastConnection('meshcom')).toBeNull();
  });

  it('trims history to the max cap', () => {
    for (let i = 0; i < CONNECTION_HISTORY_MAX + 5; i++) {
      upsertConnectionHistory(
        'meshtastic',
        { type: 'tcp', httpAddress: `10.0.0.${i}:4403` },
        i,
        `id-${i}`,
      );
    }
    const history = loadConnectionHistory('meshtastic');
    expect(history).toHaveLength(CONNECTION_HISTORY_MAX);
    expect(history[0]?.httpAddress).toBe(`10.0.0.${CONNECTION_HISTORY_MAX + 4}:4403`);
  });

  it('returns empty history for reticulum', () => {
    expect(loadConnectionHistory('reticulum')).toEqual([]);
    expect(
      upsertConnectionHistory('reticulum', { type: 'tcp', httpAddress: '1.2.3.4:4403' }),
    ).toEqual([]);
  });

  it('derives primary labels from endpoint fields', () => {
    expect(savedConnectionPrimaryLabel({ type: 'ble', bleDeviceName: 'T-Deck' })).toBe('T-Deck');
    expect(savedConnectionPrimaryLabel({ type: 'ble' })).toBeNull();
    expect(savedConnectionPrimaryLabel({ type: 'serial', serialPortId: '/dev/ttyUSB0' })).toBe(
      '/dev/ttyUSB0',
    );
    expect(savedConnectionPrimaryLabel({ type: 'tcp', httpAddress: '10.0.0.9:4403' })).toBe(
      '10.0.0.9:4403',
    );
  });

  it('persists under the protocol-scoped storage key', () => {
    upsertConnectionHistory(
      'meshtastic',
      { type: 'ble', bleDeviceId: 'abc123', bleDeviceName: 'Node' },
      1,
      'ble-1',
    );
    const raw = localStorage.getItem(connectionHistoryStorageKey('meshtastic'));
    expect(raw).toContain('ble-1');
    expect(localStorage.getItem(connectionHistoryStorageKey('meshcore'))).toBeNull();
  });

  it('resolves omitted ports with protocol-aware defaults', () => {
    expect(connectionHistoryIdentityKey({ type: 'tcp', httpAddress: '10.0.0.1' })).toBe(
      'tcp:10.0.0.1:4403',
    );
    expect(
      connectionHistoryIdentityKey({ type: 'http', httpAddress: '10.0.0.1' }, 'meshcore'),
    ).toBe('http:10.0.0.1:5000');
    expect(connectionHistoryIdentityKey({ type: 'http', httpAddress: '10.0.0.1' }, 'meshcom')).toBe(
      'http:10.0.0.1:8001',
    );
    expect(
      connectionHistoryIdentityKey({ type: 'http', httpAddress: '10.0.0.1' }, 'meshtastic'),
    ).toBe('http:10.0.0.1:80');
    expect(connectionHistoryIdentityKey({ type: 'tcp', httpAddress: '10.0.0.1:4404' })).toBe(
      'tcp:10.0.0.1:4404',
    );
  });

  it('does not seed or overwrite when history read throws', () => {
    saveLastConnection('meshtastic', { type: 'tcp', httpAddress: '10.0.0.1:4403' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('quota');
      },
      setItem: () => {
        throw new Error('should not write');
      },
      removeItem: () => {},
      clear: () => {},
    });
    expect(loadConnectionHistory('meshtastic')).toEqual([]);
    expect(
      upsertConnectionHistory('meshtastic', { type: 'tcp', httpAddress: '10.0.0.9:4403' }),
    ).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('skips malformed legacy lastConnection fields during seed', () => {
    localStorage.setItem(
      'mesh-client:lastConnection:meshtastic',
      JSON.stringify({ type: 'tcp', httpAddress: 4403 }),
    );
    expect(loadConnectionHistory('meshtastic')).toEqual([]);
  });

  it('returns null from delete when persist fails and leaves MRU unchanged', () => {
    upsertConnectionHistory(
      'meshtastic',
      { type: 'tcp', httpAddress: '10.0.0.1:4403' },
      1000,
      'id-1',
    );
    upsertConnectionHistory(
      'meshtastic',
      { type: 'tcp', httpAddress: '10.0.0.2:4403' },
      2000,
      'id-2',
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const originalSetItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      if (key.includes('connectionHistory')) {
        throw new Error('persist fail');
      }
      originalSetItem(key, value);
    });
    expect(deleteConnectionHistory('meshtastic', 'id-2')).toBeNull();
    expect(loadLastConnection('meshtastic')?.httpAddress).toBe('10.0.0.2:4403');
    warn.mockRestore();
  });
});

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

  it('backfills from lastConnection when the history key is an empty array', () => {
    localStorage.setItem(connectionHistoryStorageKey('meshcore'), '[]');
    saveLastConnection('meshcore', {
      type: 'http',
      httpAddress: '192.168.1.50:5000',
    });
    const history = loadConnectionHistory('meshcore');
    expect(history).toHaveLength(1);
    expect(history[0]?.httpAddress).toBe('192.168.1.50:5000');
    expect(JSON.parse(localStorage.getItem(connectionHistoryStorageKey('meshcore'))!)).toHaveLength(
      1,
    );
  });

  it('keeps an intentional empty history when there is no MRU', () => {
    localStorage.setItem(connectionHistoryStorageKey('meshtastic'), '[]');
    expect(loadConnectionHistory('meshtastic')).toEqual([]);
  });

  it('persists and reloads the radio name with the endpoint', () => {
    upsertConnectionHistory(
      'meshtastic',
      { type: 'tcp', httpAddress: '10.0.0.9:4403', deviceName: 'Ridge Fox' },
      1000,
      'id-named',
    );
    expect(loadConnectionHistory('meshtastic')[0]?.deviceName).toBe('Ridge Fox');
    expect(loadLastConnection('meshtastic')?.deviceName).toBe('Ridge Fox');
  });

  it('seeds the radio name from lastConnection', () => {
    saveLastConnection('meshtastic', {
      type: 'tcp',
      httpAddress: '10.0.0.1:4403',
      deviceName: 'Ridge Fox',
    });
    const history = loadConnectionHistory('meshtastic');
    expect(history[0]?.deviceName).toBe('Ridge Fox');
  });

  it('keeps a stored radio name when a later upsert omits it', () => {
    upsertConnectionHistory(
      'meshtastic',
      { type: 'tcp', httpAddress: '10.0.0.9:4403', deviceName: 'Ridge Fox' },
      1000,
      'id-named',
    );
    const next = upsertConnectionHistory(
      'meshtastic',
      { type: 'tcp', httpAddress: '10.0.0.9:4403' },
      2000,
      'id-named',
    );
    expect(next?.[0]?.deviceName).toBe('Ridge Fox');
    expect(loadLastConnection('meshtastic')?.deviceName).toBe('Ridge Fox');
  });

  it('updates the stored radio name when the radio is renamed', () => {
    upsertConnectionHistory(
      'meshtastic',
      { type: 'tcp', httpAddress: '10.0.0.9:4403', deviceName: 'Ridge Fox' },
      1000,
      'id-named',
    );
    const next = upsertConnectionHistory(
      'meshtastic',
      { type: 'tcp', httpAddress: '10.0.0.9:4403', deviceName: 'Ridge Fox II' },
      2000,
      'id-named',
    );
    expect(next?.[0]?.deviceName).toBe('Ridge Fox II');
    expect(loadLastConnection('meshtastic')?.deviceName).toBe('Ridge Fox II');
  });

  it('keeps the saved radio name across a MeshCom KISS tcp→http alias', () => {
    upsertConnectionHistory(
      'meshcom',
      { type: 'tcp', httpAddress: '192.168.1.9:8001', deviceName: 'N0CALL' },
      1000,
      'legacy-tcp',
    );
    const next = upsertConnectionHistory(
      'meshcom',
      { type: 'http', httpAddress: '192.168.1.9:8001' },
      2000,
      'http-new',
    );
    expect(next?.[0]?.type).toBe('http');
    expect(next?.[0]?.deviceName).toBe('N0CALL');
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
    expect(next).not.toBeNull();
    expect(next).toHaveLength(1);
    expect(next![0]?.id).toBe('id-a');
    expect(next![0]?.lastUsedAt).toBe(2000);
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
    ).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('replaces MeshCom legacy tcp row when upserting the same KISS http endpoint', () => {
    upsertConnectionHistory(
      'meshcom',
      { type: 'tcp', httpAddress: '192.168.1.9:8001' },
      1000,
      'legacy-tcp',
    );
    const next = upsertConnectionHistory(
      'meshcom',
      { type: 'http', httpAddress: '192.168.1.9:8001' },
      2000,
      'http-new',
    );
    expect(next).toHaveLength(1);
    expect(next?.[0]?.type).toBe('http');
    expect(next?.[0]?.id).toBe('legacy-tcp');
    expect(next?.[0]?.httpAddress).toBe('192.168.1.9:8001');
  });

  it('ignores replaceEntryId when the new endpoint identity does not match the saved row', () => {
    upsertConnectionHistory(
      'meshtastic',
      { type: 'tcp', httpAddress: '10.0.0.1:4403' },
      1000,
      'tcp-row',
    );
    const next = upsertConnectionHistory(
      'meshtastic',
      { type: 'serial', serialPortId: '/dev/ttyUSB0' },
      2000,
      'serial-new',
      { replaceEntryId: 'tcp-row' },
    );
    expect(next).toHaveLength(2);
    expect(next?.find((e) => e.id === 'tcp-row')?.type).toBe('tcp');
    expect(next?.find((e) => e.id === 'serial-new')?.type).toBe('serial');
  });

  it('updates a BLE history row in place when replaceEntryId is set', () => {
    upsertConnectionHistory(
      'meshtastic',
      { type: 'ble', bleMac: 'aa:bb:cc:dd:ee:ff', bleDeviceName: 'Node' },
      1000,
      'mac-row',
    );
    const next = upsertConnectionHistory(
      'meshtastic',
      {
        type: 'ble',
        bleDeviceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        bleMac: 'aa:bb:cc:dd:ee:ff',
        bleDeviceName: 'Node',
      },
      2000,
      'uuid-row',
      { replaceEntryId: 'mac-row' },
    );
    expect(next).toHaveLength(1);
    expect(next?.[0]?.id).toBe('mac-row');
    expect(next?.[0]?.bleDeviceId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('rolls back history when MRU save fails after a successful history persist', () => {
    upsertConnectionHistory(
      'meshtastic',
      { type: 'tcp', httpAddress: '10.0.0.1:4403' },
      1000,
      'id-1',
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const originalSetItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      if (key.includes('lastConnection')) {
        throw new Error('mru fail');
      }
      originalSetItem(key, value);
    });
    expect(
      upsertConnectionHistory(
        'meshtastic',
        { type: 'tcp', httpAddress: '10.0.0.9:4403' },
        2000,
        'id-9',
      ),
    ).toBeNull();
    expect(loadConnectionHistory('meshtastic')).toHaveLength(1);
    expect(loadConnectionHistory('meshtastic')[0]?.httpAddress).toBe('10.0.0.1:4403');
    expect(loadLastConnection('meshtastic')?.httpAddress).toBe('10.0.0.1:4403');
    warn.mockRestore();
  });

  it('skips malformed legacy lastConnection fields during seed', () => {
    localStorage.setItem(
      'mesh-client:lastConnection:meshtastic',
      JSON.stringify({ type: 'tcp', httpAddress: 4403 }),
    );
    expect(loadConnectionHistory('meshtastic')).toEqual([]);
  });

  it('preserves serial path case in identity keys while trimming', () => {
    expect(
      connectionHistoryIdentityKey({ type: 'serial', serialPortId: '  /dev/tty.usbmodem14201  ' }),
    ).toBe('serial:/dev/tty.usbmodem14201');
    expect(
      connectionHistoryIdentityKey({ type: 'serial', serialPortId: '/dev/tty.UsbModem14201' }),
    ).toBe('serial:/dev/tty.UsbModem14201');
    upsertConnectionHistory(
      'meshtastic',
      { type: 'serial', serialPortId: '/dev/tty.usbmodem14201' },
      1,
      'ser-1',
    );
    const next = upsertConnectionHistory(
      'meshtastic',
      { type: 'serial', serialPortId: '/dev/tty.usbmodem14201' },
      2,
      'ser-2',
    );
    expect(next).not.toBeNull();
    expect(next).toHaveLength(1);
    expect(next![0]?.id).toBe('ser-1');
  });

  it('returns null from delete when history read throws without wiping storage', () => {
    upsertConnectionHistory(
      'meshtastic',
      { type: 'tcp', httpAddress: '10.0.0.1:4403' },
      1000,
      'id-1',
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const originalGetItem = localStorage.getItem.bind(localStorage);
    const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation((key: string) => {
      if (key.includes('connectionHistory')) {
        throw new Error('read fail');
      }
      return originalGetItem(key);
    });
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('should not write');
    });
    expect(deleteConnectionHistory('meshtastic', 'id-1')).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    warn.mockRestore();
    getItem.mockRestore();
    setItem.mockRestore();
    expect(loadConnectionHistory('meshtastic')).toHaveLength(1);
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

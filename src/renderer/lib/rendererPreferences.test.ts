// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DURABLE_RENDERER_STORAGE_KEYS } from '@/shared/rendererOrigin';

import joeyPreferences from '../../../e2e/fixtures/renderer-preferences.json';
import { DEFAULT_APP_SETTINGS_SHARED } from './defaultAppSettings';
import { mockConsoleWarn } from './vitestConsoleMock';

const DATABASE_KEY = DURABLE_RENDERER_STORAGE_KEYS.preferences;
class TestStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}
const hub = '0123456789abcdef0123456789abcdef';
const fixtures: Record<string, string> = {
  'mesh-client:appSettings': JSON.stringify({
    ...DEFAULT_APP_SETTINGS_SHARED,
    reticulumAutostart: true,
    reticulumAutoResendOnAnnounce: true,
    unknownFuturePreference: { enabled: false, count: 0 },
  }),
  'mesh-client:lastConnection:meshtastic': JSON.stringify({
    type: 'http',
    httpAddress: 'radio.invalid:4403',
    bleDeviceId: 'ble-1',
    bleDeviceName: 'Radio',
    bleMac: 'aa:bb:cc:dd:ee:ff',
    serialPortId: '/dev/test-radio',
  }),
  'mesh-client:lastConnection:meshcore': JSON.stringify({
    type: 'serial',
    serialPortId: '/dev/test-meshcore',
  }),
  'mesh-client:lastBleDevice:meshcore': 'ble-2',
  'mesh-client:lastSerialPort': '/dev/test-radio',
  'mesh-client:lastSerialPortSignature': JSON.stringify({
    usbVendorId: 123,
    usbProductId: 456,
    bluetoothServiceClassId: null,
  }),
  'mesh-client:bleDeviceMacs': JSON.stringify({ 'ble-1': 'aa:bb:cc:dd:ee:ff' }),
  'mesh-client:bleDeviceNames': JSON.stringify({ 'ble-1': 'Radio' }),
  'mesh-client:mqttSettings': JSON.stringify({
    server: 'mqtt.invalid',
    port: 8883,
    username: 'test',
    topicPrefix: 'msh/test',
    autoLaunch: false,
    maxRetries: 0,
    tokenExpiresAt: 12345,
    useWebSocket: false,
    tlsEnabled: true,
    wsPath: '/mqtt',
  }),
  'mesh-client:mqttSettings:meshcore': JSON.stringify({
    server: 'custom.invalid',
    port: 443,
    username: 'operator',
    topicPrefix: 'meshcore/DEN',
    autoLaunch: true,
    maxRetries: 7,
    tokenExpiresAt: null,
    useWebSocket: true,
    tlsEnabled: true,
    wsPath: '/custom',
  }),
  'mesh-client:mqttPreset:meshcore': 'custom',
  'mesh-client:mqttProfiles:meshtastic': JSON.stringify([
    {
      id: 'profile-1',
      name: 'Saved broker',
      server: 'profile.invalid',
      port: 1883,
      username: 'test',
      topicPrefix: 'custom',
      tlsEnabled: false,
    },
  ]),
  'mesh-client:coloradoMqttRegionAck-v1': '1',
  'mesh-client:migrated:meshcore-letsmesh-default-v1': '1',
  'mesh-client:reticulumInterfaceProfiles': JSON.stringify({
    version: 1,
    profiles: [{ id: 'profile', name: 'Home', members: ['interface-a'] }],
    defaultMembers: ['interface-a'],
  }),
  'mesh-client:reticulumRemoteSettings': JSON.stringify({
    autoReconnectShell: false,
    maxReconnectAttempts: 0,
    autoRetryTransfer: false,
    maxRetryAttempts: 0,
    inboundMode: 'off',
    lastSaveDir: '/tmp/test',
    lastFetchJail: '/tmp/test-jail',
    allowFetch: false,
    overwriteOnReceive: false,
  }),
  'mesh-client:reticulumPropagationMode': 'auto',
  'mesh-client:reticulumSetupGuide': JSON.stringify({ dismissed: true }),
  'mesh-client:rrcNickname': 'SavedNick',
  'mesh-client:rrc:hubAutoJoin': JSON.stringify([hub]),
  [`mesh-client:rrc:autoJoin:${hub}`]: JSON.stringify(['#test']),
  [`mesh-client:rrc:roomFavourites:${hub}`]: JSON.stringify(['#test']),
  [`mesh-client:rrc:recentRooms:${hub}`]: JSON.stringify(['#recent', '#test']),
  [`mesh-client:rrc:activeRoom:${hub}`]: '#test',
  [`mesh-client:rrc:openDms:${hub}`]: JSON.stringify([{ nick: 'Peer', hash: hub }]),
  'mesh-client:rrcHubListCollapsed': '1',
  'mesh-client:rrc:roomListCollapsed': '1',
  'mesh-client:rrc:nickListCollapsed': '0',
  'mesh-client:rrc:listView': 'rooms',
  'mesh-client:gpsSettings': JSON.stringify({
    staticLat: 39.7,
    staticLon: -104.9,
    refreshInterval: 0,
  }),
  'mesh-client:savedLocations': JSON.stringify([{ name: 'Home', lat: 39.7, lon: -104.9 }]),
  'mesh-client:fontScale': '1.1',
  'mesh-client:themeSurface': 'dark',
  'mesh-client:themeColors': JSON.stringify({ appBg: '#101010' }),
  'mesh-client:protocol': 'reticulum',
  'mesh-client:launcherPins': JSON.stringify(['app', 'rrc']),
  'mesh-client:notifMuted': 'true',
  'mesh-client:mqttIgnoredNodes': JSON.stringify(['node-1']),
  'mesh-client:meshcoreIdentity': JSON.stringify({ public_key: 'test-public-identity' }),
};

describe('renderer preference recovery', () => {
  let database: Record<string, string>;
  let stop: (() => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', new TestStorage());
    localStorage.clear();
    database = {};
    vi.mocked(window.electronAPI.appSettings.remove).mockImplementation((key) => {
      Reflect.deleteProperty(database, key);
      return Promise.resolve({ changes: 1 });
    });
    vi.mocked(window.electronAPI.appSettings.set).mockImplementation((key, value) => {
      database[key] = value;
      return Promise.resolve({ changes: 1 });
    });
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.restoreAllMocks();
  });

  async function boot() {
    const prefs = await import('./rendererPreferences');
    await prefs.hydrateRendererPreferences(database);
    stop = prefs.installRendererPreferencePersistence();
    return prefs;
  }

  async function restart() {
    stop?.();
    stop = undefined;
    localStorage.clear();
    vi.resetModules();
    return boot();
  }

  it('preserves every reported field and the five reverted values ahead of stale renderer scalar mirrors', async () => {
    localStorage.setItem('mesh-client:appSettings', JSON.stringify(joeyPreferences));
    Object.assign(database, {
      use24HourTime: 'false',
      mapBasemapId: 'satellite',
      reticulumRmapAnnounceIntervalMin: '60',
      meshtasticConfigureTargetNodeNum: '99',
      aiEnabled: '1',
      translationEnabled: '1',
    });
    await boot();
    await restart();
    const actual = JSON.parse(localStorage.getItem('mesh-client:appSettings')!);
    for (const [field, value] of Object.entries(joeyPreferences))
      expect(actual[field], field).toEqual(value);
    expect(database.use24HourTime).toBe('true');
    expect(database.mapBasemapId).toBe('osm');
    expect(database.reticulumRmapAnnounceIntervalMin).toBe('17');
    expect(database.meshtasticConfigureTargetNodeNum).toBe('7');
  });

  it('synchronizes historical string and numeric alias encodings before their late consumers run', async () => {
    const history = JSON.stringify({ ['ab'.repeat(32)]: [222] });
    localStorage.setItem(
      'mesh-client:appSettings',
      JSON.stringify({
        meshtasticLastRfSelfNodeId: '222',
        meshtasticOwnNodeNumsByPublicKey: history,
        meshtasticConfigureTargetNodeNum: '',
        'meshcoreRoomLastPost:7': 1700000000000,
      }),
    );
    Object.assign(database, {
      meshtasticLastRfSelfNodeId: '111',
      meshtasticOwnNodeNumsByPublicKey: '{}',
      meshtasticConfigureTargetNodeNum: '7',
      'meshcoreRoomLastPost:7': '1',
    });
    await boot();
    expect(database.meshtasticLastRfSelfNodeId).toBe('222');
    expect(database.meshtasticOwnNodeNumsByPublicKey).toBe(history);
    expect(database.meshtasticConfigureTargetNodeNum).toBe('');
    expect(database['meshcoreRoomLastPost:7']).toBe('1700000000000');
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValue(database);
    const identity = await import('./meshtasticMqttIdentity');
    expect(await identity.hydrateLastRfSelfNodeIdFromAppSettings()).toBe(222);
  });

  it.each([{}, { use24HourTime: true }])(
    'removes omitted renderer aliases before late consumers can restore them: %j',
    async (app) => {
      const values = Object.keys(app).length ? { 'mesh-client:appSettings': app } : {};
      const native = {
        aiEnabled: '1',
        translationEnabled: '1',
        closeToTray: '0',
        autoUpdateDownloadEnabled: '0',
      };
      Object.assign(database, native, {
        [DATABASE_KEY]: JSON.stringify({ legacyAliasesImported: true, values }),
        meshtasticLastRfSelfNodeId: '111',
        meshtasticOwnNodeNumsByPublicKey: JSON.stringify({ ['ab'.repeat(32)]: [111] }),
        notificationSounds: JSON.stringify({ dm: { sound: 'bell', volume: 33 } }),
        'meshtasticRemoteAdminKey:7': 'old-public-key',
        'meshcoreRoomLastPost:7': '123',
        unrelatedDomain: 'keep',
      });
      await boot();
      for (const key of [
        'meshtasticLastRfSelfNodeId',
        'meshtasticOwnNodeNumsByPublicKey',
        'notificationSounds',
        'meshtasticRemoteAdminKey:7',
        'meshcoreRoomLastPost:7',
      ])
        expect(database[key], key).toBeUndefined();
      expect(database).toMatchObject({ ...native, unrelatedDomain: 'keep' });
      vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValue(database);
      const identity = await import('./meshtasticMqttIdentity');
      expect(await identity.hydrateLastRfSelfNodeIdFromAppSettings()).toBe(0);
      const sounds = await import('./notificationSoundSettings');
      await sounds.loadNotificationSoundSettings();
      expect(JSON.parse(localStorage.getItem('mesh-client:appSettings') ?? '{}')).toEqual(app);
    },
  );

  it.each(['meshtastic', 'meshcore', 'reticulum', 'rrc'])(
    'keeps %s retention in SQLite after a later direct save and when the app blob is removed',
    async (protocol) => {
      const enabled = `${protocol}MessageRetentionEnabled`;
      const count = `${protocol}MessageRetentionCount`;
      Object.assign(database, { [enabled]: '1', [count]: '10000' });
      await boot();
      await window.electronAPI.appSettings.set(enabled, '0');
      await window.electronAPI.appSettings.set(count, '50000');
      await restart();
      expect(database).toMatchObject({ [enabled]: '0', [count]: '50000' });
      localStorage.removeItem('mesh-client:appSettings');
      await (await import('./rendererPreferences')).flushRendererPreferences();
      await restart();
      expect(database).toMatchObject({ [enabled]: '0', [count]: '50000' });
      vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValue(database);
      const { fetchMessageRetention } = await import('./messageRetention');
      expect(await fetchMessageRetention()).toMatchObject({
        [`${protocol}Enabled`]: false,
        [`${protocol}Count`]: 50000,
      });
    },
  );

  it('does not reconcile aliases over a malformed legacy app record awaiting recovery', async () => {
    localStorage.setItem('mesh-client:appSettings', '{broken');
    database[DATABASE_KEY] = JSON.stringify({ legacyAliasesImported: true, values: {} });
    database.meshtasticLastRfSelfNodeId = '111';
    await boot();
    expect(localStorage.getItem('mesh-client:appSettings')).toBe('{broken');
    expect(database.meshtasticLastRfSelfNodeId).toBe('111');
  });

  it.each(Object.keys(fixtures))(
    'restores each saved field of %s after origin cache loss',
    async (key) => {
      localStorage.setItem(key, fixtures[key]);
      await boot();
      await restart();
      expect(localStorage.getItem(key)).toBe(fixtures[key]);
      const expected: unknown = (() => {
        try {
          return JSON.parse(fixtures[key]);
        } catch {
          return fixtures[key];
        }
      })();
      if (typeof expected === 'object' && expected !== null && !Array.isArray(expected)) {
        for (const [field, value] of Object.entries(expected)) {
          expect(JSON.parse(localStorage.getItem(key)!)[field], `${key}.${field}`).toEqual(value);
        }
      }
    },
  );

  it('persists ordinary setters, removals, recreation and clear without treating sessionStorage as preferences', async () => {
    const prefs = await boot();
    localStorage.setItem('mesh-client:rrcNickname', 'NewNick');
    sessionStorage.setItem('mesh-client:rrcNickname', 'session-only');
    await prefs.flushRendererPreferences();
    await restart();
    expect(localStorage.getItem('mesh-client:rrcNickname')).toBe('NewNick');
    localStorage.removeItem('mesh-client:rrcNickname');
    const active = await import('./rendererPreferences');
    await active.flushRendererPreferences();
    await restart();
    expect(localStorage.getItem('mesh-client:rrcNickname')).toBeNull();
    localStorage.setItem('mesh-client:rrcNickname', 'Recreated');
    await (await import('./rendererPreferences')).flushRendererPreferences();
    await restart();
    expect(localStorage.getItem('mesh-client:rrcNickname')).toBe('Recreated');
    localStorage.clear();
    await (await import('./rendererPreferences')).flushRendererPreferences();
    await restart();
    expect(localStorage.getItem('mesh-client:rrcNickname')).toBeNull();
  });

  it('keeps newer canonical choices and deliberate removals ahead of an old exported browser snapshot', async () => {
    localStorage.setItem('mesh-client:rrcNickname', 'Original');
    const prefs = await boot();
    localStorage.setItem('mesh-client:rrcNickname', 'Updated');
    localStorage.setItem('mesh-client:rrc:hubAutoJoin', '[]');
    localStorage.removeItem('mesh-client:fontScale');
    await prefs.flushRendererPreferences();
    stop?.();
    stop = undefined;
    localStorage.clear();
    for (const [key, value] of Object.entries(fixtures)) localStorage.setItem(key, value);
    vi.resetModules();
    await boot();
    expect(localStorage.getItem('mesh-client:rrcNickname')).toBe('Updated');
    expect(localStorage.getItem('mesh-client:rrc:hubAutoJoin')).toBe('[]');
    expect(localStorage.getItem('mesh-client:fontScale')).toBeNull();
  });

  it('imports scalar owners with their exact codecs once, including zero/false and direct identity aliases', async () => {
    localStorage.setItem('mesh-client:appSettings', '{"unknown":42}');
    localStorage.setItem('mesh-client:meshcoreLastSelfNodeId', '111');
    localStorage.setItem('mesh-client:reticulumLastSelfLxmfHash', 'old');
    Object.assign(database, {
      reticulumAutostart: '1',
      reticulumAutoResendOnAnnounce: '1',
      closeToTray: '0',
      use24HourTime: 'false',
      reticulumRmapHeightMeters: '0',
      notificationSounds: '{"test":false}',
      meshtasticOwnNodeNumsByPublicKey: '{"key":7}',
      meshcoreLastSelfNodeId: '222',
      reticulumLastSelfLxmfHash: 'new',
      'meshcoreRoomSync:7': '{"enabled":true}',
    });
    const prefs = await boot();
    expect(JSON.parse(localStorage.getItem('mesh-client:appSettings')!)).toMatchObject({
      unknown: 42,
      reticulumAutostart: true,
      reticulumAutoResendOnAnnounce: true,
      closeToTray: false,
      use24HourTime: false,
      reticulumRmapHeightMeters: 0,
      notificationSounds: { test: false },
      meshtasticOwnNodeNumsByPublicKey: { key: 7 },
      'meshcoreRoomSync:7': '{"enabled":true}',
    });
    expect(localStorage.getItem('mesh-client:meshcoreLastSelfNodeId')).toBe('111');
    expect(localStorage.getItem('mesh-client:reticulumLastSelfLxmfHash')).toBe('old');
    localStorage.setItem('mesh-client:appSettings', '{"reticulumAutostart":false}');
    await prefs.flushRendererPreferences();
    await restart();
    expect(JSON.parse(localStorage.getItem('mesh-client:appSettings')!).reticulumAutostart).toBe(
      false,
    );
  });

  it('retains legacy secrets for the secure initializer but never puts them in the canonical preference row', async () => {
    localStorage.setItem(
      'mesh-client:mqttSettings',
      '{"server":"custom","password":"SECRET-A","channelPsks":["SECRET-B"]}',
    );
    localStorage.setItem(
      'mesh-client:mqttProfiles:meshtastic',
      '[{"id":"one","server":"profile","password":"SECRET-C"}]',
    );
    localStorage.setItem(
      'mesh-client:meshcoreIdentity',
      '{"public_key":"public","private_key":"SECRET-D"}',
    );
    localStorage.setItem(
      'mesh-client:appSettings',
      '{"reticulumAutostart":true,"meshcoreRoomCredential:42":"SECRET-E"}',
    );
    localStorage.setItem('mesh-client:credentialCompatibility:mqtt:meshcore', '"SECRET-F"');
    await boot();
    for (const secret of ['SECRET-A', 'SECRET-B', 'SECRET-C', 'SECRET-D', 'SECRET-E', 'SECRET-F'])
      expect(database[DATABASE_KEY]).not.toContain(secret);
    expect(localStorage.getItem('mesh-client:mqttSettings')).toContain('SECRET-A');
    expect(localStorage.getItem('mesh-client:mqttProfiles:meshtastic')).toContain('SECRET-C');
    expect(localStorage.getItem('mesh-client:meshcoreIdentity')).toContain('SECRET-D');
    expect(localStorage.getItem('mesh-client:appSettings')).toContain('SECRET-E');
    await restart();
    expect(localStorage.getItem('mesh-client:meshcoreIdentity')).toBe('{"public_key":"public"}');
    expect(localStorage.getItem('mesh-client:mqttSettings')).not.toContain('SECRET-A');
  });

  it('retains a failed write journal and replays only changed preferences over a newer canonical map', async () => {
    localStorage.setItem('mesh-client:rrcNickname', 'Original');
    const prefs = await boot();
    const warn = mockConsoleWarn();
    vi.mocked(window.electronAPI.appSettings.set).mockRejectedValue(new Error('write unavailable'));
    localStorage.setItem('mesh-client:rrcNickname', 'OfflineEdit');
    await prefs.flushRendererPreferences();
    expect(localStorage.getItem(`mesh-client:durablePending:${DATABASE_KEY}`)).toContain(
      'OfflineEdit',
    );
    const updated = JSON.parse(database[DATABASE_KEY]);
    updated.values['mesh-client:fontScale'] = '1.2';
    database[DATABASE_KEY] = JSON.stringify(updated);
    stop?.();
    stop = undefined;
    vi.resetModules();
    vi.mocked(window.electronAPI.appSettings.set).mockImplementation((key, value) => {
      database[key] = value;
      return Promise.resolve({ changes: 1 });
    });
    await boot();
    expect(localStorage.getItem('mesh-client:rrcNickname')).toBe('OfflineEdit');
    expect(localStorage.getItem('mesh-client:fontScale')).toBe('1.2');
    expect(localStorage.getItem(`mesh-client:durablePending:${DATABASE_KEY}`)).toBeNull();
    warn.restore();
  });

  it('replays a pending app-field edit without reverting an unrelated newer app-field choice', async () => {
    localStorage.setItem(
      'mesh-client:appSettings',
      '{"distanceUnit":"miles","reticulumAutostart":true}',
    );
    const prefs = await boot();
    const warn = mockConsoleWarn();
    vi.mocked(window.electronAPI.appSettings.set).mockRejectedValue(new Error('offline'));
    localStorage.setItem(
      'mesh-client:appSettings',
      '{"distanceUnit":"km","reticulumAutostart":true}',
    );
    await prefs.flushRendererPreferences();
    const saved = JSON.parse(database[DATABASE_KEY]);
    saved.values['mesh-client:appSettings'].reticulumAutostart = false;
    database[DATABASE_KEY] = JSON.stringify(saved);
    stop?.();
    stop = undefined;
    vi.resetModules();
    vi.mocked(window.electronAPI.appSettings.set).mockImplementation((key, value) => {
      database[key] = value;
      return Promise.resolve({ changes: 1 });
    });
    await boot();
    expect(JSON.parse(localStorage.getItem('mesh-client:appSettings')!)).toEqual({
      distanceUnit: 'km',
      reticulumAutostart: false,
    });
    warn.restore();
  });

  it('does not let Retry skip a failed browser-cache restoration after the SQLite adapter ACK', async () => {
    database[DATABASE_KEY] = JSON.stringify({
      legacyAliasesImported: true,
      values: {
        'mesh-client:rrcNickname': 'Saved',
        'mesh-client:mqttSettings': { server: 'saved.invalid', autoLaunch: true },
      },
    });
    const prefs = await import('./rendererPreferences');
    const originalSet = localStorage.setItem.bind(localStorage);
    const set = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === 'mesh-client:rrcNickname') throw new Error('QuotaExceededError');
      originalSet(key, value);
    });
    await expect(prefs.hydrateRendererPreferences(database)).rejects.toThrow('QuotaExceededError');
    await expect(prefs.hydrateRendererPreferences(database)).rejects.toThrow('QuotaExceededError');
    expect(localStorage.getItem('mesh-client:rrcNickname')).toBeNull();
    set.mockRestore();
    await prefs.hydrateRendererPreferences(database);
    expect(localStorage.getItem('mesh-client:rrcNickname')).toBe('Saved');
    expect(JSON.parse(localStorage.getItem('mesh-client:mqttSettings')!).autoLaunch).toBe(true);
  });

  it('rejects corrupt structured preference content on every retry until corrected', async () => {
    database[DATABASE_KEY] = JSON.stringify({
      legacyAliasesImported: true,
      values: { 'mesh-client:mqttSettings': '[]' },
    });
    const prefs = await import('./rendererPreferences');
    await expect(prefs.hydrateRendererPreferences(database)).rejects.toThrow('Invalid structured');
    await expect(prefs.hydrateRendererPreferences(database)).rejects.toThrow('Invalid structured');
    database[DATABASE_KEY] = JSON.stringify({
      legacyAliasesImported: true,
      values: { 'mesh-client:mqttSettings': { server: 'recovered.invalid' } },
    });
    await prefs.hydrateRendererPreferences(database);
    expect(JSON.parse(localStorage.getItem('mesh-client:mqttSettings')!).server).toBe(
      'recovered.invalid',
    );
  });

  it.each([
    'appSettings',
    'adminSettings',
    'mqttSettings',
    'mqttSettings:meshcore',
    'mqttProfiles:meshtastic',
    'meshcoreIdentity',
  ])('keeps malformed credential-bearing %s out of the new plaintext backup', async (suffix) => {
    const key = `mesh-client:${suffix}`;
    const malformed = '{"password":"MALFORMED-SECRET","server":';
    localStorage.setItem(key, malformed);
    await boot();
    expect(database[DATABASE_KEY]).not.toContain('MALFORMED-SECRET');
    expect(localStorage.getItem(key)).toBe(malformed);
  });

  it.each(['not-json', '{"values":null}', '{"values":{"mesh-client:rrcNickname":42}}'])(
    'rejects corrupt canonical data without overwriting it and can retry after repair: %s',
    async (raw) => {
      database[DATABASE_KEY] = raw;
      const prefs = await import('./rendererPreferences');
      await expect(prefs.hydrateRendererPreferences(database)).rejects.toThrow();
      expect(database[DATABASE_KEY]).toBe(raw);
      database[DATABASE_KEY] = JSON.stringify({
        legacyAliasesImported: true,
        values: { 'mesh-client:rrcNickname': 'Recovered' },
      });
      await prefs.hydrateRendererPreferences(database);
      expect(localStorage.getItem('mesh-client:rrcNickname')).toBe('Recovered');
    },
  );

  it.each([
    'appSettings',
    'adminSettings',
    'mqttSettings',
    'mqttSettings:meshcore',
    'mqttProfiles:meshtastic',
    'meshcoreIdentity',
  ])('excludes wrong-shaped credential-bearing %s from the non-secret backup', async (suffix) => {
    const key = `mesh-client:${suffix}`;
    for (const value of ['PRIVATE-INVALID-SHAPE', ['PRIVATE-INVALID-SHAPE'], null]) {
      localStorage.setItem(key, JSON.stringify(value));
      const prefs = await boot();
      await prefs.flushRendererPreferences();
      expect(database[DATABASE_KEY]).not.toContain('PRIVATE-INVALID-SHAPE');
      expect(localStorage.getItem(key)).toBe(JSON.stringify(value));
    }
  });
});

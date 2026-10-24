import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DURABLE_RENDERER_STORAGE_KEYS as KEYS } from '@/shared/rendererOrigin';

import { mockConsoleWarn } from './vitestConsoleMock';

describe('durable renderer startup hydration', () => {
  let database: Record<string, string>;

  beforeEach(() => {
    vi.mocked(window.electronAPI.appSettings.set).mockReset();
    vi.mocked(window.electronAPI.appSettings.getAll).mockReset();
    vi.resetModules();
    localStorage.clear();
    database = {};
    vi.spyOn(window.electronAPI.appSettings, 'getAll').mockImplementation(() =>
      Promise.resolve({
        ...database,
      }),
    );
    vi.spyOn(window.electronAPI.appSettings, 'set').mockImplementation((key, value) => {
      database[key] = value;
      return Promise.resolve({ changes: 1 });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('refreshes eager weather and dismissed-contact stores after restoring their browser caches', async () => {
    const startup = await import('./hydrateDurableRendererSettings');
    const { useWeatherFilterStore } = await import('../stores/weatherFilterStore');
    const { useReticulumPeerStore } = await import('../stores/reticulumPeerStore');
    expect(useWeatherFilterStore.getState().hideInChannels).toBe(false);
    const hash = 'ab'.repeat(16);
    database[KEYS.preferences] = JSON.stringify({
      legacyAliasesImported: true,
      values: {
        'mesh-client:appSettings': {
          weatherFilterHideInChannels: true,
          weatherFilterPattern: 'migration weather',
          weatherOnlinePlaceLookup: true,
        },
        'mesh-client:reticulumDismissedContacts': [hash],
      },
    });
    await startup.hydrateDurableRendererSettings();
    expect(useWeatherFilterStore.getState()).toMatchObject({
      hideInChannels: true,
      pattern: 'migration weather',
      onlinePlaceLookup: true,
    });
    expect(useReticulumPeerStore.getState().dismissedContactHashes.has(hash)).toBe(true);
  });

  it.each(['meshtastic', 'meshcore', 'reticulum'] as const)(
    'seeds and restores %s chat reads, then persists advancing and clearing them',
    async (protocol) => {
      localStorage.setItem(`mesh-client:lastRead:${protocol}`, '{"ch:0":123,"dm:7":456}');
      const { hydrateDurableRendererSettings } = await import('./hydrateDurableRendererSettings');
      await hydrateDurableRendererSettings();
      expect(JSON.parse(database[KEYS.chatLastRead[protocol]])).toEqual({
        'ch:0': 123,
        'dm:7': 456,
      });
      localStorage.clear();
      vi.resetModules();
      const startup = await import('./hydrateDurableRendererSettings');
      const chat = await import('./chatPanelProtocolStorage');
      await startup.hydrateDurableRendererSettings();
      expect(chat.loadPersistedLastReadInitial(protocol)).toEqual({ 'ch:0': 123, 'dm:7': 456 });
      chat.savePersistedLastRead(protocol, { 'ch:0': 999, 'dm:7': 456 });
      await vi.waitFor(() => {
        expect(JSON.parse(database[KEYS.chatLastRead[protocol]])['ch:0']).toBe(999);
      });
      chat.removePersistedLastReadForChannel(protocol, 0);
      await vi.waitFor(() => {
        expect(JSON.parse(database[KEYS.chatLastRead[protocol]])).toEqual({ 'dm:7': 456 });
      });
      chat.clearPersistedLastReadForProtocol(protocol);
      await vi.waitFor(() => {
        expect(database[KEYS.chatLastRead[protocol]]).toBe('{}');
      });
    },
  );

  it('seeds legacy Meshtastic reads once and never resurrects a cleared canonical watermark', async () => {
    localStorage.setItem('mesh-client:lastRead', '{"ch:0":123}');
    const { hydrateDurableRendererSettings } = await import('./hydrateDurableRendererSettings');
    const chat = await import('./chatPanelProtocolStorage');
    await hydrateDurableRendererSettings();
    expect(chat.loadPersistedLastReadInitial('meshtastic')).toEqual({ 'ch:0': 123 });
    chat.clearPersistedLastReadForProtocol('meshtastic');
    expect(chat.loadPersistedLastReadInitial('meshtastic')).toEqual({});
    await vi.waitFor(() => {
      expect(database[KEYS.chatLastRead.meshtastic]).toBe('{}');
    });
    expect(localStorage.getItem('mesh-client:lastRead')).toBe('{"ch:0":123}');
  });

  it('restores MeshCore room and RRC boundaries without localStorage and writes later reads', async () => {
    database[KEYS.roomsLastRead] = '{"7":123}';
    database[KEYS.rrcLastRead] = '{"hub::lobby":456}';
    const { hydrateDurableRendererSettings } = await import('./hydrateDurableRendererSettings');
    const chat = await import('./chatPanelProtocolStorage');
    const rrc = await import('./rrcReadWatermark');
    await hydrateDurableRendererSettings();
    expect(chat.loadPersistedRoomsLastRead()).toEqual({ 7: 123 });
    expect(rrc.loadPersistedRrcLastRead()).toEqual({ 'hub::lobby': 456 });
    chat.savePersistedRoomsLastRead({ 7: 789 });
    rrc.mergeRrcReadWatermark('hub', '#lobby', 999);
    await vi.waitFor(() => {
      expect(database[KEYS.roomsLastRead]).toBe('{"7":789}');
    });
    await vi.waitFor(() => {
      expect(database[KEYS.rrcLastRead]).toBe('{"hub::lobby":999}');
    });
    chat.clearPersistedRoomsLastRead();
    rrc.savePersistedRrcLastRead({});
    await vi.waitFor(() => {
      expect(database[KEYS.roomsLastRead]).toBe('{}');
    });
    await vi.waitFor(() => {
      expect(database[KEYS.rrcLastRead]).toBe('{}');
    });
  });

  it.each(['meshtastic', 'meshcore', 'reticulum'] as const)(
    'seeds %s MECP blocks and restores them after local storage is wiped',
    async (protocol) => {
      const blockKey = `${protocol}:7`;
      const blocked = { [blockKey]: { protocol, senderId: '7', label: 'Seven', createdAt: 10 } };
      localStorage.setItem(
        'mesh-client:mecpBlockedSenders',
        JSON.stringify({ state: { blocked }, version: 1 }),
      );
      const startup = await import('./hydrateDurableRendererSettings');
      await startup.hydrateDurableRendererSettings();
      localStorage.clear();
      vi.resetModules();
      const restored = await import('./hydrateDurableRendererSettings');
      const mecp = await import('../stores/mecpBlockStore');
      await restored.hydrateDurableRendererSettings();
      expect(mecp.isMecpSenderBlocked(protocol, '7')).toBe(true);
      mecp.useMecpBlockStore.getState().unblock(protocol, '7');
      await vi.waitFor(() => {
        expect(JSON.parse(database[KEYS.mecpBlockedSenders]).state.blocked).toEqual({});
      });
    },
  );

  it('migrates TAK slot settings and retired contacts into SQLite and restores them without LS', async () => {
    localStorage.setItem(
      'mesh-client:takRelayPrefs',
      JSON.stringify({
        state: {
          byIdentity: {
            radio: { trackerChannels: [1], chatBridges: { 1: 'Ops' }, chatSendChannels: [1] },
          },
        },
        version: 1,
      }),
    );
    const startup = await import('./hydrateDurableRendererSettings');
    await startup.hydrateDurableRendererSettings();
    const persisted = JSON.parse(database[KEYS.takRelayPrefs]);
    expect(persisted.version).toBe(3);
    expect(persisted.state.byIdentity.radio.pendingSlots).toMatchObject({
      chatChannels: [1],
      sendChannels: [1],
    });
    expect(persisted.state.retiredRooms.rooms).toEqual(['Ops']);
    localStorage.clear();
    vi.resetModules();
    const restored = await import('./hydrateDurableRendererSettings');
    const tak = await import('../stores/takRelayPrefsStore');
    await restored.hydrateDurableRendererSettings();
    expect(tak.getTakRetiredRooms()).toEqual(['Ops']);
    tak.bindTakPendingSlots('radio', [{ index: 1, key: '0123456789abcdef' }]);
    await vi.waitFor(() => {
      expect(JSON.parse(database[KEYS.takRelayPrefs]).state.byIdentity.radio.chatChannels).toEqual([
        '0123456789abcdef',
      ]);
    });
  });

  it('does not treat automatic stale TAK cache migration as a user edit over SQLite', async () => {
    localStorage.setItem(
      'mesh-client:takRelayPrefs',
      JSON.stringify({ state: { byIdentity: { stale: { trackerChannels: [1] } } }, version: 1 }),
    );
    database[KEYS.takRelayPrefs] = JSON.stringify({
      state: { byIdentity: {}, retiredRooms: null },
      version: 3,
    });
    const { hydrateDurableRendererSettings } = await import('./hydrateDurableRendererSettings');
    const tak = await import('../stores/takRelayPrefsStore');
    await hydrateDurableRendererSettings();
    expect(tak.useTakRelayPrefsStore.getState().byIdentity).toEqual({});
  });

  it('retains edits made while the startup DB read is unresolved', async () => {
    let resolve!: (settings: Record<string, string>) => void;
    vi.mocked(window.electronAPI.appSettings.getAll).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { hydrateDurableRendererSettings } = await import('./hydrateDurableRendererSettings');
    const mecp = await import('../stores/mecpBlockStore');
    const startup = hydrateDurableRendererSettings();
    await vi.waitFor(() => {
      expect(resolve).toBeTypeOf('function');
    });
    mecp.useMecpBlockStore.getState().block('meshcore', '9');
    resolve({
      [KEYS.mecpBlockedSenders]: JSON.stringify({
        state: {
          blocked: {
            'reticulum:7': { protocol: 'reticulum', senderId: '7', label: 'Seven', createdAt: 1 },
          },
        },
        version: 1,
      }),
    });
    await startup;
    expect(mecp.isMecpSenderBlocked('meshcore', '9')).toBe(true);
    expect(mecp.isMecpSenderBlocked('reticulum', '7')).toBe(true);
  });

  it('keeps recovery state and does not write defaults after an unsuccessful DB read', async () => {
    const warn = mockConsoleWarn();
    vi.mocked(window.electronAPI.appSettings.getAll).mockRejectedValue(
      new Error('database unavailable'),
    );
    localStorage.setItem('mesh-client:lastRead:meshcore', '{"ch:0":123}');
    const { hydrateDurableRendererSettings } = await import('./hydrateDurableRendererSettings');
    const chat = await import('./chatPanelProtocolStorage');
    vi.useFakeTimers();
    const startup = hydrateDurableRendererSettings();
    const failedStartup = expect(startup).rejects.toThrow('Saved settings database unavailable');
    await vi.advanceTimersByTimeAsync(1250);
    await failedStartup;
    chat.savePersistedLastRead('meshcore', { 'ch:0': 456 });
    await vi.runAllTimersAsync();
    expect(window.electronAPI.appSettings.getAll).toHaveBeenCalledTimes(3);
    expect(chat.loadPersistedLastReadInitial('meshcore')).toEqual({ 'ch:0': 456 });
    expect(window.electronAPI.appSettings.set).not.toHaveBeenCalled();
    warn.restore();
  });

  it.each(['meshtastic', 'meshcore', 'reticulum'] as const)(
    'retries a transient startup read and merges pending %s changes with SQLite',
    async (protocol) => {
      const warn = mockConsoleWarn();
      database[KEYS.chatLastRead[protocol]] = '{"ch:0":123,"ch:7":789}';
      database[KEYS.mecpBlockedSenders] = JSON.stringify({
        state: {
          blocked: {
            'reticulum:7': { protocol: 'reticulum', senderId: '7', label: 'Seven', createdAt: 1 },
          },
        },
        version: 1,
      });
      database[KEYS.takRelayPrefs] = JSON.stringify({
        state: {
          byIdentity: {
            radio: {
              trackerChannels: [7],
              channelMode: 'selected',
              chatChannels: ['0123456789abcdef'],
              directMessages: false,
            },
          },
          retiredRooms: null,
        },
        version: 3,
      });
      vi.mocked(window.electronAPI.appSettings.getAll).mockRejectedValueOnce(
        new Error('database busy'),
      );
      const { hydrateDurableRendererSettings } = await import('./hydrateDurableRendererSettings');
      const chat = await import('./chatPanelProtocolStorage');
      const mecp = await import('../stores/mecpBlockStore');
      const tak = await import('../stores/takRelayPrefsStore');
      vi.useFakeTimers();
      const startup = hydrateDurableRendererSettings();
      expect(hydrateDurableRendererSettings()).toBe(startup);
      await vi.advanceTimersByTimeAsync(249);
      chat.savePersistedLastRead(protocol, { 'ch:0': 456 });
      mecp.useMecpBlockStore.getState().block(protocol, '9');
      tak.useTakRelayPrefsStore.getState().setDirectMessages('radio', true);
      expect(window.electronAPI.appSettings.getAll).toHaveBeenCalledTimes(1);
      expect(window.electronAPI.appSettings.set).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await startup;
      expect(window.electronAPI.appSettings.getAll).toHaveBeenCalledTimes(2);
      expect(JSON.parse(database[KEYS.chatLastRead[protocol]])).toEqual({
        'ch:0': 456,
        'ch:7': 789,
      });
      expect(mecp.isMecpSenderBlocked(protocol, '9')).toBe(true);
      expect(mecp.isMecpSenderBlocked('reticulum', '7')).toBe(true);
      expect(JSON.parse(database[KEYS.mecpBlockedSenders]).state.blocked).toHaveProperty(
        `${protocol}:9`,
      );
      expect(JSON.parse(database[KEYS.mecpBlockedSenders]).state.blocked).toHaveProperty(
        'reticulum:7',
      );
      expect(JSON.parse(database[KEYS.takRelayPrefs]).state.byIdentity.radio).toMatchObject({
        trackerChannels: [7],
        channelMode: 'selected',
        chatChannels: ['0123456789abcdef'],
        directMessages: true,
      });
      warn.restore();
    },
  );

  it('allows another hydration attempt after exhausting the bounded read retries', async () => {
    const warn = mockConsoleWarn();
    database[KEYS.chatLastRead.meshcore] = '{"ch:7":789}';
    vi.mocked(window.electronAPI.appSettings.getAll).mockRejectedValue(
      new Error('database unavailable'),
    );
    const { hydrateDurableRendererSettings } = await import('./hydrateDurableRendererSettings');
    const chat = await import('./chatPanelProtocolStorage');
    vi.useFakeTimers();
    const startup = hydrateDurableRendererSettings();
    const failedStartup = expect(startup).rejects.toThrow('Saved settings database unavailable');
    await vi.advanceTimersByTimeAsync(1250);
    await failedStartup;
    chat.savePersistedLastRead('meshcore', { 'ch:0': 456 });
    expect(window.electronAPI.appSettings.set).not.toHaveBeenCalled();
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValue({ ...database });
    await hydrateDurableRendererSettings();
    expect(JSON.parse(database[KEYS.chatLastRead.meshcore])).toEqual({
      'ch:0': 456,
      'ch:7': 789,
    });
    warn.restore();
  });

  it('retains unrelated TAK fields when the first edit races the initial SQLite read', async () => {
    let resolve!: (settings: Record<string, string>) => void;
    vi.mocked(window.electronAPI.appSettings.getAll).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { hydrateDurableRendererSettings } = await import('./hydrateDurableRendererSettings');
    const tak = await import('../stores/takRelayPrefsStore');
    const startup = hydrateDurableRendererSettings();
    await vi.waitFor(() => {
      expect(resolve).toBeTypeOf('function');
    });
    tak.useTakRelayPrefsStore.getState().setDirectMessages('radio', true);
    resolve({
      [KEYS.takRelayPrefs]: JSON.stringify({
        state: {
          byIdentity: {
            radio: {
              trackerChannels: [7],
              channelMode: 'selected',
              chatChannels: ['0123456789abcdef'],
              directMessages: false,
            },
          },
          retiredRooms: null,
        },
        version: 3,
      }),
    });
    await startup;
    expect(tak.getTakRelayPrefs('radio')).toMatchObject({
      trackerChannels: [7],
      channelMode: 'selected',
      chatChannels: ['0123456789abcdef'],
      directMessages: true,
    });
  });

  it('hydrates healthy read namespaces even if another protocol has corrupt durable JSON', async () => {
    const warn = mockConsoleWarn();
    database[KEYS.chatLastRead.meshtastic] = 'broken';
    database[KEYS.chatLastRead.meshcore] = '{"ch:0":123}';
    database[KEYS.chatLastRead.reticulum] = '{"dm:7":456}';
    database[KEYS.roomsLastRead] = '{"7":789}';
    const { hydrateDurableRendererSettings } = await import('./hydrateDurableRendererSettings');
    const chat = await import('./chatPanelProtocolStorage');
    await hydrateDurableRendererSettings();
    expect(chat.loadPersistedLastReadInitial('meshcore')).toEqual({ 'ch:0': 123 });
    expect(chat.loadPersistedLastReadInitial('reticulum')).toEqual({ 'dm:7': 456 });
    expect(chat.loadPersistedRoomsLastRead()).toEqual({ 7: 789 });
    expect(database[KEYS.chatLastRead.meshtastic]).toBe('broken');
    warn.restore();
  });
});

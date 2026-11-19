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

// Marks saved before reads went by arrival were the newest read stamp, up to 300 s ahead of the
// clock; a receipt taken after the upgrade inside that window would count as read.
/** A prototype-backed Storage, so the preference write-through (a Storage.prototype patch) runs. */
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

describe('read marks saved before reads went by arrival', () => {
  const start = 1_800_000_000_000;
  let database: Record<string, string>;

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', new TestStorage());
    localStorage.clear();
    database = {};
    vi.spyOn(window.electronAPI.appSettings, 'getAll').mockImplementation(() =>
      Promise.resolve({ ...database }),
    );
    vi.spyOn(window.electronAPI.appSettings, 'set').mockImplementation((key, value) => {
      database[key] = value;
      return Promise.resolve({ changes: 1 });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Hydrate as startup does, with the preference write-through installed afterwards. */
  async function launch() {
    vi.resetModules();
    localStorage.clear();
    const startup = await import('./hydrateDurableRendererSettings');
    const chat = await import('./chatPanelProtocolStorage');
    const preferences = await import('./rendererPreferences');
    await startup.hydrateDurableRendererSettings();
    const stop = preferences.installRendererPreferencePersistence();
    return { chat, preferences, stop };
  }

  it('lowers chat and room marks ahead of the first start to the start, once', async () => {
    for (const protocol of ['meshtastic', 'meshcore', 'reticulum'] as const) {
      database[KEYS.chatLastRead[protocol]] = JSON.stringify({
        'ch:0': start + 120_000,
        'dm:7': start - 5_000,
      });
    }
    database[KEYS.roomsLastRead] = JSON.stringify({ 512: start + 200_000, 513: start - 1 });
    const { chat, preferences, stop } = await launch();
    try {
      expect(chat.convertSavedReadMarksOnce(start)).toBe(true);
      for (const protocol of ['meshtastic', 'meshcore', 'reticulum'] as const) {
        expect(chat.loadPersistedLastReadInitial(protocol)).toEqual({
          'ch:0': start,
          'dm:7': start - 5_000,
        });
        await vi.waitFor(() => {
          expect(JSON.parse(database[KEYS.chatLastRead[protocol]])).toEqual({
            'ch:0': start,
            'dm:7': start - 5_000,
          });
        });
      }
      expect(chat.loadPersistedRoomsLastRead()).toEqual({ 512: start, 513: start - 1 });
      await vi.waitFor(() => {
        expect(JSON.parse(database[KEYS.roomsLastRead])).toEqual({
          '512': start,
          '513': start - 1,
        });
      });
      // The flag is a browser preference, so it reaches SQLite beside the marks.
      await preferences.flushRendererPreferences();
      expect(JSON.parse(database[KEYS.preferences]).values).toMatchObject({
        'mesh-client:readMarksByArrival': '1',
      });
      expect(chat.convertSavedReadMarksOnce(start)).toBe(false);
    } finally {
      stop();
    }
  });

  it('leaves marks alone on later starts, even ahead of the clock', async () => {
    database[KEYS.chatLastRead.meshcore] = JSON.stringify({ 'ch:0': start + 120_000 });
    const first = await launch();
    try {
      expect(first.chat.convertSavedReadMarksOnce(start)).toBe(true);
      await first.preferences.flushRendererPreferences();
    } finally {
      first.stop();
    }
    // A later start while this clock is set back: receipts, and marks taken from them, run ahead.
    database[KEYS.chatLastRead.meshcore] = JSON.stringify({ 'ch:0': start + 3_600_000 });
    database[KEYS.roomsLastRead] = JSON.stringify({ 512: start + 1_800_000 });
    const later = await launch();
    try {
      expect(localStorage.getItem('mesh-client:readMarksByArrival')).toBe('1');
      expect(later.chat.convertSavedReadMarksOnce(start)).toBe(false);
      expect(later.chat.loadPersistedLastReadInitial('meshcore')).toEqual({
        'ch:0': start + 3_600_000,
      });
      // The receipt clock resumes above the saved marks, so the first line that arrives while the
      // clock is still set back lands above them and counts as unread.
      later.chat.observeSavedReadMarks(start);
      const { nextChatReceivedAt } = await import('./chatReceiveOrder');
      expect(nextChatReceivedAt(start)).toBeGreaterThan(start + 3_600_000);
    } finally {
      later.stop();
    }
  });

  it('starts the receipt clock above a converted mark when the clock is later set back', async () => {
    database[KEYS.roomsLastRead] = JSON.stringify({ 512: start + 200_000 });
    const { chat, stop } = await launch();
    try {
      expect(chat.convertSavedReadMarksOnce(start)).toBe(true);
      expect(chat.loadPersistedRoomsLastRead()).toEqual({ 512: start });
      // Clock set back an hour before the next line arrives.
      const back = start - 3_600_000;
      chat.observeSavedReadMarks(back);
      const { nextChatReceivedAt } = await import('./chatReceiveOrder');
      expect(nextChatReceivedAt(back)).toBeGreaterThan(start);
    } finally {
      stop();
    }
  });

  // The same one-day bound as a saved receipt: a mark further ahead is broken, so it must not move
  // the receipt clock, or it would hold every new line under it and pass its own sanitizer.
  it('ignores a saved mark more than a day ahead of the clock', async () => {
    const first = await launch();
    try {
      expect(first.chat.convertSavedReadMarksOnce(start)).toBe(true);
      await first.preferences.flushRendererPreferences();
    } finally {
      first.stop();
    }
    database[KEYS.chatLastRead.meshtastic] = JSON.stringify({ 'dm:9': start + 2 * 86_400_000 });
    const later = await launch();
    try {
      later.chat.observeSavedReadMarks(start);
      const { chatReadClockMs, nextChatReceivedAt } = await import('./chatReceiveOrder');
      expect(chatReadClockMs(start)).toBe(start);
      expect(nextChatReceivedAt(start)).toBe(start);
    } finally {
      later.stop();
    }
  });

  it('writes nothing over a namespace whose saved marks do not parse', async () => {
    const warn = mockConsoleWarn();
    database[KEYS.chatLastRead.meshtastic] = 'broken';
    database[KEYS.chatLastRead.meshcore] = JSON.stringify({ 'ch:0': start + 60_000 });
    const { chat, stop } = await launch();
    try {
      expect(chat.convertSavedReadMarksOnce(start)).toBe(true);
      expect(chat.loadPersistedLastReadInitial('meshcore')).toEqual({ 'ch:0': start });
      expect(database[KEYS.chatLastRead.meshtastic]).toBe('broken');
    } finally {
      stop();
      warn.restore();
    }
  });

  it('accepts that a fast-clock line read just before the upgrade can show as unread again', async () => {
    database[KEYS.chatLastRead.meshcore] = JSON.stringify({ 'ch:0': start + 120_000 });
    const { chat, stop } = await launch();
    try {
      chat.convertSavedReadMarksOnce(start);
      const { computeChannelUnreadCounts } = await import('./chatUnreadCounts');
      // Saved before receipts were kept, stamped by a clock 2 min fast, and read: its stamp is
      // past the lowered mark. One stale unread is the cost of never hiding a new line.
      const fastLine = {
        sender_id: 2,
        sender_name: 'Alice',
        payload: 'hi',
        channel: 0,
        timestamp: start + 60_000,
        status: 'acked' as const,
      };
      expect(
        computeChannelUnreadCounts(
          [fastLine],
          chat.loadPersistedLastReadInitial('meshcore'),
          new Set([1]),
          'meshcore',
          start,
        ).get(0),
      ).toBe(1);
    } finally {
      stop();
    }
  });
});

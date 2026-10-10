import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_LAUNCHER_PINS,
  filterLauncherEntries,
  formatShortcut,
  isLauncherShortcut,
  isPinToggleShortcut,
  LAUNCHER_PINS_STORAGE_KEY,
  pinnedShortcutPosition,
  readLauncherPins,
  sanitizeLauncherPins,
  toggleLauncherPin,
  usesCommandModifier,
  writeLauncherPins,
} from './panelLauncher';

function key(
  init: Partial<
    Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>
  >,
) {
  return {
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...init,
  };
}

/** renderer-logic runs in node; give the storage helpers a minimal in-memory localStorage. */
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const items = new Map<string, string>();
  return {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => {
      items.set(k, v);
    },
    removeItem: (k) => {
      items.delete(k);
    },
  };
}

describe('launcher pins storage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts with nothing pinned', () => {
    expect(readLauncherPins()).toEqual([]);
    expect(DEFAULT_LAUNCHER_PINS).toEqual([]);
  });

  it('keeps an empty pin list instead of restoring defaults', () => {
    writeLauncherPins([]);
    expect(readLauncherPins()).toEqual([]);
  });

  it('falls back to defaults when storage throws', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    expect(readLauncherPins()).toEqual([...DEFAULT_LAUNCHER_PINS]);
    expect(() => {
      writeLauncherPins(['Chat']);
    }).not.toThrow();
    expect(console.debug).toHaveBeenCalledTimes(2);
  });

  it('falls back to defaults on unreadable JSON', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    localStorage.setItem(LAUNCHER_PINS_STORAGE_KEY, '{not json');
    expect(readLauncherPins()).toEqual([...DEFAULT_LAUNCHER_PINS]);
    expect(console.debug).toHaveBeenCalled();
  });

  it('drops unknown slots and duplicates and caps the list', () => {
    expect(
      sanitizeLauncherPins(['Chat', 'Nope', 'Chat', 'Map', 'RF', 'Graph', 'Stats', 42]),
    ).toEqual(['Chat', 'Map', 'RF', 'Graph']);
    expect(sanitizeLauncherPins('Chat')).toEqual([...DEFAULT_LAUNCHER_PINS]);
  });
});

describe('toggleLauncherPin', () => {
  it('adds, removes and refuses a fifth pin', () => {
    expect(toggleLauncherPin(['Chat'], 'Map')).toEqual(['Chat', 'Map']);
    expect(toggleLauncherPin(['Chat', 'Map'], 'Chat')).toEqual(['Map']);
    const full = ['Chat', 'Nodes', 'Map', 'Connection'] as const;
    expect(toggleLauncherPin(full, 'RF')).toEqual([...full]);
  });
});

describe('launcher shortcuts', () => {
  it('uses Cmd+K on macOS', () => {
    expect(isLauncherShortcut(key({ key: 'k', code: 'KeyK', metaKey: true }), 'darwin')).toBe(true);
    expect(isLauncherShortcut(key({ key: 'k', code: 'KeyK', ctrlKey: true }), 'darwin')).toBe(
      false,
    );
  });

  it.each(['linux', 'win32'])('uses Ctrl+K on %s', (platform) => {
    expect(isLauncherShortcut(key({ key: 'k', code: 'KeyK', ctrlKey: true }), platform)).toBe(true);
    expect(isLauncherShortcut(key({ key: 'K', code: 'KeyK', ctrlKey: true }), platform)).toBe(true);
    expect(isLauncherShortcut(key({ key: 'k', code: 'KeyK', metaKey: true }), platform)).toBe(
      false,
    );
    expect(
      isLauncherShortcut(key({ key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: true }), platform),
    ).toBe(false);
  });

  it.each([
    ['darwin', { metaKey: true }],
    ['linux', { ctrlKey: true }],
    ['win32', { ctrlKey: true }],
  ] as const)('maps the modifier plus 1 to 4 to pin positions on %s', (platform, mod) => {
    expect(pinnedShortcutPosition(key({ key: '1', code: 'Digit1', ...mod }), platform)).toBe(0);
    expect(pinnedShortcutPosition(key({ key: '4', code: 'Digit4', ...mod }), platform)).toBe(3);
    expect(pinnedShortcutPosition(key({ key: '5', code: 'Digit5', ...mod }), platform)).toBeNull();
    expect(pinnedShortcutPosition(key({ key: '1', code: 'Digit1' }), platform)).toBeNull();
    // AZERTY: the physical digit row reports symbols in `key`.
    expect(pinnedShortcutPosition(key({ key: '&', code: 'Digit1', ...mod }), platform)).toBe(0);
  });

  it.each([
    ['darwin', { metaKey: true }],
    ['linux', { ctrlKey: true }],
    ['win32', { ctrlKey: true }],
  ] as const)('toggles pins with the modifier plus P on %s', (platform, mod) => {
    expect(isPinToggleShortcut(key({ key: 'p', code: 'KeyP', ...mod }), platform)).toBe(true);
    expect(isPinToggleShortcut(key({ key: 'p', code: 'KeyP' }), platform)).toBe(false);
    expect(
      isPinToggleShortcut(key({ key: 'P', code: 'KeyP', shiftKey: true, ...mod }), platform),
    ).toBe(false);
  });

  it('formats shortcut hints per platform', () => {
    expect(formatShortcut('K', 'darwin')).toBe('⌘K');
    expect(formatShortcut('K', 'linux')).toBe('Ctrl+K');
    expect(formatShortcut('1', 'win32')).toBe('Ctrl+1');
  });

  it('uses Cmd on Apple platforms (macOS, and iOS for a future mobile build) and Ctrl elsewhere', () => {
    expect(usesCommandModifier('darwin')).toBe(true);
    expect(usesCommandModifier('ios')).toBe(true);
    expect(usesCommandModifier('android')).toBe(false);
    expect(isLauncherShortcut(key({ key: 'k', code: 'KeyK', metaKey: true }), 'ios')).toBe(true);
    expect(isLauncherShortcut(key({ key: 'k', code: 'KeyK', ctrlKey: true }), 'android')).toBe(
      true,
    );
    expect(formatShortcut('K', 'ios')).toBe('⌘K');
    expect(formatShortcut('K', 'android')).toBe('Ctrl+K');
  });
});

describe('filterLauncherEntries', () => {
  const entries = [
    { tabIndex: 0, slot: 'Connection', label: 'Connection' },
    { tabIndex: 1, slot: 'Nodes', label: 'Contacts' },
    { tabIndex: 2, slot: 'Diagnostics', label: 'Diagnostik' },
  ] as const;

  it('returns every entry for an empty query', () => {
    expect(filterLauncherEntries(entries, '  ')).toHaveLength(3);
  });

  it('matches translated labels and stable slot ids', () => {
    expect(filterLauncherEntries(entries, 'CONT').map((e) => e.tabIndex)).toEqual([1]);
    expect(filterLauncherEntries(entries, 'nodes').map((e) => e.tabIndex)).toEqual([1]);
    expect(filterLauncherEntries(entries, 'diagnostics').map((e) => e.tabIndex)).toEqual([2]);
  });
});

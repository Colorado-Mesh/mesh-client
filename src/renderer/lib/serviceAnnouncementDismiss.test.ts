import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dismissServiceAnnouncementId,
  readDismissedServiceAnnouncementIds,
  SERVICE_ANNOUNCEMENT_DISMISS_MAX,
  SERVICE_ANNOUNCEMENT_DISMISS_STORAGE_KEY,
} from './serviceAnnouncementDismiss';

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => {
      store.set(k, v);
    }),
    removeItem: vi.fn((k: string) => {
      store.delete(k);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
}

describe('serviceAnnouncementDismiss', () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('round-trips dismissed ids', () => {
    expect(readDismissedServiceAnnouncementIds()).toEqual([]);
    dismissServiceAnnouncementId('a');
    expect(dismissServiceAnnouncementId('b')).toEqual(['a', 'b']);
    expect(readDismissedServiceAnnouncementIds()).toEqual(['a', 'b']);
  });

  it('moves a re-dismissed id to the end instead of duplicating it', () => {
    dismissServiceAnnouncementId('a');
    dismissServiceAnnouncementId('b');
    expect(dismissServiceAnnouncementId('a')).toEqual(['b', 'a']);
  });

  it(`keeps only the newest ${SERVICE_ANNOUNCEMENT_DISMISS_MAX} ids`, () => {
    const ids = Array.from({ length: SERVICE_ANNOUNCEMENT_DISMISS_MAX + 5 }, (_, i) => `id-${i}`);
    storage.setItem(SERVICE_ANNOUNCEMENT_DISMISS_STORAGE_KEY, JSON.stringify(ids));
    const read = readDismissedServiceAnnouncementIds();
    expect(read).toHaveLength(SERVICE_ANNOUNCEMENT_DISMISS_MAX);
    expect(read[0]).toBe('id-5');
    expect(dismissServiceAnnouncementId('new')).toHaveLength(SERVICE_ANNOUNCEMENT_DISMISS_MAX);
  });

  it.each(['{not json', '"str"', '{"a":1}', '[1, null, "BAD ID", "ok"]'])(
    'tolerates corrupt storage %j',
    (raw) => {
      storage.setItem(SERVICE_ANNOUNCEMENT_DISMISS_STORAGE_KEY, raw);
      expect(readDismissedServiceAnnouncementIds()).toEqual(raw.includes('"ok"') ? ['ok'] : []);
    },
  );

  it('still returns the updated list when storage throws', () => {
    storage.getItem.mockImplementation(() => {
      throw new Error('denied');
    });
    storage.setItem.mockImplementation(() => {
      throw new Error('quota');
    });
    expect(readDismissedServiceAnnouncementIds()).toEqual([]);
    expect(dismissServiceAnnouncementId('a')).toEqual(['a']);
  });
});

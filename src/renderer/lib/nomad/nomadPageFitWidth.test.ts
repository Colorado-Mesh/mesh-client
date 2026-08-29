import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NOMAD_PAGE_FIT_WIDTH_STORAGE_KEY,
  readNomadPageFitWidth,
  writeNomadPageFitWidth,
} from '@/renderer/lib/nomad/nomadPageFitWidth';

describe('nomadPageFitWidth', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    });
  });

  it('defaults to fit-width when the key is missing', () => {
    expect(readNomadPageFitWidth()).toBe(true);
  });

  it('treats only an explicit "false" as open width', () => {
    localStorage.setItem(NOMAD_PAGE_FIT_WIDTH_STORAGE_KEY, 'false');
    expect(readNomadPageFitWidth()).toBe(false);

    localStorage.setItem(NOMAD_PAGE_FIT_WIDTH_STORAGE_KEY, 'true');
    expect(readNomadPageFitWidth()).toBe(true);

    // Anything unparseable keeps the wrapping default rather than opening width.
    localStorage.setItem(NOMAD_PAGE_FIT_WIDTH_STORAGE_KEY, 'garbage');
    expect(readNomadPageFitWidth()).toBe(true);
  });

  it('round-trips both values', () => {
    writeNomadPageFitWidth(false);
    expect(localStorage.getItem(NOMAD_PAGE_FIT_WIDTH_STORAGE_KEY)).toBe('false');
    expect(readNomadPageFitWidth()).toBe(false);

    writeNomadPageFitWidth(true);
    expect(localStorage.getItem(NOMAD_PAGE_FIT_WIDTH_STORAGE_KEY)).toBe('true');
    expect(readNomadPageFitWidth()).toBe(true);
  });

  it('survives a throwing localStorage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });

    expect(readNomadPageFitWidth()).toBe(true);
    expect(() => {
      writeNomadPageFitWidth(false);
    }).not.toThrow();
  });
});

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./appSettingsStorage', () => ({
  getAppSettingsRaw: vi.fn(() => null),
}));

import type { i18n as I18nType } from 'i18next';

import { ensureLocaleLoaded } from './localeResources';
import { mockConsoleWarn } from './vitestConsoleMock';

describe('ensureLocaleLoaded', () => {
  let i18n: I18nType;

  beforeAll(async () => {
    i18n = (await import('./i18n')).default;
  });

  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('returns true for English without loading a bundle', async () => {
    await expect(ensureLocaleLoaded(i18n, 'en')).resolves.toBe(true);
    expect(i18n.language).toBe('en');
  });

  it('returns true and loads a supported non-English locale', async () => {
    await expect(ensureLocaleLoaded(i18n, 'fr')).resolves.toBe(true);
    await i18n.changeLanguage('fr');
    expect(typeof i18n.t('common.close')).toBe('string');
  });

  it('rejects an unsupported region tag and leaves the active language alone', async () => {
    const { spy, restore } = mockConsoleWarn();
    try {
      await expect(ensureLocaleLoaded(i18n, 'ko-KR')).resolves.toBe(false);
      expect(i18n.language).toBe('en');
      expect(spy).toHaveBeenCalledWith('[i18n] requested locale is not selectable');
    } finally {
      restore();
    }
  });

  it('rejects an unknown locale code', async () => {
    const { spy, restore } = mockConsoleWarn();
    try {
      await expect(ensureLocaleLoaded(i18n, 'xx')).resolves.toBe(false);
      expect(i18n.language).toBe('en');
      expect(spy).toHaveBeenCalledWith('[i18n] requested locale is not selectable');
    } finally {
      restore();
    }
  });
});
